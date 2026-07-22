const crypto = require('node:crypto');
const env = require('../config/env');
const HttpError = require('../utils/http-error');
const { getRequestIpIdentity, normalizeAccountIdentity } = require('../services/rate-limit-key');
const { createRateLimitStore } = require('../services/rate-limit-store');
const { createRateLimitEvaluator } = require('../services/rate-limit.service');
const { logger: defaultLogger } = require('../utils/logger');

const publicLimitMessage = 'Too many login attempts. Please try again later.';
const publicStoreFailureMessage = 'Service temporarily unavailable.';

function createLoginRateLimit(options = {}) {
  const storeType = options.storeType || env.rateLimitStore;
  const store = options.store || createRateLimitStore(storeType);
  const hashSecret = options.hashSecret || env.rateLimitHashSecret || (storeType === 'memory' ? crypto.randomBytes(32).toString('hex') : undefined);
  const limit = options.limit || env.loginRateLimitMax;
  const windowMs = options.windowMs || env.loginRateLimitWindowMs;
  const logger = options.logger || defaultLogger;
  const isVercel = options.isVercel ?? Boolean(process.env.VERCEL);
  const evaluate = createRateLimitEvaluator({ store, hashSecret, limit, windowMs, clock: options.clock });

  return async function loginRateLimit(req, res, next) {
    try {
      const results = await Promise.all([
        evaluate({ scope: 'login-ip', identity: getRequestIpIdentity(req, { isVercel }) }),
        evaluate({ scope: 'login-account', identity: normalizeAccountIdentity(req.body?.email) })
      ]);
      const remaining = Math.min(...results.map((result) => result.remaining));
      const resetAt = new Date(Math.max(...results.map((result) => result.resetAt.getTime())));
      const retryAfterSeconds = Math.max(...results.map((result) => result.retryAfterSeconds));
      res.setHeader('RateLimit-Limit', limit);
      res.setHeader('RateLimit-Remaining', remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(resetAt.getTime() / 1000));
      if (results.some((result) => !result.allowed)) {
        res.setHeader('Retry-After', retryAfterSeconds);
        logger.warn?.('rate_limit_denied', { requestId: req.requestId, route: '/api/v1/auth/login', method: req.method || 'POST', status: 429, retryAfterSeconds });
        return next(new HttpError(429, publicLimitMessage));
      }
      return next();
    } catch {
      logger.error('rate_limit_store_unavailable', { requestId: req.requestId, route: '/api/v1/auth/login', method: req.method || 'POST', status: 503, errorCategory: 'store_unavailable' });
      return next(new HttpError(503, publicStoreFailureMessage));
    }
  };
}

const loginRateLimit = createLoginRateLimit();
module.exports = loginRateLimit;
module.exports.createLoginRateLimit = createLoginRateLimit;
module.exports.publicLimitMessage = publicLimitMessage;
module.exports.publicStoreFailureMessage = publicStoreFailureMessage;
