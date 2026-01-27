const { Resend } = require('resend');
require('dotenv').config();

// Initialize Resend
// Use provided key if env var is missing (User provided: re_XADo5vcJ_CJNckUejnidSMSvR77p9FM4F)
const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_XADo5vcJ_CJNckUejnidSMSvR77p9FM4F';
const resend = new Resend(RESEND_API_KEY);

// Domain configuration
const DOMAIN = 'cloudiverse.app';

// Strict Sender Configuration
const EMAIL_SENDERS = {
  VERIFICATION: `verification@${DOMAIN}`,
  ONBOARDING: `onboarding@${DOMAIN}`,
  NOREPLY: `noreply@${DOMAIN}`,
  SECURITY: `security@${DOMAIN}`,
  SUPPORT: `support@${DOMAIN}`,
  UPDATES: `updates@${DOMAIN}`,
  BILLING: `billing@${DOMAIN}`,
};

const getSender = (type) => {
  return EMAIL_SENDERS[type] || EMAIL_SENDERS.NOREPLY;
};

// --- Shared HTML Template ---
const getHtmlTemplate = (title, bodyContent) => {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body { margin: 0; padding: 0; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; background-color: #f4f4f9; color: #333333; }
        .container { max-width: 600px; margin: 40px auto; background-color: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 20px rgba(0,0,0,0.05); }
        .header { background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%); padding: 30px; text-align: center; }
        .header h1 { margin: 0; color: #ffffff; font-size: 24px; letter-spacing: 1px; font-weight: 700; }
        .content { padding: 40px 30px; line-height: 1.6; }
        .content h2 { margin-top: 0; color: #1e293b; font-size: 20px; font-weight: 600; }
        .content p { margin-bottom: 20px; color: #475569; font-size: 16px; }
        .otp-box { background-color: #f1f5f9; border-radius: 12px; padding: 20px; text-align: center; margin: 30px 0; border: 1px dashed #cbd5e1; }
        .otp-code { font-family: 'Courier New', monospace; font-size: 32px; font-weight: 700; color: #2563eb; letter-spacing: 8px; }
        .footer { background-color: #f8fafc; padding: 20px; text-align: center; border-top: 1px solid #e2e8f0; }
        .footer p { margin: 0; font-size: 12px; color: #94a3b8; }
        .btn { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; margin-top: 10px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>CLOUDIVERSE</h1>
        </div>
        <div class="content">
          <h2>${title}</h2>
          ${bodyContent}
        </div>
        <div class="footer">
          <p>&copy; ${new Date().getFullYear()} Cloudiverse. All rights reserved.</p>
          <p>Designing the future of cloud architecture.</p>
        </div>
      </div>
    </body>
    </html>
  `;
};

/**
 * Generic Send Function using Resend
 */
const sendEmail = async (to, subject, html, senderType = 'NOREPLY') => {
  const from = getSender(senderType);
  console.log(`[EMAIL SERVICE] Sending [${senderType}] email to ${to} from ${from}`);

  try {
    const { data, error } = await resend.emails.send({
      from: from,
      to: [to],
      subject: subject,
      html: html,
    });

    if (error) {
      console.error('[EMAIL SERVICE] Resend API Error:', error);
      return null;
    }

    console.log(`[EMAIL SERVICE] Email sent successfully: ${data.id}`);
    return data;
  } catch (err) {
    console.error('[EMAIL SERVICE] Unexpected error:', err.message);
    return null;
  }
};

// 1. WELCOME / ONBOARDING
const sendWelcomeEmail = async (user) => {
  const subject = 'Welcome to Cloudiverse!';
  const body = `
    <p>We are thrilled to have you on board. Cloudiverse is your AI-powered companion for designing robust, multi-cloud architectures.</p>
    <p>Get started by creating your first workspace and let our AI assist you in building compliant, secure, and scalable infrastructure.</p>
    <div style="text-align: center; margin-top: 30px;">
      <a href="${process.env.VITE_FRONTEND_URL || '#'}" class="btn" style="color: #ffffff;">Go to Dashboard</a>
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate(`Welcome, ${user.name}!`, body), 'ONBOARDING');
};

// 3. SYSTEM NOTIFICATIONS (Login Alert)
const sendLoginNotification = async (user) => {
  const subject = 'New Login to Cloudiverse';
  const body = `
    <p>We detected a new login to your Cloudiverse account on <strong>${new Date().toLocaleString()}</strong>.</p>
    <p>If this was you, you can safely ignore this email.</p>
    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-top: 20px; color: #b91c1c;">
      <strong>Not you?</strong> Please reset your password immediately to secure your account.
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('New Login Detected', body), 'SECURITY');
};

// 1. OTP / VERIFICATION CODES
const sendPasswordResetEmail = async (email, otp) => {
  const subject = 'Reset Your Password - Cloudiverse';
  const body = `
    <p>You have requested to reset your password. Please use the verification code below to proceed:</p>
    <div class="otp-box">
      <span class="otp-code">${otp}</span>
    </div>
    <p>This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
  `;
  await sendEmail(email, subject, getHtmlTemplate('Password Reset', body), 'VERIFICATION');
};

// 4. ACCOUNT DELETION
const sendAccountDeletionEmail = async (user) => {
  const subject = 'Account Deleted - Cloudiverse';
  const body = `
    <p>Your Cloudiverse account associated with <strong>${user.email}</strong> has been successfully deleted.</p>
    <p>We are sorry to see you go. All your workspaces and data have been permanently removed.</p>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Account Deleted', body), 'SECURITY');
};

// 4. WORKSPACE DELETION
const sendWorkspaceDeletionEmail = async (user, workspaceName) => {
  const subject = `Workspace Deleted: ${workspaceName}`;
  const body = `
    <p>This is a confirmation that your workspace <strong>${workspaceName}</strong> has been successfully deleted.</p>
    <p>Any associated project data and configurations have been removed from our servers.</p>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Workspace Deleted', body), 'SECURITY');
};

// 3. SYSTEM NOTIFICATIONS (Deployment Ready)
const sendDeploymentReadyEmail = async (user, deploymentDetails) => {
  const { workspaceName, provider, estimatedCost, pattern, services, region, workspaceId } = deploymentDetails;
  const subject = `Your Terraform is Ready: ${workspaceName}`;
  const body = `
    <h2 style="color: #2563EB;">Your Terraform is Ready</h2>
    <p>The Terraform configuration for <strong>${workspaceName}</strong> has been generated and is ready for download.</p>
    
    <div style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; margin: 20px 0;">
      <h3 style="margin-top: 0; color: #1e293b;">Infrastructure Summary</h3>
      <table style="width: 100%; border-collapse: collapse;">
        <tr><td style="padding: 8px 0; color: #64748b;">Cloud Provider</td><td style="text-align: right; font-weight: 600;">${(provider || 'N/A').toUpperCase()}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b;">Pattern</td><td style="text-align: right; font-weight: 600;">${pattern || 'Custom'}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b;">Region</td><td style="text-align: right; font-weight: 600;">${region || 'Default'}</td></tr>
        <tr><td style="padding: 8px 0; color: #64748b;">Est. Cost</td><td style="text-align: right; font-weight: 700; color: #22c55e;">${estimatedCost || 'N/A'}</td></tr>
      </table>
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <a href="${process.env.VITE_FRONTEND_URL || 'https://cloudiverse.vercel.app'}/workspaces" class="btn" style="color: #ffffff;">View Workspace</a>
    </div>
    
    <div style="text-align: center; margin-top: 20px;">
       <a href="${process.env.VITE_FRONTEND_URL || 'https://cloudiverse.vercel.app'}/report-download/${workspaceId}" class="btn" style="background-color: #0f172a;">📄 Download PDF Report</a>
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Infrastructure Ready', body), 'NOREPLY');
};

// 5. SUPPORT REPLIES
const sendSupportEmail = async (to, subject, content) => {
  await sendEmail(to, subject, getHtmlTemplate('Support Reply', content), 'SUPPORT');
};

// 6. PRODUCT UPDATES
const sendUpdateEmail = async (to, subject, content) => {
  await sendEmail(to, subject, getHtmlTemplate('Product Update', content), 'UPDATES');
};

// 7. BILLING
const sendBillingEmail = async (to, subject, content) => {
  await sendEmail(to, subject, getHtmlTemplate('Billing Notification', content), 'BILLING');
};

const sendSubscriptionSuccessEmail = async (user, planName = 'Pro Plan') => {
  const subject = 'Welcome to Cloudiverse Pro!';
  const body = `
    <h2 style="color: #2563EB;">Upgrade Successful!</h2>
    <p>Congratulations, <strong>${user.name}</strong>!</p>
    <p>Your subscription to <strong>${planName}</strong> is now active. You have unlocked unlimited projects, advanced AI models, and Terraform exports.</p>
    
    <div style="background-color: #ecfdf5; padding: 15px; border-radius: 8px; border-left: 4px solid #10b981; margin: 20px 0; color: #065f46;">
      <strong>Next Billing Date:</strong> One month from today.
    </div>

    <div style="text-align: center; margin-top: 30px;">
      <a href="${process.env.VITE_FRONTEND_URL || 'https://cloudiverse.vercel.app'}/workspaces" class="btn" style="color: #ffffff;">Go to Dashboard</a>
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Subscription Active', body), 'BILLING');
};

const sendPaymentFailedEmail = async (user) => {
  const subject = 'Action Required: Payment Failed';
  const body = `
    <p>We encountered an issue processing your subscription renewal.</p>
    <p>Your access to Pro features has been temporarily paused. Please update your payment method to restore access.</p>
    <div style="text-align: center; margin-top: 30px;">
      <a href="${process.env.VITE_FRONTEND_URL || '#'}/settings" class="btn" style="background-color: #ef4444; color: #ffffff;">Update Payment Method</a>
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Payment Failed', body), 'BILLING');
};

const sendSubscriptionCancelledEmail = async (user) => {
  const subject = 'Subscription Cancelled';
  const body = `
    <p>Your subscription has been cancelled as requested.</p>
    <p>You will continue to have access to Pro features until the end of your current billing period.</p>
    <p>We're sorry to see you go! You can reactivate your subscription at any time.</p>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Subscription Cancelled', body), 'BILLING');
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLoginNotification,
  sendPasswordResetEmail,
  sendAccountDeletionEmail,
  sendWorkspaceDeletionEmail,
  sendDeploymentReadyEmail,
  sendSupportEmail,
  sendUpdateEmail,
  sendBillingEmail,
  sendSubscriptionSuccessEmail,
  sendPaymentFailedEmail,
  sendSubscriptionCancelledEmail
};
