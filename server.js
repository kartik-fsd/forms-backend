const app = require('./app');
const config = require('./config/config');
const logger = require('./utils/logger');
const db = require('./database/connection');

// Verify database connection before starting the server
db.testConnection()
    .then(() => {
        logger.info('Database connection established successfully');

        const PORT = config.port || 3000;
        const server = app.listen(PORT, () => {
            logger.info(`Server is running on port ${PORT}`);
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error('Uncaught Exception:', error);
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', (error) => {
            logger.error('Unhandled Rejection:', error);
            server.close(() => {
                process.exit(1);
            });
        });

        // Handle graceful shutdown
        process.on('SIGTERM', () => {
            logger.info('SIGTERM received. Shutting down gracefully');
            server.close(() => {
                logger.info('Process terminated');
                db.end(); // Close database connections
            });
        });
    })
    .catch(error => {
        logger.error('Unable to connect to the database:', error);
        process.exit(1);
    });
