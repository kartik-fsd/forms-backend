const express = require('express');
const authRoutes = require('./authRoutes');
const projectRoutes = require('./projectRoutes');
const formRoutes = require('./formRoutes');
const submissionRoutes = require('./submissionRoutes');
const fileRoutes = require('./fileRoutes');
const syncRoutes = require('./syncRoutes');
const dashboardRoutes = require('./dashboardRoutes');


const router = express.Router();



// Register routes
router.use('/auth', authRoutes);
router.use('/projects', projectRoutes);
router.use('/forms', formRoutes);
router.use('/submissions', submissionRoutes);
router.use('/files', fileRoutes);
router.use('/sync', syncRoutes);
router.use('/dashboard', dashboardRoutes);

module.exports = router;
