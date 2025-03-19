// controllers/formController.js
const db = require('../database/connection');
const s3Service = require('../services/s3Service');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');
const config = require('../config/config');

/**
 * Get all form templates
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getAllForms = async (req, res, next) => {
    try {
        const { projectId, isActive } = req.query;

        let sql = `
      SELECT ft.id, ft.project_id, ft.name, ft.description, ft.version, ft.is_active, 
             ft.created_at, ft.updated_at, p.name as project_name
      FROM form_templates ft
      JOIN projects p ON ft.project_id = p.id
      WHERE 1=1
    `;

        const params = [];

        // Filter by project if provided
        if (projectId) {
            sql += ' AND ft.project_id = ?';
            params.push(projectId);
        }

        // Filter by active status if provided
        if (isActive !== undefined) {
            sql += ' AND ft.is_active = ?';
            params.push(isActive === 'true' ? 1 : 0);
        }

        // Check user project access if not admin
        if (!req.user.permissions.includes('create_project')) {
            // Get projects assigned to user
            const userProjects = await db.query(
                'SELECT project_id FROM project_users WHERE user_id = ?',
                [req.user.id]
            );

            if (userProjects.length > 0) {
                const projectIds = userProjects.map(p => p.project_id);
                sql += ` AND ft.project_id IN (${projectIds.map(() => '?').join(',')})`;
                params.push(...projectIds);
            } else {
                // No projects assigned
                return res.status(200).json({
                    status: 'success',
                    data: {
                        forms: []
                    }
                });
            }
        }

        // Sort by creation date
        sql += ' ORDER BY ft.created_at DESC';

        const forms = await db.query(sql, params);

        res.status(200).json({
            status: 'success',
            data: {
                forms
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get a form template by ID
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getFormById = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Get form details
        const forms = await db.query(
            `SELECT ft.id, ft.project_id, ft.name, ft.description, ft.version, 
              ft.is_active, ft.schema_s3_object_id, s.bucket_name, s.object_key,
              ft.created_at, ft.updated_at, p.name as project_name
       FROM form_templates ft
       JOIN projects p ON ft.project_id = p.id
       JOIN s3_objects s ON ft.schema_s3_object_id = s.id
       WHERE ft.id = ?`,
            [id]
        );

        if (forms.length === 0) {
            return next(new AppError('Form template not found', 404));
        }

        const form = forms[0];

        // Check user access if not admin
        if (!req.user.permissions.includes('create_project')) {
            const userProjects = await db.query(
                'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
                [form.project_id, req.user.id]
            );

            if (userProjects.length === 0) {
                return next(new AppError('Access denied', 403));
            }
        }

        // Get versions history
        const versions = await db.query(
            `SELECT ftv.version, ftv.changes_description, ftv.created_at,
              u.first_name, u.last_name
       FROM form_template_versions ftv
       JOIN users u ON ftv.created_by = u.id
       WHERE ftv.form_template_id = ?
       ORDER BY ftv.version DESC`,
            [id]
        );

        form.versions = versions;

        res.status(200).json({
            status: 'success',
            data: {
                form
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Get form schema from S3
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getFormSchema = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if schema is in cache
        const cachedSchema = await db.query(
            `SELECT sc.schema_json
       FROM form_templates ft
       JOIN schema_cache sc ON ft.schema_s3_object_id = sc.schema_s3_object_id
       WHERE ft.id = ?`,
            [id]
        );

        // If found in cache, update access count and return
        if (cachedSchema.length > 0 && cachedSchema[0].schema_json) {
            // Update access count and timestamp
            await db.query(
                `UPDATE schema_cache 
         SET accessed_count = accessed_count + 1, 
             last_accessed_at = NOW() 
         WHERE schema_s3_object_id = (
           SELECT schema_s3_object_id FROM form_templates WHERE id = ?
         )`,
                [id]
            );

            return res.status(200).json({
                status: 'success',
                data: {
                    schema: JSON.parse(cachedSchema[0].schema_json)
                }
            });
        }

        // If not in cache, get S3 details and fetch
        const s3Details = await db.query(
            `SELECT s.bucket_name, s.object_key, ft.schema_s3_object_id
       FROM form_templates ft
       JOIN s3_objects s ON ft.schema_s3_object_id = s.id
       WHERE ft.id = ?`,
            [id]
        );

        if (s3Details.length === 0) {
            return next(new AppError('Form template not found', 404));
        }

        const { bucket_name, object_key, schema_s3_object_id } = s3Details[0];

        // Get schema from S3
        const schemaJson = await s3Service.getObject(bucket_name, object_key);

        // Parse JSON schema
        let schema;
        try {
            schema = JSON.parse(schemaJson);
        } catch (error) {
            logger.error('Error parsing schema JSON:', error);
            return next(new AppError('Invalid schema format', 500));
        }

        // Cache the schema for future requests
        await db.query(
            `INSERT INTO schema_cache (schema_s3_object_id, schema_json, accessed_count, last_accessed_at, cached_at)
       VALUES (?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE 
         schema_json = VALUES(schema_json),
         accessed_count = accessed_count + 1,
         last_accessed_at = NOW()`,
            [schema_s3_object_id, JSON.stringify(schema)]
        );

        res.status(200).json({
            status: 'success',
            data: {
                schema
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * Create a new form template
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const createForm = async (req, res, next) => {
    try {
        const { projectId, name, description, schema } = req.body;

        // Check project existence and user access
        const projects = await db.query(
            'SELECT id, name FROM projects WHERE id = ?',
            [projectId]
        );

        if (projects.length === 0) {
            return next(new AppError('Project not found', 404));
        }

        // Check user access to project if not admin
        if (!req.user.permissions.includes('create_project')) {
            const userProjects = await db.query(
                'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
                [projectId, req.user.id]
            );

            if (userProjects.length === 0) {
                return next(new AppError('Access denied', 403));
            }
        }

        // Validate schema is valid JSON
        let schemaObject;
        try {
            if (typeof schema === 'string') {
                schemaObject = JSON.parse(schema);
            } else {
                schemaObject = schema;
            }
        } catch (error) {
            return next(new AppError('Invalid schema JSON format', 400));
        }

        // Get connection for transaction
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Upload schema to S3
            const objectKey = `projects/${projectId}/form-templates/${name.toLowerCase().replace(/\s+/g, '-')}-v1.json`;

            await s3Service.putObject(
                config.s3.formSchemasBucket,
                objectKey,
                JSON.stringify(schemaObject),
                'application/json'
            );

            // Create S3 object record
            const [s3ObjectResult] = await connection.execute(
                `INSERT INTO s3_objects (
           bucket_name, object_key, object_key_hash, content_type, 
           size_bytes, created_by
         ) VALUES (?, ?, SHA2(?, 256), ?, ?, ?)`,
                [
                    config.s3.formSchemasBucket,
                    objectKey,
                    objectKey,
                    'application/json',
                    Buffer.byteLength(JSON.stringify(schemaObject)),
                    req.user.id
                ]
            );

            const s3ObjectId = s3ObjectResult.insertId;

            // Create form template
            const [formResult] = await connection.execute(
                `INSERT INTO form_templates (
           project_id, name, description, schema_s3_object_id,
           version, is_active, created_by
         ) VALUES (?, ?, ?, ?, 1, 1, ?)`,
                [projectId, name, description, s3ObjectId, req.user.id]
            );

            const formId = formResult.insertId;

            // Create initial version record
            await connection.execute(
                `INSERT INTO form_template_versions (
           form_template_id, version, schema_s3_object_id,
           changes_description, created_by
         ) VALUES (?, 1, ?, 'Initial version', ?)`,
                [formId, s3ObjectId, req.user.id]
            );

            // Cache the schema
            await connection.execute(
                `INSERT INTO schema_cache (
           schema_s3_object_id, schema_json, accessed_count,
           last_accessed_at, cached_at
         ) VALUES (?, ?, 1, NOW(), NOW())`,
                [s3ObjectId, JSON.stringify(schemaObject)]
            );

            await connection.commit();

            res.status(201).json({
                status: 'success',
                data: {
                    form: {
                        id: formId,
                        projectId,
                        name,
                        description,
                        version: 1,
                        isActive: true,
                        createdAt: new Date()
                    }
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger.error('Error creating form template:', error);
        next(error);
    }
};

/**
 * Update a form template
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const updateForm = async (req, res, next) => {
    try {
        const { id } = req.params;
        const { name, description, isActive, schema, changesDescription } = req.body;

        // Check if form exists
        const forms = await db.query(
            `SELECT ft.id, ft.project_id, ft.name, ft.version, ft.schema_s3_object_id,
              s.bucket_name, s.object_key
       FROM form_templates ft
       JOIN s3_objects s ON ft.schema_s3_object_id = s.id
       WHERE ft.id = ?`,
            [id]
        );

        if (forms.length === 0) {
            return next(new AppError('Form template not found', 404));
        }

        const form = forms[0];

        // Check user access to project if not admin
        if (!req.user.permissions.includes('edit_form')) {
            return next(new AppError('Permission denied', 403));
        }

        // Get connection for transaction
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            let schemaUpdated = false;
            let newSchemaS3ObjectId = form.schema_s3_object_id;
            let newVersion = form.version;

            // Handle schema update if provided
            if (schema) {
                // Validate schema is valid JSON
                let schemaObject;
                try {
                    if (typeof schema === 'string') {
                        schemaObject = JSON.parse(schema);
                    } else {
                        schemaObject = schema;
                    }
                } catch (error) {
                    return next(new AppError('Invalid schema JSON format', 400));
                }

                // Increment version
                newVersion = form.version + 1;

                // Upload new schema to S3
                const objectKey = `projects/${form.project_id}/form-templates/${form.name.toLowerCase().replace(/\s+/g, '-')}-v${newVersion}.json`;

                await s3Service.putObject(
                    config.s3.formSchemasBucket,
                    objectKey,
                    JSON.stringify(schemaObject),
                    'application/json'
                );

                // Create new S3 object record
                const [s3ObjectResult] = await connection.execute(
                    `INSERT INTO s3_objects (
             bucket_name, object_key, object_key_hash, content_type, 
             size_bytes, created_by
           ) VALUES (?, ?, SHA2(?, 256), ?, ?, ?)`,
                    [
                        config.s3.formSchemasBucket,
                        objectKey,
                        objectKey,
                        'application/json',
                        Buffer.byteLength(JSON.stringify(schemaObject)),
                        req.user.id
                    ]
                );

                newSchemaS3ObjectId = s3ObjectResult.insertId;

                // Create new version record
                await connection.execute(
                    `INSERT INTO form_template_versions (
             form_template_id, version, schema_s3_object_id,
             changes_description, created_by
           ) VALUES (?, ?, ?, ?, ?)`,
                    [id, newVersion, newSchemaS3ObjectId, changesDescription || 'Schema updated', req.user.id]
                );

                // Cache the schema
                await connection.execute(
                    `INSERT INTO schema_cache (
             schema_s3_object_id, schema_json, accessed_count,
             last_accessed_at, cached_at
           ) VALUES (?, ?, 1, NOW(), NOW())`,
                    [newSchemaS3ObjectId, JSON.stringify(schemaObject)]
                );

                schemaUpdated = true;
            }

            // Update form template
            const updateFields = [];
            const updateParams = [];

            if (name) {
                updateFields.push('name = ?');
                updateParams.push(name);
            }

            if (description !== undefined) {
                updateFields.push('description = ?');
                updateParams.push(description);
            }

            if (isActive !== undefined) {
                updateFields.push('is_active = ?');
                updateParams.push(isActive ? 1 : 0);
            }

            if (schemaUpdated) {
                updateFields.push('schema_s3_object_id = ?');
                updateParams.push(newSchemaS3ObjectId);

                updateFields.push('version = ?');
                updateParams.push(newVersion);
            }

            if (updateFields.length > 0) {
                updateParams.push(id);

                await connection.execute(
                    `UPDATE form_templates 
           SET ${updateFields.join(', ')} 
           WHERE id = ?`,
                    updateParams
                );
            }

            await connection.commit();

            res.status(200).json({
                status: 'success',
                data: {
                    form: {
                        id: parseInt(id),
                        name: name || form.name,
                        version: newVersion,
                        schemaUpdated,
                        isActive: isActive !== undefined ? isActive : form.is_active
                    }
                }
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger.error('Error updating form template:', error);
        next(error);
    }
};

/**
 * Delete a form template
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const deleteForm = async (req, res, next) => {
    try {
        const { id } = req.params;

        // Check if form exists
        const forms = await db.query(
            'SELECT id, project_id FROM form_templates WHERE id = ?',
            [id]
        );

        if (forms.length === 0) {
            return next(new AppError('Form template not found', 404));
        }

        // Check for existing submissions
        const submissions = await db.query(
            'SELECT COUNT(*) as count FROM form_submissions WHERE form_template_id = ?',
            [id]
        );

        if (submissions[0].count > 0) {
            // Instead of deleting, just mark as inactive
            await db.query(
                'UPDATE form_templates SET is_active = 0 WHERE id = ?',
                [id]
            );

            return res.status(200).json({
                status: 'success',
                message: 'Form template marked as inactive due to existing submissions',
                data: {
                    deactivated: true
                }
            });
        }

        // No submissions, proceed with deletion
        const connection = await db.getConnection();

        try {
            await connection.beginTransaction();

            // Delete version records
            await connection.execute(
                'DELETE FROM form_template_versions WHERE form_template_id = ?',
                [id]
            );

            // Get S3 object ID before deleting form
            const s3Objects = await connection.execute(
                'SELECT schema_s3_object_id FROM form_templates WHERE id = ?',
                [id]
            );

            const schemaS3ObjectId = s3Objects[0][0].schema_s3_object_id;

            // Delete from schema cache
            await connection.execute(
                'DELETE FROM schema_cache WHERE schema_s3_object_id = ?',
                [schemaS3ObjectId]
            );

            // Delete form
            await connection.execute(
                'DELETE FROM form_templates WHERE id = ?',
                [id]
            );

            // Delete S3 object record (S3 object itself remains in bucket)
            await connection.execute(
                'DELETE FROM s3_objects WHERE id = ?',
                [schemaS3ObjectId]
            );

            await connection.commit();

            res.status(200).json({
                status: 'success',
                data: null
            });
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    } catch (error) {
        logger.error('Error deleting form template:', error);
        next(error);
    }
};

module.exports = {
    getAllForms,
    getFormById,
    getFormSchema,
    createForm,
    updateForm,
    deleteForm
};