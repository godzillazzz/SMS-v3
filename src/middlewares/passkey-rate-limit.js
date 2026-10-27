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
  const userIdScoped = options.userIdScoped === true;
  const evaluate = createRateLimitEvaluator({ store, hashSecret, limit, windowMs, clock: options.clock });
  const middleware = async function passkeyRateLimit(req, res, next) {
    try {
      const identity = userIdScoped ? req.user?.sub : getRequestIpIdentity(req, { isVercel });
      if (userIdScoped && (typeof identity !== 'string' || !identity)) return next(new HttpError(401, 'กรุณาเข้าสู่ระบบ'));
      const result = await evaluate({ scope: userIdScoped ? 'passkey-user' : 'passkey-ip', identity });
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
  middleware.rateLimitScope = userIdScoped ? 'user' : 'ip';
  middleware.store = store;
  middleware.storeType = storeType;
  middleware.hashSecret = hashSecret;
  return middleware;
}

const passkeyRateLimit = createPasskeyRateLimit();
passkeyRateLimit.createUserScoped = () => createPasskeyRateLimit({
  store: passkeyRateLimit.store,
  storeType: passkeyRateLimit.storeType,
  hashSecret: passkeyRateLimit.hashSecret,
  userIdScoped: true
});

module.exports = passkeyRateLimit;
module.exports.createPasskeyRateLimit = createPasskeyRateLimit;
