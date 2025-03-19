// validation/submissionValidation.js
const Joi = require('joi');

// Create submission validation schema
const createSubmissionSchema = Joi.object({
    uuid: Joi.string().uuid(),
    formTemplateId: Joi.number().integer().positive().required(),
    formTemplateVersion: Joi.number().integer().positive().required(),
    data: Joi.object().required(),
    files: Joi.array().items(
        Joi.object({
            s3ObjectId: Joi.number().integer().positive().required(),
            fieldName: Joi.string().required(),
            fileName: Joi.string().required(),
            description: Joi.string()
        })
    ),
    status: Joi.string().valid('draft', 'submitted').default('draft'),
    geolocationLatitude: Joi.number(),
    geolocationLongitude: Joi.number(),
    geolocationAccuracy: Joi.number(),
    deviceInfo: Joi.object(),
    isOfflineSubmission: Joi.boolean().default(false)
});

// Update submission status validation schema
const updateSubmissionStatusSchema = Joi.object({
    status: Joi.string().valid('draft', 'submitted', 'verified', 'rejected').required(),
    verificationNotes: Joi.string().when('status', {
        is: Joi.string().valid('verified', 'rejected'),
        then: Joi.string().allow(null, ''),
        otherwise: Joi.optional()
    })
});

module.exports = {
    createSubmissionSchema,
    updateSubmissionStatusSchema
};