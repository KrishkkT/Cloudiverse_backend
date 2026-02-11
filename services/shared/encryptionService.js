const crypto = require('crypto');

// Use a dedicated key from env, or fall back to a derived key from JWT_SECRET (not recommended for prod but functional for now)
// Ideally, ENCRYPTION_KEY should be 32 bytes (64 hex chars)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || crypto.createHash('sha256').update(process.env.JWT_SECRET || 'fallback-secret').digest('hex').substring(0, 64);
const IV_LENGTH = 16; // For AES, this is always 16

const encrypt = (text) => {
    if (!text) return null;
    try {
        const iv = crypto.randomBytes(IV_LENGTH);
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        const authTag = cipher.getAuthTag();
        return iv.toString('hex') + ':' + encrypted.toString('hex') + ':' + authTag.toString('hex');
    } catch (error) {
        console.error('Encryption failed:', error);
        return null;
    }
};

const decrypt = (text) => {
    if (!text) return null;
    try {
        const textParts = text.split(':');
        if (textParts.length !== 3) return null; // Invalid format
        const iv = Buffer.from(textParts[0], 'hex');
        const encryptedText = Buffer.from(textParts[1], 'hex');
        const authTag = Buffer.from(textParts[2], 'hex');
        const key = Buffer.from(ENCRYPTION_KEY, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
        decipher.setAuthTag(authTag);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
};

module.exports = { encrypt, decrypt };
