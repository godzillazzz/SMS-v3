const env = require('../config/env');
const HttpError = require('../utils/http-error');
const attempts = new Map();
function loginRateLimit(req, res, next) {
  const key = req.ip || 'unknown'; const now = Date.now(); const entry = attempts.get(key);
  const active = !entry || now - entry.startedAt >= env.loginRateLimitWindowMs ? { startedAt: now, count: 0 } : entry;
  active.count += 1; attempts.set(key, active);
  res.setHeader('RateLimit-Limit', env.loginRateLimitMax);
  if (active.count > env.loginRateLimitMax) return next(new HttpError(429, 'Too many login attempts. Please try again later.'));
  return next();
}
module.exports = loginRateLimit;
