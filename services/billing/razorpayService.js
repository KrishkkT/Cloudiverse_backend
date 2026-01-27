const Razorpay = require('razorpay');
const crypto = require('crypto');
const { RAZORPAY_PLAN_IDS } = require('../../config/plans');

class RazorpayService {
    constructor() {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.warn("⚠️ Razorpay credentials missing in .env");
        }

        this.instance = new Razorpay({
            key_id: process.env.RAZORPAY_KEY_ID,
            key_secret: process.env.RAZORPAY_KEY_SECRET
        });
    }

    /**
     * Create a Subscription for a user
     * @param {string} planId - Razorpay Plan ID
     * @param {number} totalCount - billing cycles (default 12)
     */
    async createSubscription(planId, totalCount = 12) {
        try {
            const subscription = await this.instance.subscriptions.create({
                plan_id: planId,
                total_count: totalCount,
                quantity: 1,
                customer_notify: 1,
            });
            return subscription;
        } catch (error) {
            console.error('Razorpay Create Subscription Error:', error);
            throw new Error('Failed to create subscription');
        }
    }

    /**
     * Cancel a Subscription
     */
    async cancelSubscription(subscriptionId) {
        try {
            // cancel_at_cycle_end is safer for UX
            return await this.instance.subscriptions.cancel(subscriptionId, false);
        } catch (error) {
            console.error('Razorpay Cancel Subscription Error:', error);
            throw new Error('Failed to cancel subscription');
        }
    }

    /**
     * Verify Webhook Signature (Critical Security)
     */
    verifyWebhookSignature(body, signature) {
        const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
        if (!secret) throw new Error("Webhook secret not configured");

        const expectedSignature = crypto
            .createHmac('sha256', secret)
            .update(JSON.stringify(body))
            .digest('hex');

        return expectedSignature === signature;
    }

    /**
     * Fetch Subscription Details
     */
    async getSubscription(subscriptionId) {
        return await this.instance.subscriptions.fetch(subscriptionId);
    }
}

module.exports = new RazorpayService();
