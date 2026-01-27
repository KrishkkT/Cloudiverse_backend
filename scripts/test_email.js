const emailService = require('../utils/emailService');
require('dotenv').config();

async function testEmail() {
    console.log('--- Testing Email Service ---');
    console.log(`API Key set: ${!!process.env.RESEND_API_KEY}`);

    // Use a hardcoded test email or one from args
    const testRecipient = process.argv[2] || 'test@example.com';
    console.log(`Sending test email to: ${testRecipient}`);

    try {
        const result = await emailService.sendEmail(
            testRecipient,
            'Cloudiverse Email Test',
            '<p>This is a test email from the Cloudiverse backend verification script.</p>',
            'NOREPLY'
        );

        if (result) {
            console.log('✅ Email sent successfully:', result);
        } else {
            console.error('❌ Email failed to send (result is null).');
        }
    } catch (err) {
        console.error('❌ Exception sending email:', err);
    }
}

testEmail();
