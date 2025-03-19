// validation/syncValidation.js
const Joi = require('joi');

// Sync submissions validation schema
const syncSubmissionsSchema = Joi.object({
    deviceId: Joi.string().required(),
    submissions: Joi.array().items(
        Joi.object({
            uuid: Joi.string().uuid().required(),
            formTemplateId: Joi.number().integer().positive().required(),
            formTemplateVersion: Joi.number().integer().positive().required(),
            status: Joi.string().valid('draft', 'submitted', 'verified', 'rejected').default('draft'),
            data: Joi.object().required(),
            files: Joi.array().items(
                Joi.object({
                    s3ObjectId: Joi.number().integer().positive().required(),
                    fieldName: Joi.string().required(),
                    fileName: Joi.string().required(),
                    description: Joi.string()
                })
            ),
            geolocation: Joi.object({
                latitude: Joi.number().required(),
                longitude: Joi.number().required(),
                accuracy: Joi.number()
            }),
            deviceInfo: Joi.object()
        })
    ).min(1).required()
});

module.exports = {
    syncSubmissionsSchema
};