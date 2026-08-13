const { PrismaClient } = require('@prisma/client');
const { logger } = require('../utils/logger');

function configuredDatabaseUrl(rawUrl) {
  if (!rawUrl) return undefined;
  try {
    const url = new URL(rawUrl);
    const isSupabasePooler = /(^|\.)pooler\.supabase\.com$/i.test(url.hostname) && ['5432', '6543'].includes(url.port);
    if (isSupabasePooler) {
      // Serverless invocations must not open a large Prisma pool. Keep the
      // approved Pooler endpoint (5432 Session or 6543 Transaction) and add conservative client limits.
      if (!url.searchParams.has('pgbouncer')) url.searchParams.set('pgbouncer', 'true');
      // Candidate runtime evidence showed P2024 pool acquisition timeouts under a normal
      // authenticated browser request burst with connection_limit=1. Keep the floor
      // bounded at 2 for Supabase Pooler while preserving any explicitly larger limit.
      const configuredLimit = Number(url.searchParams.get('connection_limit'));
      if (!Number.isFinite(configuredLimit) || configuredLimit < 2) url.searchParams.set('connection_limit', '2');
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
