const { hashRateLimitIdentity } = require('./rate-limit-key');

function createRateLimitEvaluator({ store, hashSecret, limit, windowMs, clock = () => new Date() }) {
  return async function evaluate({ scope, identity }) {
    const nowValue = clock();
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
    const windowStartMs = Math.floor(now.getTime() / windowMs) * windowMs;
    const windowStart = new Date(windowStartMs);
    const expiresAt = new Date(windowStartMs + windowMs);
    const keyHash = hashRateLimitIdentity({ secret: hashSecret, scope, identity });
    const count = await store.increment({ scope, keyHash, windowStart, expiresAt, now });
    return {
      allowed: count <= limit,
      count,
      remaining: Math.max(0, limit - count),
      resetAt: expiresAt,
      retryAfterSeconds: Math.max(1, Math.ceil((expiresAt.getTime() - now.getTime()) / 1000))
    };
  };
}

module.exports = { createRateLimitEvaluator };
