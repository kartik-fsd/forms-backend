const express = require('express');
const {
    createSubmission,
    getSubmissionById,
    getAllSubmissions,
    updateSubmissionStatus
} = require('../controllers/submissionControllers');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const {
    createSubmissionSchema,
    updateSubmissionStatusSchema
} = require('../validation/submissionValidation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Create submission
router.post(
    '/',
    validateRequest(createSubmissionSchema),
    createSubmission
);

// Get all submissions
router.get('/', getAllSubmissions);

// Get submission by ID
router.get('/:id', getSubmissionById);

// Update submission status
router.put(
    '/:id/status',
    validateRequest(updateSubmissionStatusSchema),
    updateSubmissionStatus
);

module.exports = router;