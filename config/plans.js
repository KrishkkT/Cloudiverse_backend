// Plan Configuration (Source of Truth)

// IMPORTANT: Map these to real Razorpay Plan IDs in production
const RAZORPAY_PLAN_IDS = {
    PRO_MONTHLY: process.env.RAZORPAY_PLAN_PRO_MONTHLY || 'plan_O972348234j234', // Replace with real ID
};

const PLANS = {
    FREE: {
        id: 'free',
        name: 'Free Tier',
        price: 0,
        limits: {
            projects: 3,           // Max active projects
            runs_per_month: 5,     // AI generation runs
            storage_days: 7        // Canvas retention (soft limit)
        },
        features: {
            diagram_export: true,
            terraform_export: true,  // ALLOWED (Bounded by Project Limit)
            report_download: true,   // ALLOWED (Bounded by Project Limit)
            multi_cloud_compare: true, // ALLOWED
            cost_breakdown: true,    // ALLOWED
            system_ai: true         // Limited/No System AI
        }
    },
    PRO: {
        id: 'pro',
        name: 'Pro Tier',
        razorpay_plan_id: RAZORPAY_PLAN_IDS.PRO_MONTHLY,
        price: 999, // Display price (handled by Razorpay)
        limits: {
            projects: Infinity,
            runs_per_month: Infinity, // Fair use applies
            storage_days: Infinity
        },
        features: {
            diagram_export: true,
            terraform_export: true,  // ALLOWED
            report_download: true,   // ALLOWED
            multi_cloud_compare: true, // ALLOWED
            cost_breakdown: true,    // ALLOWED
            system_ai: true          // INCLUDED
        }
    }
};

module.exports = { PLANS, RAZORPAY_PLAN_IDS };
