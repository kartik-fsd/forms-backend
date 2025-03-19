// controllers/submissionController.js
const db = require('../database/connection');
const s3Service = require('../services/s3Service');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');
const config = require('../config/config');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a form submission
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const createSubmission = async (req, res, next) => {
    try {
        const {
            uuid = uuidv4(),
            formTemplateId,
            formTemplateVersion,
            data,
            files = [],
            status = 'draft',
            geolocationLatitude,
            geolocationLongitude,
            geolocationAccuracy,
            deviceInfo,
            isOfflineSubmission = false
        } = req.body;

        // Validate form template exists
        const forms = await db.query(
            'SELECT id, project_id, version FROM form_templates WHERE id = ?',
            [formTemplateId]
        );

        if (forms.length === 0) {
            return next(new AppError('Form template not found', 404));
        }

        const form = forms[0];

        // Verify form version exists
        const versions = await db.query(
            'SELECT version FROM form_template_versions WHERE form_template_id = ? AND version = ?',
            [formTemplateId, formTemplateVersion]
        );

        if (versions.length === 0) {
            return next(new AppError('Form template version not found', 404));
        }

        // Check user access
        if (!req.user.permissions.includes('create_project')) {
            const userProjects = await db.query(
                'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
                [form.project_id, req.user.id]
            );

            if (userProjects.length === 0) {
                return next(new AppError('Access denied', 403));
            }
        }

        // Execute within a transaction
        const result = await executeTransaction(db, async (connection) => {
            // Upload data to S3
            const objectKey = `submissions/${formTemplateId}/${uuid}.json`;
            await s3Service.putObject(
                config.s3.submissionsBucket,
                objectKey,
                JSON.stringify(data),
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
                    Buffer.byteLength(JSON.stringify(data)),
                    req.user.id
                ]
            );

            const dataS3ObjectId = s3ObjectResult.insertId;

            // Create submission record
            const submittedAt = status === 'draft' ? null : new Date();
            const syncedAt = isOfflineSubmission ? new Date() : null;

            const [submissionResult] = await connection.execute(
                `INSERT INTO form_submissions (
                   uuid, form_template_id, form_template_version, submitted_by,
                   status, submitted_at, data_s3_object_id, 
                   geolocation_latitude, geolocation_longitude, geolocation_accuracy,
                   device_info, is_offline_submission, synced_at
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    uuid,
                    formTemplateId,
                    formTemplateVersion,
                    req.user.id,
                    status,
                    submittedAt,
                    dataS3ObjectId,
                    geolocationLatitude || null,
                    geolocationLongitude || null,
                    geolocationAccuracy || null,
                    deviceInfo ? JSON.stringify(deviceInfo) : null,
                    isOfflineSubmission ? 1 : 0,
                    syncedAt
                ]
            );

            const submissionId = submissionResult.insertId;

            // Add file references if any
            if (files.length > 0) {
                for (const file of files) {
                    if (!file.s3ObjectId) continue;

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

            // Log the activity
            await connection.execute(
                `INSERT INTO activity_logs (
                   user_id, activity_type, entity_type, entity_id,
                   details, ip_address
                 ) VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    req.user.id,
                    'form_submission',
                    'form_submissions',
                    submissionId,
                    JSON.stringify({
                        project_id: form.project_id,
                        form_template_id: formTemplateId,
                        action: status
                    }),
                    req.ip
                ]
            );

            return {
                submissionId,
                uuid,
                formTemplateId,
                formTemplateVersion,
                status,
                submittedAt
            };
        });

        res.status(201).json({
            status: 'success',
            data: { submission: result }
        });
    } catch (error) {
        logger.error('Error creating form submission:', error);
        next(error);
    }
};

