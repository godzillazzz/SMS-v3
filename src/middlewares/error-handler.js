const { ZodError } = require('zod');
const { logger, errorCategory } = require('../utils/logger');

function notFound(req, _res, next) {
  const error = new Error('Route not found.');
  error.statusCode = 404;
  next(error);
}

function databaseOperation(req) {
  const method = String(req?.method || '').toUpperCase();
  const path = String(req?.originalUrl || req?.path || '').split('?')[0];
  if (method === 'POST' && /^\/api\/v1\/employees\/[^/]+\/lifecycle$/.test(path)) return 'employee_lifecycle_mutation';
  if (method === 'POST' && /^\/api\/v1\/employees\/[^/]+\/lifecycle\/preflight$/.test(path)) return 'employee_lifecycle_preflight';
  return 'request_database_operation';
}

function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    const firstIssue = error.issues && error.issues[0];
    const fieldPath = firstIssue?.path?.join('.') || '';
    const detailMsg = fieldPath ? `Validation failed: ${fieldPath} (${firstIssue.message})` : 'Validation failed.';
    return res.status(400).json({ error: detailMsg, details: error.flatten(), requestId: _req.requestId });
  }
  const requestId = _req.requestId;
  const databaseResponses = {
    P2002: [409, 'A record with this value already exists.'],
    P2025: [404, 'Record not found.'], P2003: [409, 'This operation conflicts with related records.'],
    P2023: [400, 'Invalid input format.']
  };
  if (databaseResponses[error.code]) {
    const [status, message] = databaseResponses[error.code];
    logger.warn('database_operation_failure', { requestId, status, operation: databaseOperation(_req), errorCode: error?.code, errorCategory: errorCategory(error) });
    return res.status(status).json({ error: message, requestId });
  }
  const isDatabaseConnectionError = ['P1000', 'P1001', 'P1002', 'P1008', 'P1011', 'P1017', 'P2024', 'P2028'].includes(error.code)
    || error.name === 'PrismaClientInitializationError';
  const status = isDatabaseConnectionError ? 503 : (error.statusCode || 500);
  if (isDatabaseConnectionError) {
    logger.error('database_operation_failure', {
      requestId,
      status,
      operation: databaseOperation(_req),
      errorName: error?.name,
      errorCode: error?.code,
      errorCategory: errorCategory(error)
    });
  } else if (status >= 500) {
    logger.error(error.isOperational ? 'http_5xx' : 'unexpected_http_5xx', { requestId, status, errorCategory: errorCategory(error), error });
  }
  const message = error.publicMessage || (isDatabaseConnectionError ? 'Database unavailable.' : (status >= 500 ? 'Internal server error.' : (error.message || 'Internal server error.')));
  return res.status(status).json({ error: message, requestId, ...(error.details && status < 500 && { details: error.details }) });
}

module.exports = { notFound, errorHandler, databaseOperation };
