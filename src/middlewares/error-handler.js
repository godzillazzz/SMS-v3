const { ZodError } = require('zod');

function notFound(req, _res, next) {
  const error = new Error(`Route not found: ${req.method} ${req.originalUrl}`);
  error.statusCode = 404;
  next(error);
}

function errorHandler(error, _req, res, _next) {
  if (error instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed.', details: error.flatten(), requestId: _req.requestId });
  }
  const requestId = _req.requestId;
  if (error.code === 'P2002') return res.status(409).json({ error: 'A record with this value already exists.', requestId });
  if (error.code === 'P2025') return res.status(404).json({ error: 'Record not found.', requestId });
  if (error.code === 'P2003') return res.status(409).json({ error: 'This operation conflicts with related records.', requestId });
  if (error.code === 'P2023') return res.status(400).json({ error: 'Invalid input format.', requestId });
  const isDatabaseConnectionError = ['P1000', 'P1001', 'P1017'].includes(error.code);
  const status = isDatabaseConnectionError ? 503 : (error.statusCode || 500);
  if (status >= 500) console.error({ requestId, error });
  const message = error.publicMessage || (isDatabaseConnectionError ? 'Database unavailable.' : (status >= 500 ? 'Internal server error.' : (error.message || 'Internal server error.')));
  return res.status(status).json({ error: message, requestId, ...(error.details && status < 500 && { details: error.details }) });
}

module.exports = { notFound, errorHandler };
