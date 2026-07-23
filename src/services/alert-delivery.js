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

class EnterpriseChatAlertDelivery {
  constructor(options = {}) {
    this.provider = 'enterprise_chat';
    this.enabled = options.enabled === true;
    this.destination = options.destination;
    this.token = options.token;
    this.timeoutMs = options.timeoutMs || 5000;

    // Fail closed if required configuration is missing under active flag
    if (this.enabled && (!this.destination || !this.token)) {
      throw new AlertConfigurationError();
    }
  }

  async deliver(payload) {
    if (!this.enabled) {
      return { delivered: false, status: 'disabled' };
    }
    if (!this.destination || !this.token) {
      return { delivered: false, status: 'failed_closed', error: 'Missing configuration' };
    }

    // Sanitize payload: use only safe alert payload fields
    // Exclude secret-like fields, raw request bodies, tokens, cookies, CSRF values, database details, stack traces, employee data
    const sanitizedPayload = {
      timestamp: payload.timestamp || new Date().toISOString(),
      event: payload.event || 'unknown_event',
      level: payload.level || 'info',
      status: payload.status,
      errorCategory: payload.errorCategory,
      message: payload.message || 'Synthetic alerting event'
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      const response = await fetch(this.destination, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.token}`
        },
        body: JSON.stringify(sanitizedPayload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return { delivered: false, status: 'failed', statusCode: response.status };
      }

      return { delivered: true, status: 'sent' };
    } catch (err) {
      const errorMessage = err.name === 'AbortError' ? 'timeout' : 'network_error';
      return { delivered: false, status: 'failed', error: errorMessage };
    }
  }
}

function createAlertDelivery(config = {}) {
  if (config.enabled !== true) return new DisabledAlertDelivery();
  if (config.provider === 'memory' && config.nodeEnv === 'test') {
    return new InMemoryAlertDelivery({ nodeEnv: config.nodeEnv });
  }
  if (config.provider === 'enterprise_chat') {
    return new EnterpriseChatAlertDelivery({
      enabled: config.enabled,
      destination: config.destination,
      token: config.token,
      timeoutMs: config.timeoutMs
    });
  }
  throw new AlertConfigurationError();
}

module.exports = {
  AlertConfigurationError,
  DisabledAlertDelivery,
  InMemoryAlertDelivery,
  EnterpriseChatAlertDelivery,
  createAlertDelivery
};
