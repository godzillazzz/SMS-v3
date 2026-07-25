const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

let dbUrl = process.env.DATABASE_URL || '';
if (dbUrl.includes('.supabase.com:5432')) {
  dbUrl = dbUrl.replace('.supabase.com:5432', '.supabase.com:6543');
}
if (dbUrl && !dbUrl.includes('pgbouncer=')) {
  const separator = dbUrl.includes('?') ? '&' : '?';
  dbUrl = `${dbUrl}${separator}pgbouncer=true&connection_limit=3&pool_timeout=10`;
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
