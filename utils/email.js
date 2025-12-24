const nodemailer = require('nodemailer');

// Create Transporter
// User must provide SMTP details in .env
// Fallback to console logging if credentials missing
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  secure: false, // true for 465, false for other ports
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

// Common Email Sender
const sendEmail = async (to, subject, html) => {
  try {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
      console.log("---------------------------------------------------");
      console.log(`[MOCK EMAIL] To: ${to}`);
      console.log(`[MOCK EMAIL] Subject: ${subject}`);
      console.log(`[MOCK EMAIL] Body: ${html.substring(0, 50)}...`);
      console.log("---------------------------------------------------");
      return;
    }

    const info = await transporter.sendMail({
      from: `Cloudiverse <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
      to,
      subject,
      html,
    });
    console.log(`Email sent: ${info.messageId}`);
  } catch (err) {
    console.error(`Email Error (${subject}):`, err.message);
    // Don't throw, just log. Email failure shouldn't crash the auth flow.
  }
};

const sendWelcomeEmail = async (user) => {
  const html = `
    <h1>Welcome to Cloudiverse, ${user.name}!</h1>
    <p>We're thrilled to have you on board.</p>
    <p>Cloudiverse allows you to:</p>
    <ul>
      <li>Architect complex multi-cloud infrastructure using AI.</li>
      <li>Estimate costs and optimize resources.</li>
      <li>Collaborate on workspaces (Coming Soon).</li>
    </ul>
    <p>Happy Architecting!</p>
    <br/>
    <p>The Cloudiverse Team</p>
  `;
  await sendEmail(user.email, 'Welcome to Cloudiverse!', html);
};

const sendLoginNotification = async (user) => {
  const time = new Date().toLocaleString();
  const html = `
    <h3>New Login Detected</h3>
    <p>Hello ${user.name},</p>
    <p>We detected a new login to your Cloudiverse account at <b>${time}</b>.</p>
    <p>If this was you, you can ignore this email.</p>
    <p>If you did not authorize this, please reset your password immediately.</p>
    <br/>
    <p>The Cloudiverse Team</p>
  `;
  await sendEmail(user.email, 'Security Alert: New Login to Cloudiverse', html);
};

const sendPasswordResetEmail = async (email, otp) => {
  const html = `
    <h3>Password Reset Request</h3>
    <p>You requested a password reset for your Cloudiverse account.</p>
    <p>Your OTP Code is:</p>
    <h2 style="color: #4f46e5; letter-spacing: 5px;">${otp}</h2>
    <p>This code expires in 10 minutes.</p>
    <p>If you did not request this, please ignore this email.</p>
  `;
  await sendEmail(email, 'Cloudiverse Password Reset OTP', html);
};

module.exports = {
  sendWelcomeEmail,
  sendLoginNotification,
  sendPasswordResetEmail
};
