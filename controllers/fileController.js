// controllers/fileController.js
const db = require('../database/connection');
const s3Service = require('../services/s3Service');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');
const config = require('../config/config');
const crypto = require('crypto');

/**
 * Generate presigned URL for file upload
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getPresignedUploadUrl = async (req, res, next) => {
    try {
        const {
            fileName,
            contentType,
            projectId,
            formTemplateId,
            submissionUuid,
            fieldName
        } = req.body;

        if (!fileName || !contentType) {
            return next(new AppError('File name and content type are required', 400));
        }

        // Validate file type is allowed
        const allowedTypes = [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf', 'text/csv', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'audio/mpeg', 'audio/mp4', 'audio/wav'
        ];

        if (!allowedTypes.includes(contentType)) {
            return next(new AppError('File type not allowed', 400));
        }

        // Generate a unique file name to prevent collisions
        const fileExtension = fileName.split('.').pop().toLowerCase();
        const randomString = crypto.randomBytes(8).toString('hex');
        const sanitizedFileName = `${crypto.createHash('md5').update(fileName).digest('hex')}-${randomString}.${fileExtension}`;

        // Create S3 object key based on provided metadata
        let objectKey;

        if (submissionUuid) {
            objectKey = `submissions/${formTemplateId || 'forms'}/${submissionUuid}/${fieldName || 'files'}/${sanitizedFileName}`;
        } else if (formTemplateId) {
            objectKey = `forms/${formTemplateId}/uploads/${req.user.id}/${sanitizedFileName}`;
        } else if (projectId) {
            objectKey = `projects/${projectId}/uploads/${req.user.id}/${sanitizedFileName}`;
        } else {
            objectKey = `users/${req.user.id}/uploads/${sanitizedFileName}`;
        }

        // Generate presigned URL
        const presignedUrl = await s3Service.getPresignedUploadUrl(
            config.s3.submissionsBucket,
            objectKey,
            contentType
        );

        res.status(200).json({
            status: 'success',
            data: {
                presignedUrl,
                fileKey: objectKey,
                expiresIn: config.s3.uploadExpiration,
                bucket: config.s3.submissionsBucket
            }
        });
    } catch (error) {
        logger.error('Error generating presigned URL:', error);
        next(error);
    }
};

/**
 * Complete file upload process
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const completeFileUpload = async (req, res, next) => {
    try {
        const { bucket, objectKey, contentType, fileName, fileSize, fieldName, description } = req.body;

        if (!objectKey || !bucket) {
            return next(new AppError('Bucket and object key are required', 400));
        }

        // Verify file exists in S3
        const exists = await s3Service.objectExists(bucket, objectKey);

        if (!exists) {
            return next(new AppError('File not found in S3', 404));
        }

        // Create S3 object record in database
        const objectKeyHash = crypto.createHash('sha256').update(objectKey).digest('hex');

        const s3Objects = await db.query(
            `INSERT INTO s3_objects (
         bucket_name, object_key, object_key_hash, content_type, 
         size_bytes, created_by
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         content_type = VALUES(content_type),
         size_bytes = VALUES(size_bytes),
         created_by = VALUES(created_by)`,
            [
                bucket,
                objectKey,
                objectKeyHash,
                contentType,
                fileSize,
                req.user.id
            ]
        );

        // Get the S3 object ID
        let s3ObjectId;
        if (s3Objects.insertId) {
            s3ObjectId = s3Objects.insertId;
        } else {
            // If it was a duplicate, get the existing ID
            const existingObject = await db.query(
                'SELECT id FROM s3_objects WHERE bucket_name = ? AND object_key_hash = ?',
                [bucket, objectKeyHash]
            );

            if (existingObject.length === 0) {
                return next(new AppError('Failed to retrieve S3 object record', 500));
            }

            s3ObjectId = existingObject[0].id;
        }

        // Generate download URL
        const downloadUrl = await s3Service.getPresignedDownloadUrl(bucket, objectKey);

        res.status(200).json({
            status: 'success',
            data: {
                fileId: s3ObjectId,
                downloadUrl,
                fileName: fileName || objectKey.split('/').pop(),
                fieldName,
                contentType,
                fileSize
            }
        });
    } catch (error) {
        logger.error('Error completing file upload:', error);
        next(error);
    }
};

/**
 * Initiate multipart upload for large files
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const initiateMultipartUpload = async (req, res, next) => {
    try {
        const {
            fileName,
            contentType,
            projectId,
            formTemplateId,
            submissionUuid,
            fieldName,
            parts = 5
        } = req.body;

        if (!fileName || !contentType) {
            return next(new AppError('File name and content type are required', 400));
        }

        // Generate a unique file name to prevent collisions
        const fileExtension = fileName.split('.').pop().toLowerCase();
        const randomString = crypto.randomBytes(8).toString('hex');
        const sanitizedFileName = `${crypto.createHash('md5').update(fileName).digest('hex')}-${randomString}.${fileExtension}`;

        // Create S3 object key
        let objectKey;

        if (submissionUuid) {
            objectKey = `submissions/${formTemplateId || 'forms'}/${submissionUuid}/${fieldName || 'files'}/${sanitizedFileName}`;
        } else if (formTemplateId) {
            objectKey = `forms/${formTemplateId}/uploads/${req.user.id}/${sanitizedFileName}`;
        } else if (projectId) {
            objectKey = `projects/${projectId}/uploads/${req.user.id}/${sanitizedFileName}`;
        } else {
            objectKey = `users/${req.user.id}/uploads/${sanitizedFileName}`;
        }

        // Initiate multipart upload in S3
        const uploadId = await s3Service.initiateMultipartUpload(
            config.s3.submissionsBucket,
            objectKey,
            contentType
        );

        // Generate presigned URLs for each part
        const presignedUrls = [];

        for (let i = 1; i <= parts; i++) {
            const url = await s3Service.getPresignedPartUploadUrl(
                config.s3.submissionsBucket,
                objectKey,
                uploadId,
                i
            );

            presignedUrls.push({
                partNumber: i,
                url
            });
        }

        res.status(200).json({
            status: 'success',
            data: {
                uploadId,
                key: objectKey,
                bucket: config.s3.submissionsBucket,
                presignedUrls,
                expiresIn: config.s3.uploadExpiration
            }
        });
    } catch (error) {
        logger.error('Error initiating multipart upload:', error);
        next(error);
    }
};

/**
 * Complete multipart upload
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const completeMultipartUpload = async (req, res, next) => {
    try {
        const { bucket, key, uploadId, parts, contentType, fileName, fileSize, fieldName } = req.body;

        if (!bucket || !key || !uploadId || !parts || !parts.length) {
            return next(new AppError('Missing required parameters', 400));
        }

        // Complete multipart upload in S3
        const result = await s3Service.completeMultipartUpload(
            bucket,
            key,
            uploadId,
            parts
        );

        // Create S3 object record in database
        const objectKeyHash = crypto.createHash('sha256').update(key).digest('hex');

        const s3Objects = await db.query(
            `INSERT INTO s3_objects (
         bucket_name, object_key, object_key_hash, content_type, 
         size_bytes, object_version_id, etag, created_by
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE 
         content_type = VALUES(content_type),
         size_bytes = VALUES(size_bytes),
         object_version_id = VALUES(object_version_id),
         etag = VALUES(etag),
         created_by = VALUES(created_by)`,
            [
                bucket,
                key,
                objectKeyHash,
                contentType,
                fileSize,
                result.VersionId || null,
                result.ETag ? result.ETag.replace(/"/g, '') : null,
                req.user.id
            ]
        );

        // Get the S3 object ID
        let s3ObjectId;
        if (s3Objects.insertId) {
            s3ObjectId = s3Objects.insertId;
        } else {
            // If it was a duplicate, get the existing ID
            const existingObject = await db.query(
                'SELECT id FROM s3_objects WHERE bucket_name = ? AND object_key_hash = ?',
                [bucket, objectKeyHash]
            );

            if (existingObject.length === 0) {
                return next(new AppError('Failed to retrieve S3 object record', 500));
            }

            s3ObjectId = existingObject[0].id;
        }

        // Generate download URL
        const downloadUrl = await s3Service.getPresignedDownloadUrl(bucket, key);

        res.status(200).json({
            status: 'success',
            data: {
                fileId: s3ObjectId,
                downloadUrl,
                fileName: fileName || key.split('/').pop(),
                fieldName,
                contentType,
                fileSize
            }
        });
    } catch (error) {
        logger.error('Error completing multipart upload:', error);
        next(error);
    }
};

/**
 * Abort multipart upload
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const abortMultipartUpload = async (req, res, next) => {
    try {
        const { bucket, key, uploadId } = req.body;

        if (!bucket || !key || !uploadId) {
            return next(new AppError('Missing required parameters', 400));
        }

        await s3Service.abortMultipartUpload(bucket, key, uploadId);

        res.status(200).json({
            status: 'success',
            message: 'Multipart upload aborted successfully'
        });
    } catch (error) {
        logger.error('Error aborting multipart upload:', error);
        next(error);
    }
};

module.exports = {
    getPresignedUploadUrl,
    completeFileUpload,
    initiateMultipartUpload,
    completeMultipartUpload,
    abortMultipartUpload
};