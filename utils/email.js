const nodemailer = require('nodemailer');
require('dotenv').config();

// Create transporter with more robust configuration
const createTransporter = () => {
  // Try direct SMTP configuration first
  if (process.env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT || 587,
      secure: process.env.SMTP_SECURE === 'true', // true for 465, false for other ports
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
      },
      tls: {
        rejectUnauthorized: false
      },
      connectionTimeout: 30000, // 30 seconds
      greetingTimeout: 30000,   // 30 seconds
      socketTimeout: 60000      // 60 seconds
    });
  }
  
  // Fall back to service-based configuration
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS
    },
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 30000, // 30 seconds
    greetingTimeout: 30000,   // 30 seconds
    socketTimeout: 60000      // 60 seconds
  });
};

const transporter = createTransporter();

// Verify transporter configuration on startup
transporter.verify((error, success) => {
  if (error) {
    console.error('Email transporter configuration error:', error.message);
    console.log('Email service may not be available. Emails will be logged instead.');
  } else {
    console.log('Email transporter is ready to send messages');
  }
});

// Utility function to send email with retry logic
const sendEmailWithRetry = async (mailOptions, maxRetries = 3) => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt} to send email to: ${mailOptions.to}`);
      
      // Create email promise
      const emailPromise = transporter.sendMail(mailOptions);
      
      // Add timeout to prevent hanging
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Email send timeout')), 60000); // 60 seconds
      });
      
      // Race between email promise and timeout
      await Promise.race([emailPromise, timeoutPromise]);
      
      console.log(`Email sent successfully to: ${mailOptions.to} on attempt ${attempt}`);
      return true;
    } catch (error) {
      console.error(`Attempt ${attempt} failed to send email to ${mailOptions.to}:`, error.message);
      
      // If this was the last attempt, log the email content as fallback
      if (attempt === maxRetries) {
        console.log('=== EMAIL CONTENT THAT FAILED TO SEND ===');
        console.log('TO:', mailOptions.to);
        console.log('SUBJECT:', mailOptions.subject);
        console.log('CONTENT:', mailOptions.html);
        console.log('=========================================');
        throw error;
      }
      
      // Wait before retrying (exponential backoff)
      await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 2000));
    }
  }
};

// Send welcome email with improved error handling and retry logic
const sendWelcomeEmail = async (user) => {
  try {
    // Use setImmediate to ensure this is completely non-blocking
    setImmediate(async () => {
      try {
        const mailOptions = {
          from: process.env.EMAIL_FROM || `"Cloudiverse Architect" <${process.env.EMAIL_USER}>`,
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
                  <strong>This email is intended for: ${user.email}</strong>
                </p>
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
                  <a href="${process.env.VITE_FRONTEND_URL}" 
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
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #ccc;">Email sent to: ${user.email}</p>
              </div>
            </div>
          `
        };

        await sendEmailWithRetry(mailOptions);
        console.log('Welcome email sent successfully to:', user.email);
      } catch (error) {
        console.error('Error sending welcome email to', user.email, ':', error.message);
        // Silently fail - don't block the main flow
      }
    });
  } catch (error) {
    console.error('Error initializing welcome email to', user.email, ':', error.message);
    // Silently fail - don't block the main flow
  }

  // Return immediately to avoid blocking
  return { success: true };
};

// Send login notification email with improved error handling and retry logic
const sendLoginNotification = async (user) => {
  try {
    // Use setImmediate to ensure this is completely non-blocking
    setImmediate(async () => {
      try {
        const mailOptions = {
          from: process.env.EMAIL_FROM || `"Cloudiverse Architect" <${process.env.EMAIL_USER}>`,
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
                  <strong>This email is intended for: ${user.email}</strong>
                </p>
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
                  <a href="${process.env.VITE_FRONTEND_URL}/settings" 
                     style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                    Secure Your Account
                  </a>
                </div>
              </div>
              <div style="background: #333; color: white; padding: 20px; text-align: center; border-radius: 0 0 10px 10px;">
                <p style="margin: 0;">&copy; ${new Date().getFullYear()} Cloudiverse Architect. All rights reserved.</p>
                <p style="margin: 5px 0 0 0; font-size: 12px; color: #ccc;">Email sent to: ${user.email}</p>
              </div>
            </div>
          `
        };

        await sendEmailWithRetry(mailOptions);
        console.log('Login notification email sent successfully to:', user.email);
      } catch (error) {
        console.error('Error sending login notification email to', user.email, ':', error.message);
        // Silently fail - don't block the main flow
      }
    });
  } catch (error) {
    console.error('Error initializing login notification email to', user.email, ':', error.message);
    // Silently fail - don't block the main flow
  }

  // Return immediately to avoid blocking
  return { success: true };
};

// Helper functions
const getUserIP = () => {
  // In a real implementation, you would get this from the request
  return 'Unknown IP';
};

const getUserDevice = () => {
  // In a real implementation, you would get this from the request headers
  return 'Unknown Device';
};

module.exports = {
  sendWelcomeEmail,
  sendLoginNotification
};
