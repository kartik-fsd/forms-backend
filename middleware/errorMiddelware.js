
// middleware/errorMiddleware.js
const logger = require('../utils/logger');
const { AppError } = require('../errors/AppError');

/**
 * Handle 404 errors
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const notFound = (req, res, next) => {
    const error = new AppError(`Not Found - ${req.originalUrl}`, 404);
    next(error);
};

/**
 * Global error handler
 * @param {Error} err - Error object
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const errorHandler = (err, req, res, next) => {
    // Log the error
    logger.error(err.stack);

    // Set default status code and message
    let statusCode = err.statusCode || 500;
    let message = err.message || 'Something went wrong';

    // Handle validation errors
    if (err.name === 'ValidationError') {
        statusCode = 400;
        message = err.message;
    }

    // Handle database errors
    if (err.code && err.sqlMessage) {
        // SQL error
        statusCode = 500;
        message = 'Database error';

        // Handle common SQL errors
        switch (err.code) {
            case 'ER_DUP_ENTRY':
                statusCode = 409;
                message = 'Duplicate entry';
                break;
            case 'ER_NO_REFERENCED_ROW':
            case 'ER_NO_REFERENCED_ROW_2':
                statusCode = 400;
                message = 'Referenced record does not exist';
                break;
        }
    }

    // Handle other known errors
    if (err.code === 'ECONNREFUSED') {
        message = 'Service unavailable';
        statusCode = 503;
    }

    // Send response
    res.status(statusCode).json({
        status: statusCode >= 500 ? 'error' : 'fail',
        message,
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
};

module.exports = {
    notFound,
    errorHandler
};