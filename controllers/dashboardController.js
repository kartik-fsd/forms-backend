// controllers/dashboardController.js
const db = require('../db/connection');
const { AppError } = require('../errors/AppError');
const logger = require('../utils/logger');

/**
 * Get overview statistics for the current user
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getUserDashboardStats = async (req, res, next) => {
    try {
        // Get assigned projects count
        const projectsQuery = await db.query(
            `SELECT COUNT(DISTINCT p.id) as assigned_projects
       FROM projects p
       LEFT JOIN project_users pu ON p.id = pu.project_id
       WHERE (pu.user_id = ? OR p.is_public = 1) AND p.is_active = 1`,
            [req.user.id]
        );

        // Get submission statistics
        const submissionsQuery = await db.query(
            `SELECT 
        COUNT(*) as total_submissions,
        SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_count,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
       FROM form_submissions
       WHERE submitted_by = ?`,
            [req.user.id]
        );

        // Get recent activity (last 30 days)
        const recentActivityQuery = await db.query(
            `SELECT DATE(submitted_at) as submission_date, COUNT(*) as submission_count
       FROM form_submissions
       WHERE submitted_by = ? AND submitted_at IS NOT NULL 
       AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY DATE(submitted_at)
       ORDER BY submission_date DESC`,
            [req.user.id]
        );

        // Get weekly submissions (last 4 weeks)
        const weeklyStatsQuery = await db.query(
            `SELECT 
        YEAR(submitted_at) as year,
        WEEK(submitted_at) as week,
        COUNT(*) as submission_count
       FROM form_submissions
       WHERE submitted_by = ? AND submitted_at IS NOT NULL 
       AND submitted_at >= DATE_SUB(CURDATE(), INTERVAL 4 WEEK)
       GROUP BY YEAR(submitted_at), WEEK(submitted_at)
       ORDER BY year DESC, week DESC`,
            [req.user.id]
        );

        // Get project-wise submission counts
        const projectStatsQuery = await db.query(
            `SELECT 
        p.id, p.name,
        COUNT(fs.id) as submission_count
       FROM projects p
       LEFT JOIN form_templates ft ON p.id = ft.project_id
       LEFT JOIN form_submissions fs ON ft.id = fs.form_template_id AND fs.submitted_by = ?
       LEFT JOIN project_users pu ON p.id = pu.project_id
       WHERE (pu.user_id = ? OR p.is_public = 1) AND p.is_active = 1
       GROUP BY p.id
       ORDER BY submission_count DESC`,
            [req.user.id, req.user.id]
        );

        // Calculate performance metrics
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todaySubmissionsQuery = await db.query(
            `SELECT COUNT(*) as today_submissions
       FROM form_submissions
       WHERE submitted_by = ? AND submitted_at >= ?`,
            [req.user.id, today]
        );

        // Get start of current week (Sunday)
        const startOfWeek = new Date(today);
        startOfWeek.setDate(today.getDate() - today.getDay());

        const thisWeekSubmissionsQuery = await db.query(
            `SELECT COUNT(*) as week_submissions
       FROM form_submissions
       WHERE submitted_by = ? AND submitted_at >= ?`,
            [req.user.id, startOfWeek]
        );

        // Get start of previous week
        const startOfPrevWeek = new Date(startOfWeek);
        startOfPrevWeek.setDate(startOfWeek.getDate() - 7);

        const prevWeekSubmissionsQuery = await db.query(
            `SELECT COUNT(*) as prev_week_submissions
       FROM form_submissions
       WHERE submitted_by = ? AND submitted_at >= ? AND submitted_at < ?`,
            [req.user.id, startOfPrevWeek, startOfWeek]
        );

        // Calculate growth rate
        const weeklySubmissions = thisWeekSubmissionsQuery[0].week_submissions;
        const prevWeekSubmissions = prevWeekSubmissionsQuery[0].prev_week_submissions;

        let weeklyGrowthRate = 0;
        if (prevWeekSubmissions > 0) {
            weeklyGrowthRate = ((weeklySubmissions - prevWeekSubmissions) / prevWeekSubmissions) * 100;
        } else if (weeklySubmissions > 0) {
            weeklyGrowthRate = 100; // If previous week was 0 and this week has submissions
        }

        // Compile all statistics
        const dashboardStats = {
            assignedProjects: projectsQuery[0].assigned_projects,
            submissions: {
                total: submissionsQuery[0].total_submissions,
                draft: submissionsQuery[0].draft_count,
                submitted: submissionsQuery[0].submitted_count,
                verified: submissionsQuery[0].verified_count,
                rejected: submissionsQuery[0].rejected_count
            },
            performance: {
                today: todaySubmissionsQuery[0].today_submissions,
                thisWeek: weeklySubmissions,
                prevWeek: prevWeekSubmissions,
                weeklyGrowthRate: parseFloat(weeklyGrowthRate.toFixed(2))
            },
            recentActivity: recentActivityQuery,
            weeklyStats: weeklyStatsQuery,
            projectStats: projectStatsQuery
        };

        res.status(200).json({
            status: 'success',
            data: {
                dashboardStats
            }
        });
    } catch (error) {
        logger.error('Error fetching dashboard statistics:', error);
        next(error);
    }
};

/**
 * Get aggregate statistics for managers (project-level view)
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getManagerDashboardStats = async (req, res, next) => {
    try {
        // Check if user has permission to view manager stats
        if (!req.user.permissions.includes('view_submission')) {
            return next(new AppError('Permission denied', 403));
        }

        const { projectId } = req.query;

        // Get projects managed by user or accessible by role
        const projectsQuery = await db.query(
            `SELECT p.id, p.name, p.start_date, p.end_date
       FROM projects p
       LEFT JOIN project_users pu ON p.id = pu.project_id AND pu.user_id = ?
       WHERE (pu.user_id IS NOT NULL OR ? IN (SELECT id FROM users WHERE role_id IN (1, 2)))
       AND p.is_active = 1
       ${projectId ? 'AND p.id = ?' : ''}
       ORDER BY p.name`,
            projectId ? [req.user.id, req.user.id, projectId] : [req.user.id, req.user.id]
        );

        if (projectId && projectsQuery.length === 0) {
            return next(new AppError('Project not found or access denied', 404));
        }

        // Gather all project IDs for further querying
        const projectIds = projectsQuery.map(p => p.id);

        if (projectIds.length === 0) {
            return res.status(200).json({
                status: 'success',
                data: {
                    projects: [],
                    totalSubmissions: 0,
                    submissionStats: {
                        draft: 0,
                        submitted: 0,
                        verified: 0,
                        rejected: 0
                    },
                    performanceData: []
                }
            });
        }

        // Build project placeholders for SQL query
        const projectPlaceholders = projectIds.map(() => '?').join(',');

        // Get submission statistics by project
        const submissionStatsQuery = await db.query(
            `SELECT 
        ft.project_id,
        COUNT(*) as total,
        SUM(CASE WHEN fs.status = 'draft' THEN 1 ELSE 0 END) as draft_count,
        SUM(CASE WHEN fs.status = 'submitted' THEN 1 ELSE 0 END) as submitted_count,
        SUM(CASE WHEN fs.status = 'verified' THEN 1 ELSE 0 END) as verified_count,
        SUM(CASE WHEN fs.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       WHERE ft.project_id IN (${projectPlaceholders})
       GROUP BY ft.project_id`,
            projectIds
        );

        // Get performance data (submissions per day for the last 30 days)
        const performanceQuery = await db.query(
            `SELECT 
        ft.project_id,
        DATE(fs.submitted_at) as submission_date,
        COUNT(*) as submission_count
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       WHERE ft.project_id IN (${projectPlaceholders})
         AND fs.submitted_at IS NOT NULL
         AND fs.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY ft.project_id, DATE(fs.submitted_at)
       ORDER BY submission_date`,
            projectIds
        );

        // Get field executive performance for these projects
        const executivePerformanceQuery = await db.query(
            `SELECT 
        ft.project_id,
        fs.submitted_by,
        u.first_name,
        u.last_name,
        COUNT(*) as submission_count,
        MAX(fs.submitted_at) as last_submission_date
       FROM form_submissions fs
       JOIN form_templates ft ON fs.form_template_id = ft.id
       JOIN users u ON fs.submitted_by = u.id
       WHERE ft.project_id IN (${projectPlaceholders})
         AND fs.submitted_at IS NOT NULL
         AND fs.submitted_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
       GROUP BY ft.project_id, fs.submitted_by
       ORDER BY submission_count DESC`,
            projectIds
        );

        // Format the data for response
        const projectStats = projectIds.map(id => {
            const project = projectsQuery.find(p => p.id === id);
            const stats = submissionStatsQuery.find(s => s.project_id === id) || {
                total: 0,
                draft_count: 0,
                submitted_count: 0,
                verified_count: 0,
                rejected_count: 0
            };

            const performance = performanceQuery
                .filter(p => p.project_id === id)
                .map(p => ({
                    date: p.submission_date,
                    count: p.submission_count
                }));

            const executives = executivePerformanceQuery
                .filter(e => e.project_id === id)
                .map(e => ({
                    id: e.submitted_by,
                    name: `${e.first_name} ${e.last_name}`,
                    submissionCount: e.submission_count,
                    lastSubmission: e.last_submission_date
                }));

            return {
                id: project.id,
                name: project.name,
                startDate: project.start_date,
                endDate: project.end_date,
                stats: {
                    total: stats.total,
                    draft: stats.draft_count,
                    submitted: stats.submitted_count,
                    verified: stats.verified_count,
                    rejected: stats.rejected_count
                },
                performance,
                executives
            };
        });

        // Calculate total statistics
        const totalStats = {
            total: submissionStatsQuery.reduce((sum, curr) => sum + curr.total, 0),
            draft: submissionStatsQuery.reduce((sum, curr) => sum + curr.draft_count, 0),
            submitted: submissionStatsQuery.reduce((sum, curr) => sum + curr.submitted_count, 0),
            verified: submissionStatsQuery.reduce((sum, curr) => sum + curr.verified_count, 0),
            rejected: submissionStatsQuery.reduce((sum, curr) => sum + curr.rejected_count, 0)
        };

        res.status(200).json({
            status: 'success',
            data: {
                projects: projectStats,
                totalStats
            }
        });
    } catch (error) {
        logger.error('Error fetching manager dashboard statistics:', error);
        next(error);
    }
};

// Add these functions to controllers/dashboardController.js

/**
 * Get performance analysis report for a specific date range
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getPerformanceReport = async (req, res, next) => {
    try {
        const { startDate, endDate, projectId } = req.query;

        // Validate date range
        if (!startDate || !endDate) {
            return next(new AppError('Start date and end date are required', 400));
        }

        // Check if user has permission to view reports
        if (!req.user.permissions.includes('view_submission') &&
            !req.user.permissions.includes('export_data')) {
            return next(new AppError('Permission denied', 403));
        }

        // Base conditions for the queries
        const baseConditions = [
            'fs.submitted_at IS NOT NULL',
            'fs.submitted_at >= ?',
            'fs.submitted_at <= ?'
        ];
        const baseParams = [startDate, endDate];

        // Add project filter if provided
        if (projectId) {
            baseConditions.push('ft.project_id = ?');
            baseParams.push(projectId);
        }

        // For non-admins/managers, restrict to their projects
        if (!req.user.permissions.includes('create_project')) {
            baseConditions.push(`(
          ft.project_id IN (
            SELECT project_id FROM project_users WHERE user_id = ?
          ) OR ft.project_id IN (
            SELECT id FROM projects WHERE is_public = 1
          )
        )`);
            baseParams.push(req.user.id);
        }

        const whereClause = baseConditions.join(' AND ');

        // Get daily submission counts
        const dailySubmissionsQuery = await db.query(
            `SELECT 
          DATE(fs.submitted_at) as submission_date,
          COUNT(*) as submission_count
         FROM form_submissions fs
         JOIN form_templates ft ON fs.form_template_id = ft.id
         WHERE ${whereClause}
         GROUP BY DATE(fs.submitted_at)
         ORDER BY submission_date`,
            baseParams
        );

        // Get submission counts by status
        const statusBreakdownQuery = await db.query(
            `SELECT 
          fs.status,
          COUNT(*) as count
         FROM form_submissions fs
         JOIN form_templates ft ON fs.form_template_id = ft.id
         WHERE ${whereClause}
         GROUP BY fs.status`,
            baseParams
        );

        // Get top performing executives
        const topExecutivesQuery = await db.query(
            `SELECT 
          u.id, 
          u.first_name, 
          u.last_name,
          COUNT(*) as submission_count,
          COUNT(DISTINCT DATE(fs.submitted_at)) as active_days,
          AVG(CASE WHEN fs.status = 'verified' THEN 1 ELSE 0 END) as verification_rate
         FROM form_submissions fs
         JOIN form_templates ft ON fs.form_template_id = ft.id
         JOIN users u ON fs.submitted_by = u.id
         WHERE ${whereClause}
         GROUP BY u.id
         ORDER BY submission_count DESC
         LIMIT 10`,
            baseParams
        );

        // Get project performance
        const projectPerformanceQuery = await db.query(
            `SELECT 
          p.id, 
          p.name,
          COUNT(fs.id) as submission_count,
          COUNT(DISTINCT fs.submitted_by) as active_executives,
          COUNT(DISTINCT DATE(fs.submitted_at)) as active_days,
          AVG(CASE WHEN fs.status = 'verified' THEN 1 ELSE 0 END) as verification_rate
         FROM form_submissions fs
         JOIN form_templates ft ON fs.form_template_id = ft.id
         JOIN projects p ON ft.project_id = p.id
         WHERE ${whereClause}
         GROUP BY p.id
         ORDER BY submission_count DESC`,
            baseParams
        );

        // Calculate working days in the period
        const startDateObj = new Date(startDate);
        const endDateObj = new Date(endDate);
        const dayDiff = Math.ceil((endDateObj - startDateObj) / (1000 * 60 * 60 * 24)) + 1;
        let workingDays = 0;

        for (let d = new Date(startDateObj); d <= endDateObj; d.setDate(d.getDate() + 1)) {
            // Count only Monday to Friday as working days
            if (d.getDay() !== 0 && d.getDay() !== 6) {
                workingDays++;
            }
        }

        // Calculate summary metrics
        const totalSubmissions = dailySubmissionsQuery.reduce((sum, day) => sum + day.submission_count, 0);
        const uniqueDays = dailySubmissionsQuery.length;

        const avgDailySubmissions = uniqueDays > 0 ? totalSubmissions / uniqueDays : 0;
        const avgPerWorkingDay = workingDays > 0 ? totalSubmissions / workingDays : 0;

        // Format the summary data
        const summary = {
            period: {
                startDate,
                endDate,
                totalDays: dayDiff,
                workingDays
            },
            submissions: {
                total: totalSubmissions,
                averagePerDay: parseFloat(avgDailySubmissions.toFixed(2)),
                averagePerWorkingDay: parseFloat(avgPerWorkingDay.toFixed(2)),
                statusBreakdown: statusBreakdownQuery.reduce((obj, item) => {
                    obj[item.status] = item.count;
                    return obj;
                }, {})
            }
        };

        // Format executives data
        const executives = topExecutivesQuery.map(exec => ({
            id: exec.id,
            name: `${exec.first_name} ${exec.last_name}`,
            submissionCount: exec.submission_count,
            activeDays: exec.active_days,
            averagePerActiveDay: parseFloat((exec.submission_count / exec.active_days).toFixed(2)),
            verificationRate: parseFloat((exec.verification_rate * 100).toFixed(2))
        }));

        // Format projects data
        const projects = projectPerformanceQuery.map(proj => ({
            id: proj.id,
            name: proj.name,
            submissionCount: proj.submission_count,
            activeExecutives: proj.active_executives,
            activeDays: proj.active_days,
            verificationRate: parseFloat((proj.verification_rate * 100).toFixed(2))
        }));

        // Format daily data
        const dailyData = dailySubmissionsQuery.map(day => ({
            date: day.submission_date,
            count: day.submission_count
        }));

        res.status(200).json({
            status: 'success',
            data: {
                summary,
                dailyData,
                topExecutives: executives,
                projectPerformance: projects
            }
        });
    } catch (error) {
        logger.error('Error generating performance report:', error);
        next(error);
    }
};

/**
 * Get leaderboard of field executives
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 * @param {Function} next - Next middleware
 */
