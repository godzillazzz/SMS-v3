const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const { logger } = require('./utils/logger');

const server = app.listen(env.port, () => logger.info('application_listening', { status: 'listening', port: env.port }));
async function shutdown() { await prisma.$disconnect(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