/**
 * Get a form submission by ID
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getSubmissionById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get submission details
        const submissions = await db.query(
            `SELECT fs.id, fs.uuid, fs.form_template_id, fs.form_template_version,
              fs.submitted_by, fs.status, fs.submitted_at, fs.verified_at,
              fs.verified_by, fs.data_s3_object_id, fs.verification_notes,
              fs.geolocation_latitude, fs.geolocation_longitude, 
              fs.geolocation_accuracy, fs.device_info, fs.is_offline_submission,
              fs.synced_at, fs.created_at, fs.updated_at,
              ft.name as form_name, ft.project_id,
              s.bucket_name, s.object_key,
              u1.first_name as submitter_first_name, u1.last_name as submitter_last_name,
              u2.first_name as verifier_first_name, u2.last_name as verifier_last_name
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       JOIN s3_objects s ON fs.data_s3_object_id = s.id
       JOIN users u1 ON fs.submitted_by = u1.id
       LEFT JOIN users u2 ON fs.verified_by = u2.id
       WHERE fs.id = ?`,
            [id]
        );

        if (submissions.length === 0) {
            return next(new AppError('Submission not found', 404));
        }

        const submission = submissions[0];

        // Check user access to this project
        if (!req.user.permissions.includes('create_project') &&
            submission.submitted_by !== req.user.id) {
            const userProjects = await db.query(
                'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
                [submission.project_id, req.user.id]
            );

            if (userProjects.length === 0) {
                return next(new AppError('Access denied', 403));
            }
        }

        // Get form data from S3
        const formData = await s3Service.getObject(submission.bucket_name, submission.object_key);
        let data;
        try {
            data = JSON.parse(formData);
        } catch (error) {
            logger.error('Error parsing form data:', error);
            data = null;
        }

        // Get attached files
        const files = await db.query(
            `SELECT fsf.id, fsf.field_name, fsf.file_name, fsf.file_description,
              s.bucket_name, s.object_key, s.content_type
       FROM form_submission_files fsf
       JOIN s3_objects s ON fsf.file_s3_object_id = s.id
       WHERE fsf.form_submission_id = ?`,
            [id]
        );

        // Generate presigned URLs for files if any
        const filesWithUrls = await Promise.all(
            files.map(async (file) => {
                const url = await s3Service.getPresignedDownloadUrl(
                    file.bucket_name,
                    file.object_key
                );

                return {
                    ...file,
                    downloadUrl: url
                };
            })
        );

        // Format response
        const formattedSubmission = {
            id: submission.id,
            uuid: submission.uuid,
            formTemplate: {
                id: submission.form_template_id,
                name: submission.form_name,
                version: submission.form_template_version
            },
            status: submission.status,
            data,
            files: filesWithUrls,
            submittedBy: {
                id: submission.submitted_by,
                name: `${submission.submitter_first_name} ${submission.submitter_last_name}`
            },
            verifiedBy: submission.verified_by ? {
                id: submission.verified_by,
                name: `${submission.verifier_first_name} ${submission.verifier_last_name}`
            } : null,
            verificationNotes: submission.verification_notes,
            geolocation: submission.geolocation_latitude ? {
                latitude: submission.geolocation_latitude,
                longitude: submission.geolocation_longitude,
                accuracy: submission.geolocation_accuracy
            } : null,
            deviceInfo: submission.device_info ? JSON.parse(submission.device_info) : null,
            isOfflineSubmission: Boolean(submission.is_offline_submission),
            timestamps: {
                submitted: submission.submitted_at,
                verified: submission.verified_at,
                synced: submission.synced_at,
                created: submission.created_at,
                updated: submission.updated_at
            }
        };

        res.status(200).json({
            status: 'success',
            data: {
                submission: formattedSubmission
            }
        });
    } catch (error) {
        logger.error('Error getting form submission:', error);
        next(error);
    }
};

/**
 * Get all form submissions
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getAllSubmissions = async (req, res, next) => {
    try {
        const {
            formTemplateId,
            projectId,
            status,
            page = 1,
            limit = 20,
            submittedBy,
            startDate,
            endDate
        } = req.query;

        // Build the query
        let sql = `
      SELECT fs.id, fs.uuid, fs.form_template_id, fs.form_template_version,
             fs.status, fs.submitted_at, fs.verified_at,
             ft.name as form_name, p.name as project_name,
             u1.first_name as submitter_first_name, u1.last_name as submitter_last_name
      FROM form_submissions fs
      JOIN form_templates ft ON fs.form_template_id = ft.id
      JOIN projects p ON ft.project_id = p.id
      JOIN users u1 ON fs.submitted_by = u1.id
      WHERE 1=1
    `;

        const countSql = `
      SELECT COUNT(*) as total
      FROM form_submissions fs
      JOIN form_templates ft ON fs.form_template_id = ft.id
      JOIN projects p ON ft.project_id = p.id
      WHERE 1=1
    `;

        const params = [];
        const countParams = [];

        // Add filters
        if (formTemplateId) {
            sql += ' AND fs.form_template_id = ?';
            countSql += ' AND fs.form_template_id = ?';
            params.push(formTemplateId);
            countParams.push(formTemplateId);
        }

        if (projectId) {
            sql += ' AND ft.project_id = ?';
            countSql += ' AND ft.project_id = ?';
            params.push(projectId);
            countParams.push(projectId);
        }

        if (status) {
            sql += ' AND fs.status = ?';
            countSql += ' AND fs.status = ?';
            params.push(status);
            countParams.push(status);
        }

        if (submittedBy) {
            sql += ' AND fs.submitted_by = ?';
            countSql += ' AND fs.submitted_by = ?';
            params.push(submittedBy);
            countParams.push(submittedBy);
        }

        if (startDate) {
            sql += ' AND DATE(fs.submitted_at) >= ?';
            countSql += ' AND DATE(fs.submitted_at) >= ?';
            params.push(startDate);
            countParams.push(startDate);
        }

        if (endDate) {
            sql += ' AND DATE(fs.submitted_at) <= ?';
            countSql += ' AND DATE(fs.submitted_at) <= ?';
            params.push(endDate);
            countParams.push(endDate);
        }

        // Check user access - limit to own submissions or projects they have access to
        if (!req.user.permissions.includes('create_project')) {
            // Get projects assigned to user
            const userProjects = await db.query(
                'SELECT project_id FROM project_users WHERE user_id = ?',
                [req.user.id]
            );

            if (userProjects.length > 0) {
                const projectIds = userProjects.map(p => p.project_id);
                sql += ` AND (fs.submitted_by = ? OR ft.project_id IN (${projectIds.map(() => '?').join(',')}))`;
                countSql += ` AND (fs.submitted_by = ? OR ft.project_id IN (${projectIds.map(() => '?').join(',')}))`;
                params.push(req.user.id, ...projectIds);
                countParams.push(req.user.id, ...projectIds);
            } else {
                // No projects assigned, only show own submissions
                sql += ' AND fs.submitted_by = ?';
                countSql += ' AND fs.submitted_by = ?';
                params.push(req.user.id);
                countParams.push(req.user.id);
            }
        }

        // Add pagination
        const offset = (page - 1) * limit;
        sql += ' ORDER BY fs.submitted_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        // Execute queries
        const [submissions, countResult] = await Promise.all([
            db.query(sql, params),
            db.query(countSql, countParams)
        ]);

        const total = countResult[0].total;
        const totalPages = Math.ceil(total / limit);

        res.status(200).json({
            status: 'success',
            data: {
                submissions,
                pagination: {
                    total,
                    page: parseInt(page),
                    limit: parseInt(limit),
                    totalPages
                }
            }
        });
    } catch (error) {
        logger.error('Error getting form submissions:', error);
        next(error);
    }
};

/**
 * Update submission status
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const updateSubmissionStatus = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { status, verificationNotes } = req.body;

        // Validate status
        const validStatuses = ['draft', 'submitted', 'verified', 'rejected'];
        if (!validStatuses.includes(status)) {
            return next(new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400));
        }

        // Check submission exists
        const submissions = await db.query(
            `SELECT fs.id, fs.status, ft.project_id
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       WHERE fs.id = ?`,
            [id]
        );

        if (submissions.length === 0) {
            return next(new AppError('Submission not found', 404));
        }

        const submission = submissions[0];

        // Check if user has permission to verify submissions
        if (status === 'verified' || status === 'rejected') {
            if (!req.user.permissions.includes('verify_submission')) {
                return next(new AppError('You do not have permission to verify submissions', 403));
            }
        }

        // Check user access to this project
        if (!req.user.permissions.includes('create_project')) {
            const userProjects = await db.query(
                'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
                [submission.project_id, req.user.id]
            );

            if (userProjects.length === 0) {
                return next(new AppError('Access denied', 403));
            }
        }

        // Update submission status
        const updates = {
            status
        };

        // Set verification fields if verifying or rejecting
        if (status === 'verified' || status === 'rejected') {
            updates.verified_at = new Date();
            updates.verified_by = req.user.id;
            updates.verification_notes = verificationNotes || null;
        }

        // Set submitted_at if changing from draft to submitted
        if (submission.status === 'draft' && status === 'submitted') {
            updates.submitted_at = new Date();
        }

        // Build update query
        const fields = Object.keys(updates).map(key => `${key.replace(/([A-Z])/g, '_$1').toLowerCase()} = ?`);
        const values = Object.values(updates);
        values.push(id);

        await db.query(
            `UPDATE form_submissions SET ${fields.join(', ')} WHERE id = ?`,
            values
        );

        // Log the activity
        await db.query(
            `INSERT INTO activity_logs (
         user_id, activity_type, entity_type, entity_id,
         details, ip_address
       ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
                req.user.id,
                'submission_status_update',
                'form_submissions',
                id,
                JSON.stringify({
                    previous_status: submission.status,
                    new_status: status
                }),
                req.ip
            ]
        );

        res.status(200).json({
            status: 'success',
            data: {
                submission: {
                    id: parseInt(id),
                    status,
                    ...(updates.verified_at && { verifiedAt: updates.verified_at }),
                    ...(updates.submitted_at && { submittedAt: updates.submitted_at })
                }
            }
        });
    } catch (error) {
        logger.error('Error updating submission status:', error);
        next(error);
    }
};


module.exports = {
    createSubmission,
    getSubmissionById,
    getAllSubmissions,
    updateSubmissionStatus
};