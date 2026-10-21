const app = require('./app');
const env = require('./config/env');
const prisma = require('./config/prisma');
const { logger } = require('./utils/logger');

const onListening = () => logger.info('application_listening', { status: 'listening', port: env.port, host: env.host });
const server = env.host === undefined
  ? app.listen(env.port, onListening)
  : app.listen(env.port, env.host, onListening);
async function shutdown() { await prisma.$disconnect(); server.close(() => process.exit(0)); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
