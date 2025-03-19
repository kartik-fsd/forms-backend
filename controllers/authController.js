// controllers/authController.js
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const db = require('../database/connection');
const { AppError } = require('../errors/AppError');

/**
 * Generate JWT tokens
 * @param {Object} user - User data
 * @returns {Object} - Access and refresh tokens
 */
const generateTokens = (user) => {
    const accessToken = jwt.sign(
        { id: user.id, username: user.username },
        config.jwt.secret,
        { expiresIn: config.jwt.accessExpiresIn }
    );

    const refreshToken = jwt.sign(
        { id: user.id },
        config.jwt.secret,
        { expiresIn: config.jwt.refreshExpiresIn }
    );

    return { accessToken, refreshToken };
};

/**
 * Login user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const login = async (req, res, next) => {
    try {
        const { username, password, deviceId } = req.body;

        if (!username || !password) {
            return next(new AppError('Username and password are required', 400));
        }

        // Get user from database
        const users = await db.query(
            'SELECT id, username, email, password_hash, first_name, last_name, is_active, role_id FROM users WHERE username = ? OR email = ?',
            [username, username]
        );

        // Check if user exists
        if (users.length === 0) {
            return next(new AppError('Invalid credentials', 401));
        }

        const user = users[0];

        // Check if user is active
        if (!user.is_active) {
            return next(new AppError('User account is inactive', 401));
        }

        // Verify password
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);

        if (!isPasswordValid) {
            return next(new AppError('Invalid credentials', 401));
        }

        // Generate tokens
        const { accessToken, refreshToken } = generateTokens(user);

        // Update last login and device id if provided
        if (deviceId) {
            await db.query(
                'UPDATE users SET last_login_at = NOW(), device_id = ? WHERE id = ?',
                [deviceId, user.id]
            );
        } else {
            await db.query(
                'UPDATE users SET last_login_at = NOW() WHERE id = ?',
                [user.id]
            );
        }

        // Get user permissions
        const permissions = await db.query(
            `SELECT p.name 
       FROM permissions p 
       JOIN role_permissions rp ON p.id = rp.permission_id 
       WHERE rp.role_id = ?`,
            [user.role_id]
        );

        // Response
        res.status(200).json({
            status: 'success',
            data: {
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    firstName: user.first_name,
                    lastName: user.last_name,
                    permissions: permissions.map(p => p.name)
                },
                tokens: {
                    accessToken,
                    refreshToken
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Refresh access token
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const refreshToken = async (req, res, next) => {
    try {
        const { refreshToken } = req.body;

        if (!refreshToken) {
            return next(new AppError('Refresh token is required', 400));
        }

        try {
            // Verify refresh token
            const decoded = jwt.verify(refreshToken, config.jwt.secret);

            // Get user from database
            const users = await db.query(
                'SELECT id, username, email, first_name, last_name FROM users WHERE id = ? AND is_active = 1',
                [decoded.id]
            );

            if (users.length === 0) {
                return next(new AppError('Invalid token', 401));
            }

            const user = users[0];

            // Generate new tokens
            const tokens = generateTokens(user);

            // Response
            res.status(200).json({
                status: 'success',
                data: {
                    tokens
                }
            });
        } catch (error) {
            return next(new AppError('Invalid or expired token', 401));
        }
    } catch (error) {
        next(error);
    }
};

/**
 * Get current user info
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getMe = async (req, res, next) => {
    try {
        // User data is already attached to req.user by auth middleware
        res.status(200).json({
            status: 'success',
            data: {
                user: {
                    id: req.user.id,
                    username: req.user.username,
                    email: req.user.email,
                    firstName: req.user.first_name,
                    lastName: req.user.last_name,
                    permissions: req.user.permissions
                }
            }
        });
    } catch (error) {
        next(error);
    }
};

module.exports = {
    login,
    refreshToken,
    getMe
};

