const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter
const transporter = nodemailer.createTransport({
  service: process.env.EMAIL_SERVICE,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Verify transporter
transporter.verify((error, success) => {
  if (error) {
    console.log('Email transporter error:', error);
  } else {
    console.log('Email transporter is ready');
  }
});

// Send welcome email
const sendWelcomeEmail = async (user) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: 'Welcome to Cloudiverse Architect!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Welcome to Cloudiverse Architect!</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6;">
            Thank you for joining Cloudiverse Architect! You can now start designing multi-cloud architectures with our AI-powered platform.
          </p>
          <p style="color: #666; line-height: 1.6;">
            With Cloudiverse, you can:
          </p>
          <ul style="color: #666; line-height: 1.6;">
            <li>Design cloud architectures from plain language</li>
            <li>Compare multi-cloud providers</li>
            <li>Generate production-ready Terraform code</li>
            <li>Estimate costs accurately</li>
          </ul>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Start Designing
            </a>
          </div>
          <p style="color: #999; font-size: 14px;">
            If you have any questions, feel free to reach out to our support team.
          </p>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} Cloudiverse Architect. All rights reserved.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Welcome email sent to:', user.email);
    return { success: true };
  } catch (error) {
    console.error('Error sending welcome email:', error);
    return { success: false, error: error.message };
  }
};

// Send login notification email
const sendLoginNotification = async (user) => {
  const mailOptions = {
    from: process.env.EMAIL_FROM,
    to: user.email,
    subject: 'New Login to Your Cloudiverse Account',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
          <h1 style="color: white; margin: 0;">Security Notification</h1>
        </div>
        <div style="padding: 30px; background: #f9f9f9;">
          <h2 style="color: #333;">Hello ${user.name},</h2>
          <p style="color: #666; line-height: 1.6;">
            We noticed a new login to your Cloudiverse Architect account.
          </p>
          <p style="color: #666; line-height: 1.6;">
            <strong>Login Time:</strong> ${new Date().toLocaleString()}<br>
            <strong>IP Address:</strong> ${getUserIP()}<br>
            <strong>Device:</strong> ${getUserDevice()}
          </p>
          <p style="color: #666; line-height: 1.6;">
            If this wasn't you, please secure your account immediately by changing your password.
          </p>
          <div style="text-align: center; margin: 30px 0;">
            <a href="${process.env.FRONTEND_URL}/settings" 
               style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
              Secure Your Account
            </a>
          </div>
        </div>
        <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
          <p style="margin: 0;">&copy; ${new Date().getFullYear()} Cloudiverse Architect. All rights reserved.</p>
        </div>
      </div>
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log('Login notification email sent to:', user.email);
    return { success: true };
  } catch (error) {
    console.error('Error sending login notification email:', error);
    return { success: false, error: error.message };
  }
};

// Helper functions
const getUserIP = () => {
  // In a real implementation, you would get this from the request
  return '192.168.1.1';
};

const getUserDevice = () => {
  // In a real implementation, you would get this from the request headers
  return 'Chrome on Windows';
};

module.exports = {
  sendWelcomeEmail,
  sendLoginNotification
};