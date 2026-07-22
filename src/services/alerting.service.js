const { createAlertDelivery } = require('./alert-delivery');
const { AlertPolicyEngine } = require('./alert-policy');

function createConfiguredAlerting(config) {
  const delivery = createAlertDelivery({
    enabled: config.alertingEnabled,
    provider: config.alertingProvider,
    nodeEnv: config.nodeEnv
  });
  const policy = new AlertPolicyEngine({
    delivery,
    cooldownSeconds: config.alertCooldownSeconds,
    thresholds: config.alertThresholds
  });
  return { delivery, policy, evaluate: (record) => policy.evaluate(record) };
}

module.exports = { createConfiguredAlerting };
