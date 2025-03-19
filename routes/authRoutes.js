// routes/authRoutes.js
const express = require('express');
const { login, refreshToken, getMe } = require('../controllers/authController');
const { authenticate } = require('../middleware/authMiddleware');
const router = express.Router();

router.post('/login', login);
router.post('/refresh-token', refreshToken);
router.get('/me', authenticate, getMe);

module.exports = router;