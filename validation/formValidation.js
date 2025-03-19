// validation/formValidation.js
const Joi = require('joi');

// Create form validation schema
const createFormSchema = Joi.object({
    projectId: Joi.number().integer().positive().required(),
    name: Joi.string().min(3).max(100).required(),
    description: Joi.string().allow(null, ''),
    schema: Joi.alternatives().try(
        Joi.string(),
        Joi.object()
    ).required()
});

// Update form validation schema
const updateFormSchema = Joi.object({
    name: Joi.string().min(3).max(100),
    description: Joi.string().allow(null, ''),
    isActive: Joi.boolean(),
    schema: Joi.alternatives().try(
        Joi.string(),
        Joi.object()
    ),
    changesDescription: Joi.string().when('schema', {
        is: Joi.exist(),
        then: Joi.required(),
        otherwise: Joi.optional()
    })
}).min(1);

module.exports = {
    createFormSchema,
    updateFormSchema
};