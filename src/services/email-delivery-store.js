const crypto = require('node:crypto');
const prisma = require('../config/prisma');
const { errorCategory } = require('../utils/logger');

const RESERVATION_TTL_MS = 10 * 60 * 1000;
const RETRY_DELAY_MS = 60 * 1000;

function safeResult(status, extra = {}) { return { status, ...extra }; }

class MemoryEmailDeliveryStore {
  constructor({ now = () => new Date() } = {}) { this.now = now; this.records = new Map(); }

  async reserve(eventKey) {
    const now = this.now();
    const existing = this.records.get(eventKey);
    if (!existing) {
      const record = { id: crypto.randomUUID(), eventKey, status: 'RESERVED', attemptCount: 1, reservedAt: now };
      this.records.set(eventKey, record);
      return safeResult('RESERVED', { record });
    }
    if (existing.status === 'SENT') return safeResult('ALREADY_SENT', { record: existing });
    if (existing.status === 'RESERVED' && now.getTime() - existing.reservedAt.getTime() < RESERVATION_TTL_MS) return safeResult('ALREADY_RESERVED', { record: existing });
    if (existing.status === 'FAILED' && existing.retryAfter > now) return safeResult('RETRY_LATER', { record: existing });
    existing.status = 'RESERVED'; existing.reservedAt = now; existing.attemptCount += 1; existing.retryAfter = null;
    return safeResult('RESERVED', { record: existing });
  }

  async markSent(eventKey, sentAt = this.now()) {
    const record = this.records.get(eventKey); if (!record || record.status !== 'RESERVED') return false;
    record.status = 'SENT'; record.sentAt = sentAt; record.updatedAt = sentAt; return true;
  }

  async markFailed(eventKey, error, failedAt = this.now()) {
    const record = this.records.get(eventKey); if (!record || record.status !== 'RESERVED') return false;
    record.status = 'FAILED'; record.failedAt = failedAt; record.retryAfter = new Date(failedAt.getTime() + RETRY_DELAY_MS); record.lastErrorCategory = errorCategory(error); record.lastErrorSafe = record.lastErrorCategory; return true;
  }

  entries() { return [...this.records.values()].map((record) => ({ ...record })); }
}

class PostgresEmailDeliveryStore {
  constructor(client = prisma) { this.client = client; }

  async reserve(eventKey, now = new Date()) {
    try {
      const record = await this.client.emailDeliveryReservation.create({ data: { eventKey, status: 'RESERVED', reservedAt: now } });
      return safeResult('RESERVED', { record });
    } catch (error) {
      if (error?.code !== 'P2002') throw error;
      const current = await this.client.emailDeliveryReservation.findUnique({ where: { eventKey } });
      if (!current) throw error;
      if (current.status === 'SENT') return safeResult('ALREADY_SENT', { record: current });
      if (current.status === 'RESERVED' && now.getTime() - new Date(current.reservedAt).getTime() < RESERVATION_TTL_MS) return safeResult('ALREADY_RESERVED', { record: current });
      if (current.status === 'FAILED' && current.retryAfter && new Date(current.retryAfter) > now) return safeResult('RETRY_LATER', { record: current });
      const updated = await this.client.emailDeliveryReservation.updateMany({ where: { eventKey, status: 'FAILED', OR: [{ retryAfter: null }, { retryAfter: { lte: now } }] }, data: { status: 'RESERVED', reservedAt: now, attemptCount: { increment: 1 }, retryAfter: null, lastErrorCategory: null, lastErrorSafe: null } });
      if (updated.count === 1) return safeResult('RESERVED', { record: await this.client.emailDeliveryReservation.findUnique({ where: { eventKey } }) });
      return safeResult('ALREADY_RESERVED', { record: await this.client.emailDeliveryReservation.findUnique({ where: { eventKey } }) });
    }
  }

  async markSent(eventKey, sentAt = new Date()) {
    const result = await this.client.emailDeliveryReservation.updateMany({ where: { eventKey, status: 'RESERVED' }, data: { status: 'SENT', sentAt } });
    return result.count === 1;
  }

  async markFailed(eventKey, error, failedAt = new Date()) {
    const result = await this.client.emailDeliveryReservation.updateMany({ where: { eventKey, status: 'RESERVED' }, data: { status: 'FAILED', failedAt, retryAfter: new Date(failedAt.getTime() + RETRY_DELAY_MS), lastErrorCategory: errorCategory(error), lastErrorSafe: errorCategory(error) } });
    return result.count === 1;
  }
}

module.exports = { RESERVATION_TTL_MS, RETRY_DELAY_MS, MemoryEmailDeliveryStore, PostgresEmailDeliveryStore };
