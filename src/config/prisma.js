const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

function configuredDatabaseUrl(rawUrl) {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const isSupabaseSessionPooler = /(^|\.)pooler\.supabase\.com$/i.test(url.hostname) && url.port === '5432';
    if (isSupabaseSessionPooler) {
      // Serverless invocations must not open a large Prisma pool. Keep the
      // approved Session Pooler endpoint and add conservative client limits.
      if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
      if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '1');
      if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '15');
      if (!url.searchParams.has('connect_timeout')) url.searchParams.set('connect_timeout', '15');
    }
    return url.toString();
  } catch (_) {
    // Environment validation owns URL format errors; do not echo a URL here.
    return rawUrl;
  }
}

const dbUrl = configuredDatabaseUrl(process.env.DATABASE_URL);
const prisma = new PrismaClient({
  // DATABASE_URL is deployment-owned. In particular, never rewrite a
  // Supabase Session Pooler port: staging uses the approved port 5432.
  ...(dbUrl && { datasources: { db: { url: dbUrl } } }),
  log: [
    { emit: 'event', level: 'error' },
    ...(process.env.NODE_ENV === 'development' ? [{ emit: 'event', level: 'warn' }] : [])
  ]
});

prisma.$on('error', () => logger.error('database_client_error', { errorCategory: 'database_client_error' }));
if (process.env.NODE_ENV === 'development') prisma.$on('warn', () => logger.warn('database_client_warning', { errorCategory: 'database_client_warning' }));

module.exports = prisma;
module.exports.configuredDatabaseUrl = configuredDatabaseUrl;
