// routes/dashboardRoutes.js
const express = require('express');
const {
    getUserDashboardStats,
    getManagerDashboardStats
} = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/authMiddleware');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticate);

// Get dashboard statistics for the current user (FSE)
router.get('/user-stats', getUserDashboardStats);

// Get dashboard statistics for managers
router.get('/manager-stats', hasPermission('view_submission'), getManagerDashboardStats);

// Get detailed performance report
router.get('/performance-report', hasPermission('view_submission'), getPerformanceReport);

// Get leaderboard of field executives
router.get('/leaderboard', getLeaderboard);

module.exports = router;