// controllers/syncController.js
const db = require('../database/connection');
const { executeTransaction } = require('../database/transaction');
const s3Service = require('../services/s3Service');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Synchronize offline form submissions
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const syncSubmissions = async (req, res, next) => {
    try {
        const { deviceId, submissions = [] } = req.body;

        if (!deviceId) {
            return next(new AppError('Device ID is required', 400));
        }

        if (!submissions.length) {
            return res.status(200).json({
                status: 'success',
                message: 'No submissions to sync',
                data: {
                    synced: 0,
                    errors: 0,
                    results: []
                }
            });
        }

        // Update device ID for the user if provided
        await db.query(
            'UPDATE users SET device_id = ?, last_sync_at = NOW() WHERE id = ?',
            [deviceId, req.user.id]
        );

        const results = [];
        let syncedCount = 0;
        let errorCount = 0;

        // Process each submission
        for (const submission of submissions) {
            try {
                // Check if submission with this UUID already exists
                const existingSubmission = await db.query(
                    'SELECT id FROM form_submissions WHERE uuid = ?',
                    [submission.uuid]
                );

                if (existingSubmission.length > 0) {
                    // Skip this submission as it already exists
                    results.push({
                        uuid: submission.uuid,
                        status: 'skipped',
                        message: 'Submission with this UUID already exists',
                        serverId: existingSubmission[0].id
                    });
                    continue;
                }

                // Validate form template exists
                const formTemplate = await db.query(
                    'SELECT id, project_id FROM form_templates WHERE id = ?',
                    [submission.formTemplateId]
                );

                if (formTemplate.length === 0) {
                    results.push({
                        uuid: submission.uuid,
                        status: 'error',
                        message: 'Form template not found'
                    });
                    errorCount++;
                    continue;
                }

                // Check if form version exists
                const formVersion = await db.query(
                    'SELECT version FROM form_template_versions WHERE form_template_id = ? AND version = ?',
                    [submission.formTemplateId, submission.formTemplateVersion]
                );

                if (formVersion.length === 0) {
                    results.push({
                        uuid: submission.uuid,
                        status: 'error',
                        message: 'Form template version not found'
                    });
                    errorCount++;
                    continue;
                }

                // Get connection for transaction
                const connection = await db.getConnection();

                try {
                    await connection.beginTransaction();

                    // Upload form data to S3
                    const objectKey = `submissions/${submission.formTemplateId}/${submission.uuid}.json`;

                    await s3Service.putObject(
                        config.s3.submissionsBucket,
                        objectKey,
                        JSON.stringify(submission.data),
                        'application/json'
                    );

                    // Create S3 object record for data
                    const [s3ObjectResult] = await connection.execute(
                        `INSERT INTO s3_objects (
               bucket_name, object_key, object_key_hash, content_type, 
               size_bytes, created_by
             ) VALUES (?, ?, SHA2(?, 256), ?, ?, ?)`,
                        [
                            config.s3.submissionsBucket,
                            objectKey,
                            objectKey,
                            'application/json',
                            Buffer.byteLength(JSON.stringify(submission.data)),
                            req.user.id
                        ]
                    );

                    const dataS3ObjectId = s3ObjectResult.insertId;

                    // Set submitted_at if submission is not a draft
                    const submittedAt = submission.status !== 'draft' ? new Date() : null;

                    // Insert form submission
                    const [submissionResult] = await connection.execute(
                        `INSERT INTO form_submissions (
               uuid, form_template_id, form_template_version, submitted_by,
               status, submitted_at, data_s3_object_id, 
               geolocation_latitude, geolocation_longitude, geolocation_accuracy,
               device_info, is_offline_submission, synced_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
                        [
                            submission.uuid,
                            submission.formTemplateId,
                            submission.formTemplateVersion,
                            req.user.id,
                            submission.status,
                            submittedAt,
                            dataS3ObjectId,
                            submission.geolocation?.latitude || null,
                            submission.geolocation?.longitude || null,
                            submission.geolocation?.accuracy || null,
                            submission.deviceInfo ? JSON.stringify(submission.deviceInfo) : null
                        ]
                    );

                    const submissionId = submissionResult.insertId;

                    // Process attached files if any
                    if (submission.files && submission.files.length > 0) {
                        for (const file of submission.files) {
                            // Skip if no S3 object ID
                            if (!file.s3ObjectId) {
                                continue;
                            }

                            await connection.execute(
                                `INSERT INTO form_submission_files (
                   form_submission_id, field_name, file_s3_object_id,
                   file_name, file_description
                 ) VALUES (?, ?, ?, ?, ?)`,
                                [
                                    submissionId,
                                    file.fieldName,
                                    file.s3ObjectId,
                                    file.fileName,
                                    file.description || null
                                ]
                            );
                        }
                    }

                    // Log activity
                    await connection.execute(
                        `INSERT INTO activity_logs (
               user_id, activity_type, entity_type, entity_id,
               details, ip_address
             ) VALUES (?, ?, ?, ?, ?, ?)`,
                        [
                            req.user.id,
                            'sync_submission',
                            'form_submissions',
                            submissionId,
                            JSON.stringify({
                                device_id: deviceId,
                                form_template_id: submission.formTemplateId,
                                uuid: submission.uuid
                            }),
                            req.ip
                        ]
                    );

                    // Add to sync queue with completed status
                    await connection.execute(
                        `INSERT INTO sync_queue (
               user_id, device_id, entity_type, operation, local_id,
               server_id, data, status
             ) VALUES (?, ?, ?, ?, ?, ?, ?, 'completed')`,
                        [
                            req.user.id,
                            deviceId,
                            'form_submissions',
                            'create',
                            submission.uuid,
                            submissionId,
                            JSON.stringify({
                                uuid: submission.uuid,
                                form_template_id: submission.formTemplateId,
                                status: submission.status
                            })
                        ]
                    );

                    await connection.commit();

                    // Add to results
                    results.push({
                        uuid: submission.uuid,
                        status: 'success',
                        message: 'Submission synced successfully',
                        serverId: submissionId
                    });

                    syncedCount++;
                } catch (error) {
                    await connection.rollback();

                    // Log the error
                    logger.error(`Error syncing submission ${submission.uuid}:`, error);

                    // Add to sync queue with failed status
                    await db.query(
                        `INSERT INTO sync_queue (
               user_id, device_id, entity_type, operation, local_id,
               data, status, error_message
             ) VALUES (?, ?, 'form_submissions', 'create', ?, ?, 'failed', ?)`,
                        [
                            req.user.id,
                            deviceId,
                            submission.uuid,
                            JSON.stringify({
                                uuid: submission.uuid,
                                form_template_id: submission.formTemplateId,
                                status: submission.status
                            }),
                            error.message
                        ]
                    );

                    // Add to results
                    results.push({
                        uuid: submission.uuid,
                        status: 'error',
                        message: `Error: ${error.message}`
                    });

                    errorCount++;
                } finally {
                    connection.release();
                }
            } catch (error) {
                logger.error(`Error processing submission ${submission.uuid}:`, error);

                results.push({
                    uuid: submission.uuid,
                    status: 'error',
                    message: `Error: ${error.message}`
                });

                errorCount++;
            }
        }

        res.status(200).json({
            status: 'success',
            data: {
                synced: syncedCount,
                errors: errorCount,
                results
            }
        });
    } catch (error) {
        logger.error('Error in sync submissions:', error);
        next(error);
    }
};

/**
 * Get sync status and queue
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getSyncStatus = async (req, res, next) => {
    try {
        const { deviceId } = req.query;

        if (!deviceId) {
            return next(new AppError('Device ID is required', 400));
        }

        // Get user's last sync time
        const users = await db.query(
            'SELECT last_sync_at FROM users WHERE id = ? AND device_id = ?',
            [req.user.id, deviceId]
        );

        // Get pending sync items
        const pendingItems = await db.query(
            `SELECT id, entity_type, operation, local_id, server_id, 
              status, error_message, retry_count, created_at, updated_at
       FROM sync_queue
       WHERE user_id = ? AND device_id = ? AND status IN ('pending', 'failed')
       ORDER BY created_at DESC`,
            [req.user.id, deviceId]
        );

        // Get recently completed sync items (last 24 hours)
        const completedItems = await db.query(
            `SELECT id, entity_type, operation, local_id, server_id, status, created_at, updated_at
       FROM sync_queue
       WHERE user_id = ? AND device_id = ? AND status = 'completed'
       AND updated_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
       ORDER BY updated_at DESC
       LIMIT 50`,
            [req.user.id, deviceId]
        );

        res.status(200).json({
            status: 'success',
            data: {
                lastSync: users.length > 0 ? users[0].last_sync_at : null,
                pendingCount: pendingItems.length,
                pendingItems,
                completedItems
            }
        });
    } catch (error) {
        logger.error('Error getting sync status:', error);
        next(error);
    }
};

module.exports = {
    syncSubmissions,
    getSyncStatus
};