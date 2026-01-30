const express = require('express');
const router = express.Router();
const aiService = require('../services/ai/aiService');

/**
 * POST /api/ai/enhance-requirements
 * Body: { text: string }
 */
router.post('/enhance-requirements', async (req, res) => {
    const { text } = req.body;

    if (!text || typeof text !== 'string') {
        return res.status(400).json({ error: 'Valid text input is required.' });
    }

    // Basic abuse prevention
    if (text.length > 2000) {
        return res.status(400).json({ error: 'Input text is too long (max 2000 characters).' });
    }

    try {
        const enhancedText = await aiService.enhanceRequirements(text);
        res.json({ original: text, enhanced: enhancedText });
    } catch (error) {
        console.error('AI Enhance Route Error:', error);
        res.status(500).json({ error: 'Failed to enhance requirements.' });
    }
});

module.exports = router;
