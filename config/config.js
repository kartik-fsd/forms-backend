// config/config.js
require('dotenv').config();

module.exports = {
    environment: process.env.NODE_ENV || 'development',
    port: process.env.PORT || 3000,
    db: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'fse_lead_management',
        connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10'),
        timezone: 'UTC'
    },
    jwt: {
        secret: process.env.JWT_SECRET || 'your-secret-key',
        accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '1h',
        refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d'
    },
    s3: {
        region: process.env.S3_REGION || 'us-east-1',
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        formSchemasBucket: process.env.S3_FORM_SCHEMAS_BUCKET || 'form-schemas',
        submissionsBucket: process.env.S3_SUBMISSIONS_BUCKET || 'form-submissions',
        uploadExpiration: parseInt(process.env.S3_UPLOAD_EXPIRATION || '3600') // 1 hour in seconds
    },
    corsOrigins: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : '*',
    logLevel: process.env.LOG_LEVEL || 'info'
};