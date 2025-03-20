const db = require('../database/connection');
const { executeTransaction } = require('../database/transaction');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

/**
 * Get all projects
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getAllProjects = async (req, res, next) => {
  try {
    const { isActive, search } = req.query;

    let sql = `
      SELECT p.id, p.name, p.description, p.start_date, p.end_date, 
             p.is_active, p.created_at, p.updated_at,
             u.first_name as creator_first_name, u.last_name as creator_last_name,
             (SELECT COUNT(*) FROM form_templates WHERE project_id = p.id) as form_count,
             (SELECT COUNT(*) FROM project_users WHERE project_id = p.id) as user_count
      FROM projects p
      JOIN users u ON p.created_by = u.id
      WHERE 1=1
    `;

    const params = [];

    // Filter by active status if provided
    if (isActive !== undefined) {
      sql += ' AND p.is_active = ?';
      params.push(isActive === 'true' ? 1 : 0);
    }

    // Filter by search term if provided
    if (search) {
      sql += ' AND (p.name LIKE ? OR p.description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    // Limit to projects the user has access to if not admin
    if (!req.user.permissions.includes('create_project')) {
      sql += ` AND (p.is_public = 1 OR p.id IN (
        SELECT project_id FROM project_users WHERE user_id = ?
      ))`;
      params.push(req.user.id);
    }

    // Order by creation date
    sql += ' ORDER BY p.created_at DESC';

    const projects = await db.query(sql, params);

    res.status(200).json({
      status: 'success',
      data: {
        projects
      }
    });
  } catch (error) {
    logger.error('Error getting projects:', error);
    next(error);
  }
};

/**
 * Get a project by ID
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getProjectById = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Get project details
    const projects = await db.query(
      `SELECT p.id, p.name, p.description, p.start_date, p.end_date, 
              p.is_active, p.created_at, p.updated_at,
              u.first_name as creator_first_name, u.last_name as creator_last_name
       FROM projects p
       JOIN users u ON p.created_by = u.id
       WHERE p.id = ?`,
      [id]
    );

    if (projects.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    const project = projects[0];

    // Check if user has access to this project if not admin
    // When checking user access for non-admin users
    if (!req.user.permissions.includes('create_project')) {
      const userAccess = await db.query(
        'SELECT 1 FROM projects WHERE id = ? AND (is_public = 1 OR id IN (SELECT project_id FROM project_users WHERE user_id = ?))',
        [id, req.user.id]
      );

      if (userAccess.length === 0) {
        return next(new AppError('Access denied', 403));
      }
    }

    // Get form templates for this project
    const forms = await db.query(
      `SELECT id, name, description, version, is_active, created_at
       FROM form_templates
       WHERE project_id = ?
       ORDER BY created_at DESC`,
      [id]
    );

    // Get assigned users
    const users = await db.query(
      `SELECT u.id, u.first_name, u.last_name, u.email, u.username,
              r.name as role, pu.assigned_at,
              asn.first_name as assigned_by_first_name, asn.last_name as assigned_by_last_name
       FROM project_users pu
       JOIN users u ON pu.user_id = u.id
       JOIN users asn ON pu.assigned_by = asn.id
       JOIN roles r ON u.role_id = r.id
       WHERE pu.project_id = ?
       ORDER BY pu.assigned_at DESC`,
      [id]
    );

    // Get submission statistics
    const stats = await db.query(
      `SELECT 
        COUNT(*) as total_submissions,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_count,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       WHERE ft.project_id = ?`,
      [id]
    );

    // Format response
    const formattedProject = {
      ...project,
      forms,
      users,
      statistics: stats[0]
    };

    res.status(200).json({
      status: 'success',
      data: {
        project: formattedProject
      }
    });
  } catch (error) {
    logger.error('Error getting project:', error);
    next(error);
  }
};

/**
 * Create a new project
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const createProject = async (req, res, next) => {
  try {
    const { name, description, startDate, endDate, isActive = true, isPublic = false, assignedUserIds = [] } = req.body;

    // Check if user has permission to create projects
    if (!req.user.permissions.includes('create_project')) {
      return next(new AppError('Permission denied', 403));
    }

    // Check if project name already exists
    const existingProject = await db.query(
      'SELECT id FROM projects WHERE name = ?',
      [name]
    );

    if (existingProject.length > 0) {
      return next(new AppError('Project with this name already exists', 409));
    }

    // Use executeTransaction function instead of manual transaction management
    const connection = await db.getConnection();

    try {
      const projectData = await executeTransaction(connection, async (conn) => {
        // Create project
        const [projectResult] = await conn.execute(
          `INSERT INTO projects (
             name, description, start_date, end_date, is_active, is_public, created_by
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [name, description, startDate, endDate || null, isActive ? 1 : 0, isPublic ? 1 : 0, req.user.id]
        );

        const projectId = projectResult.insertId;

        // Assign users if provided
        if (assignedUserIds.length > 0) {
          for (const userId of assignedUserIds) {
            // Check if user exists
            const userExists = await conn.execute(
              'SELECT id FROM users WHERE id = ?',
              [userId]
            );

            if (userExists[0].length === 0) {
              continue; // Skip non-existent users
            }

            // Assign user to project
            await conn.execute(
              `INSERT INTO project_users (project_id, user_id, assigned_by)
               VALUES (?, ?, ?)`,
              [projectId, userId, req.user.id]
            );
          }
        }

        // Assign the creator to the project as well (if not already included)
        if (!assignedUserIds.includes(req.user.id)) {
          await conn.execute(
            `INSERT INTO project_users (project_id, user_id, assigned_by)
             VALUES (?, ?, ?)`,
            [projectId, req.user.id, req.user.id]
          );
        }

        // Log activity
        await conn.execute(
          `INSERT INTO activity_logs (
             user_id, activity_type, entity_type, entity_id,
             details, ip_address
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            req.user.id,
            'project_created',
            'projects',
            projectId,
            JSON.stringify({
              name,
              assigned_users: assignedUserIds.length
            }),
            req.ip
          ]
        );

        return {
          id: projectId,
          name,
          description,
          startDate,
          endDate,
          isActive,
          isPublic,
          createdAt: new Date()
        };
      });

      res.status(201).json({
        status: 'success',
        data: {
          project: projectData
        }
      });
    } catch (error) {
      // The executeTransaction function handles rollback and connection release
      throw error;
    }
  } catch (error) {
    logger.error('Error creating project:', error);
    next(error);
  }
};

/**
 * Update a project
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const updateProject = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, startDate, endDate, isActive, isPublic } = req.body;

    // Check if project exists
    const projects = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (projects.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    // Check if user has permission to edit projects
    if (!req.user.permissions.includes('edit_project')) {
      return next(new AppError('Permission denied', 403));
    }

    // Build update query
    const updateFields = [];
    const updateParams = [];

    if (name) {
      // Check if name is unique
      const existingProject = await db.query(
        'SELECT id FROM projects WHERE name = ? AND id != ?',
        [name, id]
      );

      if (existingProject.length > 0) {
        return next(new AppError('Project with this name already exists', 409));
      }

      updateFields.push('name = ?');
      updateParams.push(name);
    }

    if (description !== undefined) {
      updateFields.push('description = ?');
      updateParams.push(description);
    }

    if (startDate) {
      updateFields.push('start_date = ?');
      updateParams.push(startDate);
    }

    if (endDate !== undefined) {
      updateFields.push('end_date = ?');
      updateParams.push(endDate || null);
    }

    if (isActive !== undefined) {
      updateFields.push('is_active = ?');
      updateParams.push(isActive ? 1 : 0);
    }

    if (updateFields.length === 0) {
      return next(new AppError('No update fields provided', 400));
    }

    if (isPublic !== undefined) {
      updateFields.push('is_public = ?');
      updateParams.push(isPublic ? 1 : 0);
    }

    // Add ID to params
    updateParams.push(id);

    // Update project
    await db.query(
      `UPDATE projects SET ${updateFields.join(', ')} WHERE id = ?`,
      updateParams
    );

    // Log activity
    await db.query(
      `INSERT INTO activity_logs (
         user_id, activity_type, entity_type, entity_id,
         details, ip_address
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        'project_updated',
        'projects',
        id,
        JSON.stringify({
          fields_updated: updateFields.map(field => field.split(' = ')[0])
        }),
        req.ip
      ]
    );

    res.status(200).json({
      status: 'success',
      data: {
        project: {
          id: parseInt(id),
          ...updateFields.includes('name = ?') && { name },
          ...updateFields.includes('description = ?') && { description },
          ...updateFields.includes('start_date = ?') && { startDate },
          ...updateFields.includes('end_date = ?') && { endDate },
          ...updateFields.includes('is_active = ?') && { isActive },
          ...updateFields.includes('is_public = ?') && { isPublic }
        }
      }
    });
  } catch (error) {
    logger.error('Error updating project:', error);
    next(error);
  }
};

/**
 * Delete a project
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const deleteProject = async (req, res, next) => {
  try {
    const { id } = req.params;

    // Check if project exists
    const projects = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (projects.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    // Check if user has permission to delete projects
    if (!req.user.permissions.includes('create_project')) {
      return next(new AppError('Permission denied', 403));
    }

    // Check if project has any forms
    const forms = await db.query(
      'SELECT id FROM form_templates WHERE project_id = ?',
      [id]
    );

    if (forms.length > 0) {
      // Project has forms, only mark as inactive
      await db.query(
        'UPDATE projects SET is_active = 0 WHERE id = ?',
        [id]
      );

      return res.status(200).json({
        status: 'success',
        message: 'Project marked as inactive due to existing forms',
        data: {
          deactivated: true
        }
      });
    }

    // Use executeTransaction function for deletion
    const connection = await db.getConnection();

    try {
      await executeTransaction(connection, async (conn) => {
        // Delete project user assignments
        await conn.execute(
          'DELETE FROM project_users WHERE project_id = ?',
          [id]
        );

        // Delete project
        await conn.execute(
          'DELETE FROM projects WHERE id = ?',
          [id]
        );

        // Log activity
        await conn.execute(
          `INSERT INTO activity_logs (
             user_id, activity_type, entity_type, entity_id,
             details, ip_address
           ) VALUES (?, ?, ?, ?, ?, ?)`,
          [
            req.user.id,
            'project_deleted',
            'projects',
            id,
            JSON.stringify({
              project_id: id
            }),
            req.ip
          ]
        );
      });

      res.status(200).json({
        status: 'success',
        data: null
      });
    } catch (error) {
      // The executeTransaction function handles rollback and connection release
      throw error;
    }
  } catch (error) {
    logger.error('Error deleting project:', error);
    next(error);
  }
};

/**
 * Assign users to a project
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const assignUsers = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { userIds } = req.body;

    if (!Array.isArray(userIds) || userIds.length === 0) {
      return next(new AppError('User IDs must be a non-empty array', 400));
    }

    // Check if project exists
    const projects = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (projects.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    // Check if user has permission to manage project users
    if (!req.user.permissions.includes('edit_project')) {
      return next(new AppError('Permission denied', 403));
    }

    // Use executeTransaction for assigning users
    const connection = await db.getConnection();

    try {
      const results = await executeTransaction(connection, async (conn) => {
        const assignResults = {
          assigned: 0,
          alreadyAssigned: 0,
          notFound: 0
        };

        for (const userId of userIds) {
          // Check if user exists
          const userExists = await conn.execute(
            'SELECT id FROM users WHERE id = ?',
            [userId]
          );

          if (userExists[0].length === 0) {
            assignResults.notFound++;
            continue;
          }

          // Check if user is already assigned to project
          const userAssigned = await conn.execute(
            'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
            [id, userId]
          );

          if (userAssigned[0].length > 0) {
            assignResults.alreadyAssigned++;
            continue;
          }

          // Assign user to project
          await conn.execute(
            `INSERT INTO project_users (project_id, user_id, assigned_by)
             VALUES (?, ?, ?)`,
            [id, userId, req.user.id]
          );

          assignResults.assigned++;
        }

        // Log activity if any users were assigned
        if (assignResults.assigned > 0) {
          await conn.execute(
            `INSERT INTO activity_logs (
               user_id, activity_type, entity_type, entity_id,
               details, ip_address
             ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              req.user.id,
              'users_assigned',
              'projects',
              id,
              JSON.stringify({
                assigned_count: assignResults.assigned,
                project_id: id
              }),
              req.ip
            ]
          );
        }

        return assignResults;
      });

      res.status(200).json({
        status: 'success',
        data: {
          results
        }
      });
    } catch (error) {
      // The executeTransaction function handles rollback and connection release
      throw error;
    }
  } catch (error) {
    logger.error('Error assigning users to project:', error);
    next(error);
  }
};

/**
 * Remove a user from a project
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const removeUser = async (req, res, next) => {
  try {
    const { id, userId } = req.params;

    // Check if project exists
    const projects = await db.query(
      'SELECT id FROM projects WHERE id = ?',
      [id]
    );

    if (projects.length === 0) {
      return next(new AppError('Project not found', 404));
    }

    // Check if user has permission to manage project users
    if (!req.user.permissions.includes('edit_project')) {
      return next(new AppError('Permission denied', 403));
    }

    // Check if user is assigned to project
    const userAssigned = await db.query(
      'SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );

    if (userAssigned.length === 0) {
      return next(new AppError('User is not assigned to this project', 404));
    }

    // Remove user from project
    await db.query(
      'DELETE FROM project_users WHERE project_id = ? AND user_id = ?',
      [id, userId]
    );

    // Log activity
    await db.query(
      `INSERT INTO activity_logs (
         user_id, activity_type, entity_type, entity_id,
         details, ip_address
       ) VALUES (?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        'user_removed',
        'projects',
        id,
        JSON.stringify({
          removed_user_id: userId,
          project_id: id
        }),
        req.ip
      ]
    );

    res.status(200).json({
      status: 'success',
      data: null
    });
  } catch (error) {
    logger.error('Error removing user from project:', error);
    next(error);
  }
};

module.exports = {
  getAllProjects,
  getProjectById,
  createProject,
  updateProject,
  deleteProject,
  assignUsers,
  removeUser
};