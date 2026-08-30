const { logger: defaultLogger } = require('../utils/logger');
const { recordHttpRequest: defaultRecordHttpRequest } = require('../services/runtime-telemetry.service');

function routeTemplate(req) {
  if (!req.route?.path) {
    const known = new Set([
      '/health', '/ready', '/api/v1/health', '/api/v1/ready', '/api/v1/auth/login',
      '/api/v1/auth/refresh', '/api/v1/auth/logout', '/api/v1/auth/logout-all',
      '/api/v1/users', '/api/v1/employees'
    ]);
    if (known.has(req.path)) return req.path;
    if (/^\/api\/v1\/employees\/[0-9a-f-]{36}$/i.test(req.path)) return '/api/v1/employees/:id';
    return 'unmatched';
  }
  const base = req.baseUrl || '';
  const route = typeof req.route.path === 'string' ? req.route.path : 'route';
  return `${base}${route}`.replace(/\/+/g, '/') || '/';
}

function createRequestLogger(logger = defaultLogger, clock = () => process.hrtime.bigint(), recordHttpRequest = defaultRecordHttpRequest) {
  return function requestLogger(req, res, next) {
    const startedAt = clock();
    res.on('finish', () => {
      const elapsed = Number(clock() - startedAt) / 1e6;
      const record = {
        requestId: req.requestId,
        route: routeTemplate(req),
        method: req.method,
        status: res.statusCode,
        durationMs: Math.max(0, Math.round(elapsed * 100) / 100)
      };
      logger.info('http_request', record);
      try {
        recordHttpRequest?.({
          route: record.route,
          method: record.method,
          status: record.status,
          durationMs: record.durationMs
        });
      } catch {
        // Runtime telemetry is observational only and must never affect request completion.
      }
    });
    next();
  };
}

module.exports = createRequestLogger();
module.exports.createRequestLogger = createRequestLogger;
module.exports.routeTemplate = routeTemplate;
