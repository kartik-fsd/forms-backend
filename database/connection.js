
// db/connection.js
const mysql = require('mysql2/promise');
const config = require('../config/config');
const logger = require('../utils/logger');

// Create a connection pool
const pool = mysql.createPool({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database,
    waitForConnections: true,
    connectionLimit: config.db.connectionLimit,
    queueLimit: 0,
});

/**
 * Execute a SQL query
 * @param {string} sql - SQL query to execute
 * @param {Array} params - Parameters for the SQL query
 * @returns {Promise<Array>} - Query results
 */
async function query(sql, params = []) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        logger.error('Database query error:', { sql, error: error.message });
        throw error;
    }
}

/**
 * Test the database connection
 * @returns {Promise<void>}
 */
async function testConnection() {
    try {
        await query('SELECT 1');
    } catch (error) {
        logger.error('Database connection test failed:', error);
        throw error;
    }
}

/**
 * End all connections in the pool
 */
function end() {
    return pool.end();
}

// Get a connection from the pool for transaction usage
async function getConnection() {
    return await pool.getConnection();
}

module.exports = {
    query,
    testConnection,
    end,
    getConnection
};