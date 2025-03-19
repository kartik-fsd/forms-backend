
// validation/fileValidation.js
const Joi = require('joi');

// Presigned URL validation schema
const presignedUrlSchema = Joi.object({
    fileName: Joi.string().required(),
    contentType: Joi.string().required(),
    projectId: Joi.number().integer().positive(),
    formTemplateId: Joi.number().integer().positive(),
    submissionUuid: Joi.string().uuid(),
    fieldName: Joi.string()
}).or('projectId', 'formTemplateId', 'submissionUuid');

// Complete file validation schema
const completeFileSchema = Joi.object({
    bucket: Joi.string().required(),
    objectKey: Joi.string().required(),
    contentType: Joi.string().required(),
    fileName: Joi.string().required(),
    fileSize: Joi.number().integer().positive(),
    fieldName: Joi.string(),
    description: Joi.string()
});

// Initiate multipart upload validation schema
const initiateMultipartSchema = Joi.object({
    fileName: Joi.string().required(),
    contentType: Joi.string().required(),
    projectId: Joi.number().integer().positive(),
    formTemplateId: Joi.number().integer().positive(),
    submissionUuid: Joi.string().uuid(),
    fieldName: Joi.string(),
    parts: Joi.number().integer().min(1).max(10000).default(5)
}).or('projectId', 'formTemplateId', 'submissionUuid');

/// Complete multipart upload validation schema
const completeMultipartSchema = Joi.object({
    bucket: Joi.string().required(),
    key: Joi.string().required(),
    uploadId: Joi.string().required(),
    parts: Joi.array().items(
        Joi.object({
            ETag: Joi.string().required(),
            PartNumber: Joi.number().integer().positive().required()
        })
    ).min(1).required(),
    contentType: Joi.string().required(),
    fileName: Joi.string(),
    fileSize: Joi.number().integer().positive(),
    fieldName: Joi.string()
});

// Abort multipart upload validation schema
const abortMultipartSchema = Joi.object({
    bucket: Joi.string().required(),
    key: Joi.string().required(),
    uploadId: Joi.string().required()
});

module.exports = {
    presignedUrlSchema,
    completeFileSchema,
    initiateMultipartSchema,
    completeMultipartSchema,
    abortMultipartSchema
};