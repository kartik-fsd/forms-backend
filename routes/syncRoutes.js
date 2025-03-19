// routes/syncRoutes.js
const express = require('express');
const { syncSubmissions, getSyncStatus } = require('../controllers/syncController');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const { syncSubmissionsSchema } = require('../validation/syncValidation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Sync offline submissions
router.post(
    '/',
    validateRequest(syncSubmissionsSchema),
    syncSubmissions
);

// Get sync status
router.get('/status', getSyncStatus);

module.exports = router;