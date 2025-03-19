// routes/projectRoutes.js
const express = require('express');
const {
    getAllProjects,
    getProjectById,
    createProject,
    updateProject,
    deleteProject,
    assignUsers,
    removeUser
} = require('../controllers/projectController');
const { authenticate, hasPermission } = require('../middleware/authMiddleware');
const { validateRequest } = require('../middleware/validationMiddleware');
const {
    createProjectSchema,
    updateProjectSchema,
    assignUsersSchema
} = require('../validation/projectValidation');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get all projects
router.get('/', getAllProjects);

// Get project by ID
router.get('/:id', getProjectById);

// Create project (requires create_project permission)
router.post(
    '/',
    hasPermission('create_project'),
    validateRequest(createProjectSchema),
    createProject
);

// Update project (requires edit_project permission)
router.put(
    '/:id',
    hasPermission('edit_project'),
    validateRequest(updateProjectSchema),
    updateProject
);

// Delete project (requires create_project permission)
router.delete(
    '/:id',
    hasPermission('create_project'),
    deleteProject
);

// Assign users to project (requires edit_project permission)
router.post(
    '/:id/users',
    hasPermission('edit_project'),
    validateRequest(assignUsersSchema),
    assignUsers
);

// Remove user from project (requires edit_project permission)
router.delete(
    '/:id/users/:userId',
    hasPermission('edit_project'),
    removeUser
);

module.exports = router;