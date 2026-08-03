const prisma = require('../config/prisma');
const env = require('../config/env');
const { createAlertDedupStore } = require('./alert-dedup-store');
const { createAlertDedupKey } = require('./alert-dedup-key');
const { sendNotification } = require('./notification-email.service');
const { logger, errorCategory } = require('../utils/logger');

const POLICIES = {
  email_delivery_failure: { threshold: 3, cooldownSeconds: 3600 },
  daily_digest_failure: { threshold: 1, cooldownSeconds: 3600 },
  expiry_cron_failure: { threshold: 1, cooldownSeconds: 3600 },
  storage_failure: { threshold: 3, cooldownSeconds: 3600 },
  readiness_failure: { threshold: 3, cooldownSeconds: 3600 },
  workflow_status_mismatch: { threshold: 1, cooldownSeconds: 3600 },
  missing_recipient: { threshold: 1, cooldownSeconds: 3600 },
  missing_manager: { threshold: 1, cooldownSeconds: 3600 }
};

function adminEmails(client) {
  return client.user.findMany({ where: { role: 'ADMIN', isActive: true, accountStatus: 'ACTIVE', email: { not: '' } }, select: { email: true } }).then((users) => [...new Set(users.map((user) => String(user.email).trim().toLowerCase()).filter(Boolean))]);
}

function createOperationalAnomalyReporter({ client = prisma, now = () => new Date(), dedupStore } = {}) {
  const store = dedupStore || createAlertDedupStore('postgres', { prismaClient: client });
  return async function reportOperationalAnomaly({ type, safeMessage = 'ตรวจพบความผิดปกติของระบบ', entityId = 'system' }) {
    const policy = POLICIES[type];
    if (!policy) return { status: 'unsupported' };
    const occurredAt = now();
    const windowStart = new Date(Math.floor(occurredAt.getTime() / (5 * 60 * 1000)) * (5 * 60 * 1000));
    const input = {
      eventCategory: `operational_${type}`,
      dedupKeyHash: createAlertDedupKey({ eventCategory: `operational_${type}`, deploymentEnvironment: env.nodeEnv, route: entityId, windowStart }, env.alertDedupHashSecret || 'operational-email-deduplication-key-v1'),
      severity: 'critical', windowStart, threshold: policy.threshold, occurredAt,
      cooldownSeconds: policy.cooldownSeconds, expiresAt: new Date(occurredAt.getTime() + 7 * 24 * 60 * 60 * 1000)
    };
    let decision;
    try { decision = await store.reserve(input); } catch (error) {
      logger.error('operational_anomaly_reservation_failed', { errorCategory: errorCategory(error), anomalyType: type });
      return { status: 'reservation_failed' };
    }
    if (!decision.eligible) return { status: 'suppressed', occurrenceCount: decision.occurrenceCount };
    let result;
    try {
      const recipients = await adminEmails(client);
      if (!recipients.length) result = { status: 'no_admin_recipient', delivered: false };
      else result = await sendNotification({ to: recipients, subject: `ระบบแจ้งเตือนความผิดปกติ: ${type}`, html: `<p>ประเภทเหตุการณ์: ${type}</p><p>สถานะ: ต้องตรวจสอบ</p><p>รายละเอียดปลอดภัย: ${safeMessage}</p>` }, { eventKey: `system-anomaly:${type}:${windowStart.toISOString()}`, isAnomaly: true, prismaClient: client });
    } catch (error) {
      logger.error('operational_anomaly_delivery_failed', { errorCategory: errorCategory(error), anomalyType: type });
      result = { status: 'failed', delivered: false };
    }
    const deliveryStatus = result?.status === 'sent' ? 'delivered' : 'failed';
    await store.recordDelivery(input, deliveryStatus, occurredAt).catch((error) => logger.error('operational_anomaly_state_failed', { errorCategory: errorCategory(error), anomalyType: type }));
    return { status: result?.status || 'failed', delivered: deliveryStatus === 'delivered', occurrenceCount: decision.occurrenceCount };
  };
}

const reportOperationalAnomaly = createOperationalAnomalyReporter();

module.exports = { POLICIES, createOperationalAnomalyReporter, reportOperationalAnomaly };
