const pool = require('../../config/db');
const { PLANS, RAZORPAY_PLAN_IDS } = require('../../config/plans');
const razorpayService = require('./razorpayService');
const emailService = require('../../utils/emailService');

class BillingService {

    /**
     * Helper: Get User Details by Razorpay Subscription ID
     */
    async getUserBySubId(razorpaySubId) {
        const res = await pool.query(
            `SELECT u.email, u.name 
             FROM users u
             JOIN subscriptions s ON u.id = s.user_id
             WHERE s.razorpay_subscription_id = $1`,
            [razorpaySubId]
        );
        return res.rows[0];
    }

    /**
     * Helper: Get User Details by User ID
     */
    async getUserById(userId) {
        const res = await pool.query('SELECT email, name FROM users WHERE id = $1', [userId]);
        return res.rows[0];
    }

    /**
     * Get User's Current Plan and Features
     * @param {string} userId
     */
    async getPlanStatus(userId) {
        try {
            const res = await pool.query(
                `SELECT plan, status, current_period_end FROM subscriptions WHERE user_id = $1`,
                [userId]
            );

            let sub = res.rows[0];

            // Default to free if no record
            if (!sub) {
                return {
                    plan: PLANS.FREE.id,
                    status: 'active',
                    features: PLANS.FREE.features,
                    limits: PLANS.FREE.limits,
                    is_trial: false
                };
            }

            // Check if expired
            const now = new Date();
            if (sub.status === 'canceled' && new Date(sub.current_period_end) < now) {
                // Downgrade logic (should ideally be handled by webhook, but safe fallback)
                return {
                    plan: PLANS.FREE.id,
                    status: 'canceled',
                    features: PLANS.FREE.features,
                    limits: PLANS.FREE.limits
                };
            }

            // Handle Canceled but still active until period end
            if (sub.status === 'canceled' && new Date(sub.current_period_end) > now) {
                return {
                    plan: PLANS.PRO.id,
                    status: 'canceled_active', // Custom status for UI distinction
                    features: PLANS.PRO.features,
                    limits: PLANS.PRO.limits,
                    renewal_date: sub.current_period_end,
                    warning: `Your subscription is cancelled but remains active until ${new Date(sub.current_period_end).toLocaleDateString()}`
                };
            }

            // Active Pro Plan
            if (sub.plan === 'pro' && ['active', 'trialing'].includes(sub.status)) {
                return {
                    plan: PLANS.PRO.id,
                    status: sub.status,
                    features: PLANS.PRO.features,
                    limits: PLANS.PRO.limits,
                    renewal_date: sub.current_period_end
                };
            }

            // Fallback (e.g. past_due) - Block features but show status
            return {
                plan: sub.plan,
                status: sub.status,
                features: PLANS.FREE.features, // Downgrade access immediately on payment failure/past_due
                limits: PLANS.FREE.limits,
                warning: 'Subscription is not active.'
            };

        } catch (error) {
            console.error('Get Plan Status Error:', error);
            throw error;
        }
    }

    /**
     * Initialize Subscription Flow (Create Intent)
     */
    async createSubscriptionIntent(userId) {
        // 1. Check existing
        const existing = await pool.query('SELECT * FROM subscriptions WHERE user_id = $1', [userId]);
        if (existing.rows.length > 0 && existing.rows[0].status === 'active' && existing.rows[0].plan === 'pro') {
            throw new Error("User already has an active Pro subscription.");
        }

        // 2. Create at Razorpay
        const planId = PLANS.PRO.razorpay_plan_id;
        const sub = await razorpayService.createSubscription(planId);

        // 3. Upsert into DB (status: created/pending)
        // We do NOT mark it 'active' yet. Webhook does that.
        // Or strictly strictly, we verify the payment signature on frontend callback to activate.

        return sub;
    }

    /**
     * Handle Razorpay Webhooks
     * Source of Truth
     */
    async handleWebhook(payload) {
        const { event, payload: data } = payload;

        console.log(`[Billing] Processing Webhook: ${event}`);

        if (event === 'subscription.charged') {
            await this.activateSubscription(data.subscription.entity);
        } else if (event === 'subscription.cancelled') {
            await this.cancelSubscriptionLocal(data.subscription.entity);
        } else if (event === 'subscription.halted') {
            await this.haltSubscription(data.subscription.entity);
        }

        return true;
    }

