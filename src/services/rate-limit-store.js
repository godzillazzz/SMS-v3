const prisma = require('../config/prisma');

class MemoryRateLimitStore {
  constructor() { this.buckets = new Map(); }

  async increment({ scope, keyHash, windowStart, expiresAt, now }) {
    await this.cleanupExpired(now);
    const bucketKey = `${scope}:${keyHash}:${windowStart.toISOString()}`;
    const existing = this.buckets.get(bucketKey);
    const count = (existing?.count || 0) + 1;
    this.buckets.set(bucketKey, { scope, keyHash, windowStart, count, expiresAt });
    return count;
  }

  async cleanupExpired(now = new Date()) {
    let count = 0;
    for (const [key, bucket] of this.buckets.entries()) {
      if (bucket.expiresAt <= now) { this.buckets.delete(key); count += 1; }
    }
    return count;
  }

  entries() { return [...this.buckets.values()]; }
}

class PostgresRateLimitStore {
  constructor(client = prisma) { this.client = client; }

  async increment({ scope, keyHash, windowStart, expiresAt, now }) {
    const rows = await this.client.$queryRaw`
      WITH "expired_rate_limit_buckets" AS (
        DELETE FROM "rate_limit_buckets"
        WHERE "expires_at" <= ${now}
        RETURNING "id"
      )
      INSERT INTO "rate_limit_buckets" (
        "id", "scope", "key_hash", "window_start", "count", "expires_at", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(), ${scope}, ${keyHash}, ${windowStart}, 1, ${expiresAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("scope", "key_hash", "window_start")
      DO UPDATE SET
        "count" = "rate_limit_buckets"."count" + 1,
        "expires_at" = EXCLUDED."expires_at",
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING "count"
    `;
    const count = Number(rows[0]?.count);
    if (!Number.isInteger(count) || count < 1) throw new Error('Rate-limit counter update failed.');
    return count;
  }

  async cleanupExpired(now = new Date()) {
    const result = await this.client.rateLimitBucket.deleteMany({ where: { expiresAt: { lte: now } } });
    return result.count;
  }
}

function createRateLimitStore(type, options = {}) {
  if (type === 'memory') return new MemoryRateLimitStore();
  if (type === 'postgres') return new PostgresRateLimitStore(options.prismaClient || prisma);
  throw new Error('Unsupported rate-limit store.');
}

module.exports = { MemoryRateLimitStore, PostgresRateLimitStore, createRateLimitStore };
