const crypto = require('node:crypto');
const env = require('../config/env');
const HttpError = require('../utils/http-error');
const { getRequestIpIdentity } = require('../services/rate-limit-key');
const { createRateLimitStore } = require('../services/rate-limit-store');
const { createRateLimitEvaluator } = require('../services/rate-limit.service');
const { logger: defaultLogger } = require('../utils/logger');

function createPasskeyRateLimit(options = {}) {
  const storeType = options.storeType || env.rateLimitStore;
  const store = options.store || createRateLimitStore(storeType);
  const hashSecret = options.hashSecret || env.rateLimitHashSecret || (storeType === 'memory' ? crypto.randomBytes(32).toString('hex') : undefined);
  const limit = options.limit || Math.max(10, env.loginRateLimitMax * 2);
  const windowMs = options.windowMs || env.loginRateLimitWindowMs;
  const logger = options.logger || defaultLogger;
  const isVercel = options.isVercel ?? Boolean(process.env.VERCEL);
  const evaluate = createRateLimitEvaluator({ store, hashSecret, limit, windowMs, clock: options.clock });
  return async function passkeyRateLimit(req, res, next) {
    try {
      const result = await evaluate({ scope: 'passkey-ip', identity: getRequestIpIdentity(req, { isVercel }) });
      res.setHeader('RateLimit-Limit', limit);
      res.setHeader('RateLimit-Remaining', result.remaining);
      res.setHeader('RateLimit-Reset', Math.ceil(result.resetAt.getTime() / 1000));
      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfterSeconds);
        logger.warn?.('rate_limit_denied', { requestId: req.requestId, route: req.path, method: req.method || 'POST', status: 429, retryAfterSeconds: result.retryAfterSeconds });
        return next(new HttpError(429, 'มีการลองใช้ Passkey มากเกินไป กรุณาลองใหม่ภายหลัง'));
      }
      return next();
    } catch {
      logger.error('rate_limit_store_unavailable', { requestId: req.requestId, route: req.path, method: req.method || 'POST', status: 503, errorCategory: 'store_unavailable' });
      return next(new HttpError(503, 'ระบบยืนยันตัวตนไม่พร้อมใช้งานชั่วคราว'));
    }
  };
}

module.exports = createPasskeyRateLimit();
module.exports.createPasskeyRateLimit = createPasskeyRateLimit;