    async activateSubscription(razorpaySub) {
        const { id, customer_id, plan_id, status, current_end } = razorpaySub;
        // Logic to map razorpay_customer_id / razorpay_sub_id back to a user
        // This is tricky if we didn't store the razorpay_sub_id during checkout.
        // STRATEGY: 
        // 1. When frontend successfully pays, we call an API verifyPayment() which links user -> sub_id
        // 2. Webhook just updates status based on sub_id match.

        const periodEnd = new Date(current_end * 1000);

        await pool.query(
            `UPDATE subscriptions 
             SET status = 'active', 
                 plan = $1, 
                 current_period_end = $2,
                 updated_at = NOW()
             WHERE razorpay_subscription_id = $3`,
            ['pro', periodEnd, id]
        );

        // Send Email
        try {
            const user = await this.getUserBySubId(id);
            if (user) await emailService.sendSubscriptionSuccessEmail(user);
        } catch (err) {
            console.error('[Billing] Failed to send success email:', err);
        }
    }

    async cancelSubscriptionLocal(razorpaySub) {
        // Only mark status as canceled. Access logic handles 'until current_period_end'
        await pool.query(
            `UPDATE subscriptions SET status = 'canceled', updated_at = NOW() 
             WHERE razorpay_subscription_id = $1`,
            [razorpaySub.id]
        );

        // Note: We don't send email here usually because this is a webhook event 
        // that might fire even if admin cancels etc. 
        // But for completeness let's trigger it if the user initiated it via portal? 
        // Usually better to trigger email from the API action directly for better context.
    }

    async cancelSubscription(userId) {
        // 1. Get Active Subscription
        const res = await pool.query(
            `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'trialing')`,
            [userId]
        );
        const sub = res.rows[0];

        if (!sub) {
            throw new Error("No active subscription found to cancel.");
        }

        if (!sub.razorpay_subscription_id) {
            throw new Error("Subscription ID missing. Cannot cancel via Razorpay.");
        }

        // 2. Call Razorpay API to cancel
        try {
            await razorpayService.cancelSubscription(sub.razorpay_subscription_id);
        } catch (error) {
            // If strictly "Subscription is not cancellable in cancelled status", treat as success
            const isAlreadyCancelled = error?.error?.description?.includes('not cancellable in cancelled status')
                || error?.description?.includes('not cancellable in cancelled status');

            if (!isAlreadyCancelled) {
                // Real error, rethrow
                throw error;
            }
            console.log("Subscription already cancelled on Razorpay. Syncing local status.");
        }

        // 3. Update Local DB - DELETE as per user request
        // This removes the subscription entirely, reverting user to Free tier immediately.
        await pool.query(
            `DELETE FROM subscriptions WHERE user_id = $1`,
            [userId]
        );

        // Send Email
        try {
            const user = await this.getUserById(userId);
            if (user) await emailService.sendSubscriptionCancelledEmail(user);
        } catch (err) {
            console.error('[Billing] Failed to send cancellation email:', err);
        }

        return true;
    }

    async haltSubscription(razorpaySub) {
        await pool.query(
            `UPDATE subscriptions SET status = 'halted', updated_at = NOW() 
             WHERE razorpay_subscription_id = $1`,
            [razorpaySub.id]
        );

        // Send Email
        try {
            const user = await this.getUserBySubId(razorpaySub.id);
            if (user) await emailService.sendPaymentFailedEmail(user);
        } catch (err) {
            console.error('[Billing] Failed to send failed payment email:', err);
        }
    }

    /**
     * Link User to Subscription (Called after frontend successful checkout)
     */
    async linkSubscription(userId, razorpaySubId, razorpayPaymentId, razorpaySignature) {
        // Verify signature first!
        const generatedSignature = require('crypto')
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(razorpayPaymentId + '|' + razorpaySubId)
            .digest('hex');

        if (generatedSignature !== razorpaySignature) {
            throw new Error("Payment verification failed. Invalid signature.");
        }

        // Fetch sub details to get end date
        const subDetails = await razorpayService.getSubscription(razorpaySubId);
        const currentEnd = new Date(subDetails.current_end * 1000);

        // Upsert
        const query = `
            INSERT INTO subscriptions (user_id, plan, status, razorpay_subscription_id, current_period_end)
            VALUES ($1, 'pro', 'active', $2, $3)
            ON CONFLICT (user_id) 
            DO UPDATE SET 
                plan = 'pro', 
                status = 'active', 
                razorpay_subscription_id = $2, 
                current_period_end = $3,
                updated_at = NOW();
        `;

        await pool.query(query, [userId, razorpaySubId, currentEnd]);

        // Send Email immediately upon linking (faster feedback than webhook)
        try {
            const user = await this.getUserById(userId);
            if (user) await emailService.sendSubscriptionSuccessEmail(user);
        } catch (err) {
            console.error('[Billing] Failed to send success email (link):', err);
        }

        return { success: true };
    }
}

module.exports = new BillingService();
