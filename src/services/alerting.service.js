const crypto = require('node:crypto');
const { createAlertDelivery } = require('./alert-delivery');
const { createAlertDedupStore } = require('./alert-dedup-store');
const { AlertPolicyEngine } = require('./alert-policy');

function createConfiguredAlerting(config, options = {}) {
  const delivery = createAlertDelivery({
    enabled: config.alertingEnabled,
    provider: config.alertingProvider,
    token: config.alertingApiToken,
    destination: config.alertingDestinationId,
    timeoutMs: config.alertingTimeoutMs,
    nodeEnv: config.nodeEnv
  });
  if (config.alertDedupStore === 'postgres' && !config.alertDedupHashSecret) {
    throw new Error('Alert deduplication configuration is invalid.');
  }
  const dedupStore = options.dedupStore || createAlertDedupStore(config.alertDedupStore || 'memory', options);
  const policy = new AlertPolicyEngine({
    delivery,
    cooldownSeconds: config.alertCooldownSeconds,
    thresholds: config.alertThresholds,
    retentionSeconds: config.alertDedupRetentionSeconds,
    dedupStore,
    dedupHashSecret: config.alertDedupHashSecret || crypto.randomBytes(32).toString('hex'),
    onStoreFailure: options.onStoreFailure
  });
  return { delivery, dedupStore, policy, evaluate: (record) => policy.evaluate(record) };
}

module.exports = { createConfiguredAlerting };
