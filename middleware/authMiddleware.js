// middleware/authMiddleware.js
const jwt = require('jsonwebtoken');
const config = require('../config/config');
const { AppError } = require('../errors/AppError');
const db = require('../database/connection');

/**
 * Authenticate a user's JWT token
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next(new AppError('Authentication required', 401));
    }

    const token = authHeader.split(' ')[1];

    if (!token) {
      return next(new AppError('Invalid token format', 401));
    }

    try {
      // Verify the token
      const decoded = jwt.verify(token, config.jwt.secret);

      // Check if user exists and is active
      const user = await db.query(
        'SELECT id, username, email, first_name, last_name, is_active, role_id FROM users WHERE id = ? AND is_active = 1',
        [decoded.id]
      );

      if (!user || user.length === 0) {
        return next(new AppError('User not found or inactive', 401));
      }

      // Attach user to request object
      req.user = user[0];

      // Get user permissions
      const permissions = await db.query(
        `SELECT p.name 
         FROM permissions p 
         JOIN role_permissions rp ON p.id = rp.permission_id 
         WHERE rp.role_id = ?`,
        [user[0].role_id]
      );

      // Add permissions to user object
      req.user.permissions = permissions.map(p => p.name);

      next();
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return next(new AppError('Token expired', 401));
      }
      return next(new AppError('Invalid token', 401));
    }
  } catch (error) {
    next(error);
  }
};

/**
 * Check if user has required permission
 * @param {string} permission - Required permission
 */
const hasPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user || !req.user.permissions) {
      return next(new AppError('Authentication required', 401));
    }

    if (!req.user.permissions.includes(permission)) {
      return next(new AppError('Access denied', 403));
    }

    next();
  };
};

module.exports = {
  authenticate,
  hasPermission
};
