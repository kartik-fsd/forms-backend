// config/s3Config.js
const { S3Client } = require('@aws-sdk/client-s3');
const config = require('./config');

// Create an S3 client
const s3Client = new S3Client({
    region: config.s3.region,
    credentials: {
        accessKeyId: config.s3.accessKeyId,
        secretAccessKey: config.s3.secretAccessKey
    }
});

module.exports = s3Client;
