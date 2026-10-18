'use strict';

const { record } = require('../lib/route-latency-registry');

function routePattern(req) {
  if (req.route?.path) {
    const path = typeof req.route.path === 'string' ? req.route.path : '';
    return `${req.baseUrl || ''}${path}` || '/';
  }
  return String(req.path || req.originalUrl || '/').split('?')[0];
}

module.exports = function routeLatency(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    try {
      record({
        method: req.method,
        route: routePattern(req),
        status: res.statusCode,
        durationMs: Number(process.hrtime.bigint() - startedAt) / 1e6
      });
    } catch {
      // Observational telemetry must never affect request completion.
    }
  });
  next();
};

module.exports.routePattern = routePattern;