const getLeaderboard = async (req, res, next) => {
    try {
        const { period = '30days', projectId } = req.query;

        // Determine date range based on period
        let startDate;
        const endDate = new Date();

        switch (period) {
            case '7days':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 7);
                break;
            case '30days':
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
                break;
            case 'this-month':
                startDate = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
                break;
            case 'last-month':
                startDate = new Date(endDate.getFullYear(), endDate.getMonth() - 1, 1);
                endDate.setDate(0); // Last day of previous month
                break;
            case 'this-quarter':
                const quarter = Math.floor(endDate.getMonth() / 3);
                startDate = new Date(endDate.getFullYear(), quarter * 3, 1);
                break;
            default:
                startDate = new Date();
                startDate.setDate(startDate.getDate() - 30);
        }

        // Format dates for SQL
        const formattedStartDate = startDate.toISOString().split('T')[0];
        const formattedEndDate = endDate.toISOString().split('T')[0];

        // Build query conditions
        const conditions = [
            'fs.submitted_at IS NOT NULL',
            'fs.submitted_at >= ?',
            'fs.submitted_at <= ?'
        ];
        const queryParams = [formattedStartDate, formattedEndDate];

        if (projectId) {
            conditions.push('ft.project_id = ?');
            queryParams.push(projectId);
        }

        // Access control
        if (!req.user.permissions.includes('create_project')) {
            conditions.push(`(
          ft.project_id IN (
            SELECT project_id FROM project_users WHERE user_id = ?
          ) OR ft.project_id IN (
            SELECT id FROM projects WHERE is_public = 1
          )
        )`);
            queryParams.push(req.user.id);
        }

        const whereClause = conditions.join(' AND ');

        // Get leaderboard data
        const leaderboardQuery = await db.query(
            `SELECT 
          u.id, 
          u.first_name, 
          u.last_name,
          u.email,
          COUNT(fs.id) as submission_count,
          COUNT(DISTINCT DATE(fs.submitted_at)) as active_days,
          SUM(CASE WHEN fs.status = 'verified' THEN 1 ELSE 0 END) as verified_count,
          SUM(CASE WHEN fs.status = 'rejected' THEN 1 ELSE 0 END) as rejected_count,
          MAX(fs.submitted_at) as last_submission_at
         FROM form_submissions fs
         JOIN form_templates ft ON fs.form_template_id = ft.id
         JOIN users u ON fs.submitted_by = u.id
         JOIN roles r ON u.role_id = r.id
         WHERE ${whereClause} AND r.name = 'field_executive'
         GROUP BY u.id
         ORDER BY submission_count DESC`,
            queryParams
        );

        // Format the response
        const leaderboard = leaderboardQuery.map((exec, index) => ({
            rank: index + 1,
            id: exec.id,
            name: `${exec.first_name} ${exec.last_name}`,
            email: exec.email,
            submissionCount: exec.submission_count,
            verifiedCount: exec.verified_count,
            rejectedCount: exec.rejected_count,
            verificationRate: exec.submission_count > 0
                ? parseFloat(((exec.verified_count / exec.submission_count) * 100).toFixed(2))
                : 0,
            activeDays: exec.active_days,
            lastSubmission: exec.last_submission_at,
            isCurrentUser: exec.id === req.user.id
        }));

        res.status(200).json({
            status: 'success',
            data: {
                period: {
                    type: period,
                    startDate: formattedStartDate,
                    endDate: formattedEndDate
                },
                leaderboard
            }
        });
    } catch (error) {
        logger.error('Error generating leaderboard:', error);
        next(error);
    }
};


module.exports = {
    getUserDashboardStats,
    getManagerDashboardStats,
    getPerformanceReport,
    getLeaderboard
};