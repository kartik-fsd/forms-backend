// services/s3Service.js
const {
    GetObjectCommand,
    PutObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    CreateMultipartUploadCommand,
    UploadPartCommand,
    CompleteMultipartUploadCommand,
    AbortMultipartUploadCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const s3Client = require('../config/s3Config');
const config = require('../config/config');
const logger = require('../utils/logger');
const { AppError } = require('../errors/AppError');

/**
 * Get an object from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @returns {Promise<string>} - Object data as string
 */
const getObject = async (bucket, key) => {
    try {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });

        const response = await s3Client.send(command);

        // Convert readable stream to string
        return streamToString(response.Body);
    } catch (error) {
        logger.error('Error getting object from S3:', error);
        throw new AppError(`Failed to retrieve object from S3: ${error.message}`, 500);
    }
};

/**
 * Put an object to S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string|Buffer} body - Object content
 * @param {string} contentType - Content type
 * @returns {Promise<Object>} - S3 response
 */
const putObject = async (bucket, key, body, contentType) => {
    try {
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            Body: body,
            ContentType: contentType
        });

        return await s3Client.send(command);
    } catch (error) {
        logger.error('Error putting object to S3:', error);
        throw new AppError(`Failed to upload object to S3: ${error.message}`, 500);
    }
};

/**
 * Delete an object from S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @returns {Promise<Object>} - S3 response
 */
const deleteObject = async (bucket, key) => {
    try {
        const command = new DeleteObjectCommand({
            Bucket: bucket,
            Key: key
        });

        return await s3Client.send(command);
    } catch (error) {
        logger.error('Error deleting object from S3:', error);
        throw new AppError(`Failed to delete object from S3: ${error.message}`, 500);
    }
};

/**
 * Check if an object exists in S3
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @returns {Promise<boolean>} - True if object exists
 */
const objectExists = async (bucket, key) => {
    try {
        const command = new HeadObjectCommand({
            Bucket: bucket,
            Key: key
        });

        await s3Client.send(command);
        return true;
    } catch (error) {
        if (error.name === 'NotFound') {
            return false;
        }
        throw error;
    }
};

/**
 * Generate a presigned URL for uploading a file
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string} contentType - Content type
 * @param {number} expiresIn - URL expiration in seconds
 * @returns {Promise<string>} - Presigned URL
 */
const getPresignedUploadUrl = async (bucket, key, contentType, expiresIn = config.s3.uploadExpiration) => {
    try {
        const command = new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType
        });

        return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
        logger.error('Error generating presigned URL:', error);
        throw new AppError(`Failed to generate upload URL: ${error.message}`, 500);
    }
};

/**
 * Generate a presigned URL for downloading a file
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {number} expiresIn - URL expiration in seconds
 * @returns {Promise<string>} - Presigned URL
 */
const getPresignedDownloadUrl = async (bucket, key, expiresIn = 3600) => {
    try {
        const command = new GetObjectCommand({
            Bucket: bucket,
            Key: key
        });

        return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
        logger.error('Error generating presigned download URL:', error);
        throw new AppError(`Failed to generate download URL: ${error.message}`, 500);
    }
};

/**
 * Initiate a multipart upload
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string} contentType - Content type
 * @returns {Promise<string>} - Upload ID
 */
const initiateMultipartUpload = async (bucket, key, contentType) => {
    try {
        const command = new CreateMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            ContentType: contentType
        });

        const { UploadId } = await s3Client.send(command);
        return UploadId;
    } catch (error) {
        logger.error('Error initiating multipart upload:', error);
        throw new AppError(`Failed to initiate multipart upload: ${error.message}`, 500);
    }
};

/**
 * Generate a presigned URL for uploading a part
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string} uploadId - Upload ID
 * @param {number} partNumber - Part number
 * @param {number} expiresIn - URL expiration in seconds
 * @returns {Promise<string>} - Presigned URL
 */
const getPresignedPartUploadUrl = async (bucket, key, uploadId, partNumber, expiresIn = config.s3.uploadExpiration) => {
    try {
        const command = new UploadPartCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            PartNumber: partNumber
        });

        return await getSignedUrl(s3Client, command, { expiresIn });
    } catch (error) {
        logger.error('Error generating presigned part upload URL:', error);
        throw new AppError(`Failed to generate part upload URL: ${error.message}`, 500);
    }
};

/**
 * Complete a multipart upload
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string} uploadId - Upload ID
 * @param {Array} parts - List of parts with ETag and PartNumber
 * @returns {Promise<Object>} - S3 response
 */
const completeMultipartUpload = async (bucket, key, uploadId, parts) => {
    try {
        const command = new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
                Parts: parts
            }
        });

        return await s3Client.send(command);
    } catch (error) {
        logger.error('Error completing multipart upload:', error);
        throw new AppError(`Failed to complete multipart upload: ${error.message}`, 500);
    }
};

/**
 * Abort a multipart upload
 * @param {string} bucket - S3 bucket name
 * @param {string} key - Object key
 * @param {string} uploadId - Upload ID
 * @returns {Promise<Object>} - S3 response
 */
const abortMultipartUpload = async (bucket, key, uploadId) => {
    try {
        const command = new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId
        });

        return await s3Client.send(command);
    } catch (error) {
        logger.error('Error aborting multipart upload:', error);
        throw new AppError(`Failed to abort multipart upload: ${error.message}`, 500);
    }
};

/**
 * Convert a readable stream to string
 * @param {ReadableStream} stream - Readable stream
 * @returns {Promise<string>} - Stream content as string
 */
const streamToString = (stream) => {
    return new Promise((resolve, reject) => {
        const chunks = [];
        stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err) => reject(err));
        stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
};

module.exports = {
    getObject,
    putObject,
    deleteObject,
    objectExists,
    getPresignedUploadUrl,
    getPresignedDownloadUrl,
    initiateMultipartUpload,
    getPresignedPartUploadUrl,
    completeMultipartUpload,
    abortMultipartUpload
};