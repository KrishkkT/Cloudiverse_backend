const express = require('express');
const router = express.Router();
const architectureController = require('../controllers/architectureController');

// Validate service removal
router.post('/validate-removal', architectureController.validateRemoval);

// Reconcile architecture (future)
router.post('/reconcile', architectureController.reconcile);

module.exports = router;
