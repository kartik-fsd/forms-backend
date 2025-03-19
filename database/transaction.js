
// db/transactions.js
const logger = require('../utils/logger');

/**
 * Execute a function within a transaction
 * @param {Object} connection - Database connection
 * @param {Function} callback - Function to execute within the transaction
 * @returns {Promise<*>} - Result of the callback function
 */
async function executeTransaction(connection, callback) {
    try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        return result;
    } catch (error) {
        logger.error('Transaction error:', error);
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

module.exports = {
    executeTransaction
};