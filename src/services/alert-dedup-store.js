const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const { logger: defaultLogger, errorCategory } = require('../utils/logger');

const DELIVERY_STATES = new Set(['pending', 'suppressed', 'delivered', 'failed']);

function validateInput(input) {
  if (!input || !input.eventCategory || !/^[a-f0-9]{64}$/.test(input.dedupKeyHash || '')) {
    throw new Error('Alert deduplication input is invalid.');
  }
  if (!DELIVERY_STATES.has(input.deliveryStatus || 'pending')) throw new Error('Alert delivery state is invalid.');
}

function compositeKey(input) {
  return `${input.eventCategory}:${input.dedupKeyHash}:${input.windowStart.toISOString()}`;
}

function safeDecision(record, eligible) {
  return {
    eligible,
    suppressed: !eligible,
    occurrenceCount: Number(record.occurrenceCount),
    cooldownUntil: new Date(record.cooldownUntil)
  };
}

class MemoryAlertDedupStore {
  constructor() { this.records = new Map(); }

  async reserve(input) {
    validateInput(input);
    const key = compositeKey(input);
    const current = this.records.get(key);
    const occurrenceCount = (current?.occurrenceCount || 0) + 1;
    const eligible = occurrenceCount >= input.threshold && (!current || current.cooldownUntil <= input.occurredAt);
    const cooldownUntil = eligible
      ? new Date(input.occurredAt.getTime() + input.cooldownSeconds * 1000)
      : (current?.cooldownUntil || new Date(input.occurredAt));
    const record = {
      id: current?.id || crypto.randomUUID(),
      eventCategory: input.eventCategory,
      dedupKeyHash: input.dedupKeyHash,
      severity: input.severity,
      windowStart: new Date(input.windowStart),
      occurrenceCount,
      lastOccurrenceAt: new Date(input.occurredAt),
      deliveryStatus: eligible ? 'pending' : 'suppressed',
      lastDeliveryAttemptAt: current?.lastDeliveryAttemptAt,
      cooldownUntil,
      expiresAt: new Date(Math.max(current?.expiresAt?.getTime() || 0, input.expiresAt.getTime())),
      createdAt: current?.createdAt || new Date(input.occurredAt),
      updatedAt: new Date(input.occurredAt)
    };
    this.records.set(key, record);
    return safeDecision(record, eligible);
  }

  async recordDelivery(input, deliveryStatus, attemptedAt) {
    if (!DELIVERY_STATES.has(deliveryStatus)) throw new Error('Alert delivery state is invalid.');
    const record = this.records.get(compositeKey(input));
    if (!record) throw new Error('Alert deduplication record is unavailable.');
    record.deliveryStatus = deliveryStatus;
    if (attemptedAt) record.lastDeliveryAttemptAt = new Date(attemptedAt);
    record.updatedAt = new Date(attemptedAt || input.occurredAt);
    return { updated: true };
  }

  async reset(input) {
    if (!input) { this.records.clear(); return; }
    this.records.delete(compositeKey(input));
  }

  async cleanupExpired(now = new Date()) {
    let removedCount = 0;
    for (const [key, record] of this.records.entries()) {
      if (record.expiresAt <= now) { this.records.delete(key); removedCount += 1; }
    }
    return removedCount;
  }

  entries() {
    return [...this.records.values()].map((record) => ({ ...record }));
  }
}

class PostgresAlertDedupStore {
  constructor(client = prisma, options = {}) {
    this.client = client;
    this.logger = options.logger || defaultLogger;
  }

  async reserve(input) {
    validateInput(input);
    const cooldownUntil = new Date(input.occurredAt.getTime() + input.cooldownSeconds * 1000);
    const rows = await this.client.$queryRaw`
      INSERT INTO "alert_deduplication_states" (
        "id", "event_category", "dedup_key_hash", "severity", "window_start",
        "occurrence_count", "last_occurrence_at", "delivery_status",
        "cooldown_until", "expires_at", "created_at", "updated_at"
      ) VALUES (
        gen_random_uuid(), ${input.eventCategory}, ${input.dedupKeyHash}, ${input.severity}, ${input.windowStart},
        1, ${input.occurredAt},
        CASE WHEN ${input.threshold} <= 1 THEN 'pending' ELSE 'suppressed' END,
        CASE WHEN ${input.threshold} <= 1 THEN ${cooldownUntil} ELSE ${input.occurredAt} END,
        ${input.expiresAt}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
      ON CONFLICT ("event_category", "dedup_key_hash", "window_start")
      DO UPDATE SET
        "occurrence_count" = "alert_deduplication_states"."occurrence_count" + 1,
        "last_occurrence_at" = EXCLUDED."last_occurrence_at",
        "delivery_status" = CASE
          WHEN "alert_deduplication_states"."occurrence_count" + 1 >= ${input.threshold}
            AND "alert_deduplication_states"."cooldown_until" <= ${input.occurredAt}
          THEN 'pending' ELSE 'suppressed' END,
        "cooldown_until" = CASE
          WHEN "alert_deduplication_states"."occurrence_count" + 1 >= ${input.threshold}
            AND "alert_deduplication_states"."cooldown_until" <= ${input.occurredAt}
          THEN ${cooldownUntil} ELSE "alert_deduplication_states"."cooldown_until" END,
        "expires_at" = GREATEST("alert_deduplication_states"."expires_at", EXCLUDED."expires_at"),
        "updated_at" = CURRENT_TIMESTAMP
      RETURNING "occurrence_count" AS "occurrenceCount", "cooldown_until" AS "cooldownUntil",
        ("delivery_status" = 'pending') AS "eligible"
    `;
    const record = rows[0];
    if (!record || !Number.isInteger(Number(record.occurrenceCount))) throw new Error('Alert deduplication update failed.');
    return safeDecision(record, record.eligible === true);
  }

  async recordDelivery(input, deliveryStatus, attemptedAt) {
    if (!DELIVERY_STATES.has(deliveryStatus)) throw new Error('Alert delivery state is invalid.');
    const result = await this.client.alertDeduplicationState.updateMany({
      where: { eventCategory: input.eventCategory, dedupKeyHash: input.dedupKeyHash, windowStart: input.windowStart },
      data: {
        deliveryStatus,
        ...(attemptedAt && { lastDeliveryAttemptAt: attemptedAt })
      }
    });
    if (result.count !== 1) throw new Error('Alert delivery state update failed.');
    return { updated: true };
  }

  async reset(input) {
    validateInput(input);
    await this.client.alertDeduplicationState.deleteMany({
      where: { eventCategory: input.eventCategory, dedupKeyHash: input.dedupKeyHash, windowStart: input.windowStart }
    });
  }

  async cleanupExpired(now = new Date()) {
    try {
      const result = await this.client.alertDeduplicationState.deleteMany({ where: { expiresAt: { lte: now } } });
      this.logger.info('alert_dedup_cleanup_result', { removedCount: result.count, status: 'success' });
      return result.count;
    } catch (error) {
      this.logger.error('alert_dedup_cleanup_failure', { status: 'failed', errorCategory: errorCategory(error) });
      throw error;
    }
  }
}

function createAlertDedupStore(type, options = {}) {
  if (type === 'memory') return new MemoryAlertDedupStore();
  if (type === 'postgres') return new PostgresAlertDedupStore(options.prismaClient || prisma, options);
  throw new Error('Unsupported alert deduplication store.');
}

module.exports = {
  DELIVERY_STATES, MemoryAlertDedupStore, PostgresAlertDedupStore, createAlertDedupStore
};
