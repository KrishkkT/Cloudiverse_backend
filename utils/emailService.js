const nodemailer = require('nodemailer');

// Create reusable transporter object
let transporterConfig;

if (process.env.EMAIL_SERVICE === 'gmail') {
  transporterConfig = {
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  };
} else {
  transporterConfig = {
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  };
}

const transporter = nodemailer.createTransport(transporterConfig);

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
 * Send an email
 */
const sendEmail = async (to, subject, html) => {
  console.log(`[EMAIL SERVICE] Attempting to send email to ${to} with subject: ${subject}`);

  // Check if credentials are provided (support both Gmail and custom SMTP)
  const hasGmailCreds = process.env.EMAIL_SERVICE === 'gmail' && process.env.EMAIL_USER && process.env.EMAIL_PASS;
  const hasSmtpCreds = process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS;

  if (!hasGmailCreds && !hasSmtpCreds) {
    console.log('---------------------------------------------------');
    console.log(`[EMAIL MOCK SERVICE] To: ${to}`);
    console.log(`[EMAIL MOCK SERVICE] Subject: ${subject}`);

    console.log(`[EMAIL MOCK SERVICE] OTP (if found): ${extractOtp(html)}`);
    console.log('---------------------------------------------------');
    console.warn('SMTP/Gmail credentials missing. Email simulated in console.');
    return;
  }

  const fromAddress = process.env.EMAIL_FROM || `"${process.env.SMTP_FROM_NAME || 'Cloudiverse'}" <${process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER}>`;

  try {
    // Race against a 8-second timeout to prevent ETIMEDOUT from hanging or crashing
    const mailPromise = transporter.sendMail({
      from: fromAddress,
      to,
      subject,
      html,
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Email Send Timeout')), 8000)
    );

    const info = await Promise.race([mailPromise, timeoutPromise]);
    console.log(`[EMAIL SERVICE] Email sent: ${info.messageId}`);
    return info;

  } catch (error) {
    // Log error but do NOT throw if it's just a notification (login alert)
    // We only throw if it's critical? Actually, for now, let's catch all and return null so the flow doesn't break.
    console.error(`[EMAIL SERVICE] FAILED to send email to ${to}:`, error.message);
    return null;
  }
};

// Helper to extract OTP for mock service
const extractOtp = (html) => {
  const match = html.match(/class="otp-code">(\d{6})<\/span>/) || html.match(/<b>(\d{6})<\/b>/) || html.match(/>(\d{6})</);
  return match ? match[1] : 'Not found in pattern';
};

const sendWelcomeEmail = async (user) => {
  console.log(`[EMAIL SERVICE] Preparing Welcome Email for ${user.email}`);
  const subject = 'Welcome to Cloudiverse!';
  const body = `
    <p>We are thrilled to have you on board. Cloudiverse is your AI-powered companion for designing robust, multi-cloud architectures.</p>
    <p>Get started by creating your first workspace and let our AI assist you in building compliant, secure, and scalable infrastructure.</p>
    <div style="text-align: center; margin-top: 30px;">
      <a href="${process.env.VITE_FRONTEND_URL || '#'}" class="btn" style="color: #ffffff;">Go to Dashboard</a>
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate(`Welcome, ${user.name}!`, body));
};

const sendLoginNotification = async (user) => {
  console.log(`[EMAIL SERVICE] Preparing Login Notification for ${user.email}`);
  const subject = 'New Login to Cloudiverse';
  const body = `
    <p>We detected a new login to your Cloudiverse account on <strong>${new Date().toLocaleString()}</strong>.</p>
    <p>If this was you, you can safely ignore this email.</p>
    <div style="background-color: #fef2f2; border-left: 4px solid #ef4444; padding: 15px; margin-top: 20px; color: #b91c1c;">
      <strong>Not you?</strong> Please reset your password immediately to secure your account.
    </div>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('New Login Detected', body));
};

const sendPasswordResetEmail = async (email, otp) => {
  const subject = 'Reset Your Password - Cloudiverse';
  const body = `
    <p>You have requested to reset your password. Please use the verification code below to proceed with setting a new password:</p>
    <div class="otp-box">
      <span class="otp-code">${otp}</span>
    </div>
    <p>This code is valid for <strong>10 minutes</strong>. Do not share this code with anyone.</p>
    <p>If you did not request a password reset, please ignore this email.</p>
  `;
  await sendEmail(email, subject, getHtmlTemplate('Password Reset', body));
};

const sendAccountDeletionEmail = async (user) => {
  console.log(`[EMAIL SERVICE] Sending Account Deletion Email to ${user.email}`);
  const subject = 'Account Deleted - Cloudiverse';
  const body = `
    <p>Your Cloudiverse account associated with <strong>${user.email}</strong> has been successfully deleted.</p>
    <p>We are sorry to see you go. All your workspaces and data have been permanently removed.</p>
    <p>We hope to see you again in the future!</p>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Account Deleted', body));
};

const sendWorkspaceDeletionEmail = async (user, workspaceName) => {
  console.log(`[EMAIL SERVICE] Sending Workspace Deletion Email to ${user.email}`);
  const subject = `Workspace Deleted: ${workspaceName}`;
  const body = `
    <p>This is a confirmation that your workspace <strong>${workspaceName}</strong> has been successfully deleted.</p>
    <p>Any associated project data and configurations have been removed from our servers.</p>
    <p>Keep building!</p>
  `;
  await sendEmail(user.email, subject, getHtmlTemplate('Workspace Deleted', body));
};

module.exports = {
  sendEmail,
  sendWelcomeEmail,
  sendLoginNotification,
  sendPasswordResetEmail,
  sendAccountDeletionEmail,
  sendWorkspaceDeletionEmail
};
