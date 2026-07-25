const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl && !dbUrl.includes('connection_limit=')) {
  const separator = dbUrl.includes('?') ? '&' : '?';
  dbUrl = `${dbUrl}${separator}connection_limit=5&pool_timeout=10`;
}

const prisma = new PrismaClient({
  ...(dbUrl && { datasources: { db: { url: dbUrl } } }),
  log: [
    { emit: 'event', level: 'error' },
    ...(process.env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [])
  ]
});

prisma.$on('error', () => logger.error('database_client_error', { errorCategory: 'database_client_error' }));
if (process.env.NODE_ENV === 'development') prisma.$on('warn', () => logger.warn('database_client_warning', { errorCategory: 'database_client_warning' }));

module.exports = prisma;
