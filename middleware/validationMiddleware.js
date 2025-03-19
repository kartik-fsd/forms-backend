// middleware/validationMiddleware.js
const { AppError } = require('../errors/AppError');

/**
 * Validate request body against a Joi schema
 * @param {Object} schema - Joi validation schema
 * @returns {Function} - Express middleware
 */
const validateRequest = (schema) => {
    return (req, res, next) => {
        if (!schema) return next();

        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const message = error.details.map(detail => detail.message).join(', ');
            return next(new AppError(message, 400));
        }

        // Replace request body with validated data
        req.body = value;
        next();
    };
};

/**
 * Validate request query parameters against a Joi schema
 * @param {Object} schema - Joi validation schema
 * @returns {Function} - Express middleware
 */
const validateQuery = (schema) => {
    return (req, res, next) => {
        if (!schema) return next();

        const { error, value } = schema.validate(req.query, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const message = error.details.map(detail => detail.message).join(', ');
            return next(new AppError(message, 400));
        }

        // Replace request query with validated data
        req.query = value;
        next();
    };
};

/**
 * Validate request parameters against a Joi schema
 * @param {Object} schema - Joi validation schema
 * @returns {Function} - Express middleware
 */
const validateParams = (schema) => {
    return (req, res, next) => {
        if (!schema) return next();

        const { error, value } = schema.validate(req.params, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const message = error.details.map(detail => detail.message).join(', ');
            return next(new AppError(message, 400));
        }

        // Replace request params with validated data
        req.params = value;
        next();
    };
};

module.exports = {
    validateRequest,
    validateQuery,
    validateParams
};