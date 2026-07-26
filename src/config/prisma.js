const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

const prisma = new PrismaClient({
  // DATABASE_URL is deployment-owned. In particular, never rewrite a
  // Supabase Session Pooler port: staging uses the approved port 5432.
  // Pooling parameters, when needed, belong in the configured URL itself.
  ...(process.env.DATABASE_URL && { datasources: { db: { url: process.env.DATABASE_URL } } }),
  log: [
    { emit: 'event', level: 'error' },
    ...(process.env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [])
  ]
});

prisma.$on('error', () => logger.error('database_client_error', { errorCategory: 'database_client_error' }));
if (process.env.NODE_ENV === 'development') prisma.$on('warn', () => logger.warn('database_client_warning', { errorCategory: 'database_client_warning' }));

module.exports = prisma;
