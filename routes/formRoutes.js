// routes/formRoutes.js
const express = require('express');
const {
    getAllForms,
    getFormById,
    getFormSchema,
    createForm,
    updateForm,
    deleteForm
} = require('../controllers/formController');
const { authenticate, hasPermission } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const { createFormSchema, updateFormSchema } = require('../validation/formValidation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get all forms
router.get('/', getAllForms);

// Get form by ID
router.get('/:id', getFormById);

// Get form schema from S3
router.get('/:id/schema', getFormSchema);

// Create new form (requires create_form permission)
router.post(
    '/',
    hasPermission('create_form'),
    validateRequest(createFormSchema),
    createForm
);

// Update form (requires edit_form permission)
router.put(
    '/:id',
    hasPermission('edit_form'),
    validateRequest(updateFormSchema),
    updateForm
);

// Delete form (requires edit_form permission)
router.delete(
    '/:id',
    hasPermission('edit_form'),
    deleteForm
);

module.exports = router;