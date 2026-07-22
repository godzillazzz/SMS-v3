class AlertConfigurationError extends Error {
  constructor() {
    super('Alerting configuration is unsupported or incomplete.');
    this.name = 'AlertConfigurationError';
    this.code = 'ALERT_CONFIGURATION_INVALID';
  }
}

class DisabledAlertDelivery {
  constructor() { this.provider = 'disabled'; }

  deliver() {
    return { delivered: false, status: 'disabled' };
  }
}

class InMemoryAlertDelivery {
  constructor(options = {}) {
    if ((options.nodeEnv || process.env.NODE_ENV) !== 'test') throw new AlertConfigurationError();
    this.provider = 'memory';
    this.records = [];
  }

  deliver(payload) {
    const record = JSON.parse(JSON.stringify(payload));
    this.records.push(record);
    return { delivered: true, status: 'recorded_for_test' };
  }

  getRecords() { return this.records.map((record) => ({ ...record })); }
  reset() { this.records.length = 0; }
}

function createAlertDelivery(config = {}) {
  if (config.enabled !== true) return new DisabledAlertDelivery();
  if (config.provider === 'memory' && config.nodeEnv === 'test') {
    return new InMemoryAlertDelivery({ nodeEnv: config.nodeEnv });
  }
  throw new AlertConfigurationError();
}

module.exports = {
  AlertConfigurationError,
  DisabledAlertDelivery,
  InMemoryAlertDelivery,
  createAlertDelivery
};
