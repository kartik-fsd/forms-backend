// validation/authValidation.js
const Joi = require('joi');

// Login validation schema
const loginSchema = Joi.object({
    username: Joi.string().required(),
    password: Joi.string().required(),
    deviceId: Joi.string().allow(null, '')
});

// Refresh token validation schema
const refreshTokenSchema = Joi.object({
    refreshToken: Joi.string().required()
});

module.exports = {
    loginSchema,
    refreshTokenSchema
};