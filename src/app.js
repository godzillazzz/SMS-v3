const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const env = require('./config/env');
const routes = require('./routes');
const { notFound, errorHandler } = require('./middlewares/error-handler');
const prisma = require('./config/prisma');
const requestContext = require('./middlewares/request-context');
const requestLogger = require('./middlewares/request-logger');
const { logger, errorCategory, setOperationalEventSink } = require('./utils/logger');
const { createConfiguredAlerting } = require('./services/alerting.service');
const {
  PREVIEW_DATABASE_TARGET_GUARD_ERROR,
  verifyPreviewDatabaseTarget
} = require('./services/runtime-database-target-guard.service');

const app = express();
const alerting = createConfiguredAlerting(env, {
  onStoreFailure: (fields) => logger.error('alert_dedup_store_unavailable', fields)
});
setOperationalEventSink((record) => alerting.evaluate(record));
app.locals.alerting = alerting;
logger.info('application_startup', { configStatus: 'valid', status: 'initialized' });
app.use(helmet());
if (env.nodeEnv === 'production' && env.corsOrigins.length === 0) throw new Error('CORS_ORIGIN must contain at least one allowed origin in production.');
app.use(cors({ credentials: true, origin(origin, callback) {
  if (!origin || env.corsOrigins.includes(origin)) return callback(null, true);
  const error = new Error('Origin not allowed by CORS');
  error.statusCode = 403;
  error.publicMessage = 'Origin not allowed.';
  return callback(error);
} }));
app.use(requestContext);
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));
app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.get('/api/v1/health', (_req, res) => res.json({ status: 'ok' }));
async function readiness(req, res) {
  const startedAt = process.hrtime.bigint();
  try {
    const databaseTargetGuard = verifyPreviewDatabaseTarget();
    await prisma.$queryRaw`SELECT 1`;
    logger.info('readiness_check', {
      requestId: req.requestId,
      status: 200,
      databaseTargetGuard: databaseTargetGuard.required ? 'pass' : 'not_required',
      durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
    });
    return res.json({ status: 'ready', database: 'ok', requestId: req.requestId });
  } catch (error) {
    const databaseTargetGuardFailed = error?.code === PREVIEW_DATABASE_TARGET_GUARD_ERROR;
    logger.error('readiness_failure', {
      requestId: req.requestId,
      status: 503,
      operation: 'readiness_check',
      errorName: error?.name,
      errorCode: error?.code,
      errorMessage: databaseTargetGuardFailed ? 'Preview database target guard failed.' : 'Database readiness check failed.',
      errorCategory: databaseTargetGuardFailed ? 'environment_validation' : errorCategory(error)
    });
    return res.status(503).json({ status: 'not_ready', database: 'unavailable', requestId: req.requestId });
  }
}
app.get('/ready', readiness);
app.get('/api/v1/ready', readiness);
app.use('/api/v1', routes);
app.use(notFound);
app.use(errorHandler);
module.exports = app;
