// routes/fileRoutes.js
const express = require('express');
const {
    initiateMultipartUpload,
    completeMultipartUpload,
    abortMultipartUpload
} = require('../controllers/fileController');
const { authenticate } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const {
    presignedUrlSchema,
    completeFileSchema,
    initiateMultipartSchema,
    completeMultipartSchema,
    abortMultipartSchema
} = require('../validation/fileValidation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get presigned URL for file upload
router.post(
    '/multipart/initiate',
    validateRequest(initiateMultipartSchema),
    initiateMultipartUpload
);

// Complete multipart upload
router.post(
    '/multipart/complete',
    validateRequest(completeMultipartSchema),
    completeMultipartUpload
);

// Abort multipart upload
router.post(
    '/multipart/abort',
    validateRequest(abortMultipartSchema),
    abortMultipartUpload
);

module.exports = router;
