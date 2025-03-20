// validation/projectValidation.js
const Joi = require('joi');

// Create project validation schema
const createProjectSchema = Joi.object({
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().allow(null, ''),
    startDate: Joi.date().required(),
    endDate: Joi.date().allow(null).min(Joi.ref('startDate')),
    isActive: Joi.boolean().default(true),
    isPublic: Joi.boolean().default(false),
    assignedUserIds: Joi.array().items(Joi.number().integer().positive()).default([])
});

// Update project validation schema
const updateProjectSchema = Joi.object({
    name: Joi.string().min(3).max(100),
    description: Joi.string().allow(null, ''),
    startDate: Joi.date(),
    endDate: Joi.date().allow(null).min(Joi.ref('startDate')),
    isActive: Joi.boolean(),
    isPublic: Joi.boolean()
}).min(1);

// Assign users validation schema
const assignUsersSchema = Joi.object({
    userIds: Joi.array().items(Joi.number().integer().positive()).min(1).required()
});

module.exports = {
    createProjectSchema,
    updateProjectSchema,
    assignUsersSchema
};