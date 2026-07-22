const crypto = require('node:crypto');
const { APPROVED_ALERT_EVENT_CATEGORIES, safeEnvironment, safeRoute } = require('./alert-safety');

function createAlertDedupKey(input, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Alert deduplication key configuration is invalid.');
  if (!APPROVED_ALERT_EVENT_CATEGORIES.has(input.eventCategory)) throw new Error('Alert event category is not approved.');
  const windowStart = input.windowStart instanceof Date ? input.windowStart : new Date(input.windowStart);
  if (Number.isNaN(windowStart.getTime())) throw new Error('Alert aggregation window is invalid.');
  const canonical = JSON.stringify([
    input.eventCategory,
    safeRoute(input.route) || 'global',
    safeEnvironment(input.deploymentEnvironment),
    windowStart.toISOString()
  ]);
  return crypto.createHmac('sha256', secret).update(canonical).digest('hex');
}

module.exports = { createAlertDedupKey };
