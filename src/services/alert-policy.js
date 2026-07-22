const { InProcessAlertCooldown } = require('./alert-cooldown');

const IMMEDIATE_POLICIES = {
  readiness_failure: { severity: 'critical', guidance: 'Follow the approved readiness incident procedure.' },
  unexpected_http_5xx: { severity: 'critical', guidance: 'Review the safe server-error category and last approved deployment.' },
  rate_limit_store_unavailable: { severity: 'critical', guidance: 'Keep fail-closed behavior and follow the limiter-store incident procedure.' },
  application_config_invalid: { severity: 'critical', guidance: 'Stop startup and review configuration through approved secure controls.' },
  startup_dependency_failure: { severity: 'critical', guidance: 'Stop startup and follow the dependency-readiness incident procedure.' }
};

const THRESHOLD_POLICIES = {
  authentication_failure: { threshold: 'loginFailureSpike', severity: 'warning', guidance: 'Review approved authentication-failure aggregates.' },
  refresh_failure: { threshold: 'refreshFailureSpike', severity: 'warning', guidance: 'Review approved session-refresh failure aggregates.' },
  rate_limit_denied: { threshold: 'http429Spike', severity: 'warning', guidance: 'Review approved rate-limit denial aggregates before changing limits.' },
  function_timeout: { threshold: 'functionTimeoutCount', severity: 'critical', guidance: 'Review safe function duration and dependency signals.' }
};

const CLEANUP_POLICY = {
  severity: 'warning', guidance: 'Review the cleanup procedure and limiter-table growth using safe aggregates.'
};

const DATABASE_LATENCY_POLICY = {
  severity: 'warning', guidance: 'Review approved database latency and capacity signals.'
};

function safeTimestamp(value, fallback) {
  const parsed = value ? new Date(value) : fallback;
  return Number.isNaN(parsed.getTime()) ? fallback.toISOString() : parsed.toISOString();
}

function safeEnvironment(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,32}$/.test(value) ? value : 'unknown';
}

function safeRequestId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined;
}

function safeRoute(value) {
  return typeof value === 'string' && /^\/[A-Za-z0-9_/:.-]{0,199}$/.test(value) && !value.includes('//') ? value : undefined;
}

function safePayload(record, policy, clock) {
  const fallback = new Date(Number(clock()));
  const payload = {
    eventCategory: record.event,
    severity: policy.severity,
    timestamp: safeTimestamp(record.timestamp, fallback),
    deploymentEnvironment: safeEnvironment(record.deploymentEnvironment),
    guidance: policy.guidance
  };
  const requestId = safeRequestId(record.requestId);
  const route = safeRoute(record.route);
  if (requestId) payload.requestId = requestId;
  if (route) payload.route = route;
  return payload;
}

class AlertPolicyEngine {
  constructor(options = {}) {
    if (!options.delivery || typeof options.delivery.deliver !== 'function') throw new Error('Alert delivery is required.');
    this.delivery = options.delivery;
    this.clock = options.clock || Date.now;
    this.cooldownSeconds = options.cooldownSeconds || 300;
    this.cooldown = options.cooldown || new InProcessAlertCooldown({ clock: this.clock });
    this.thresholds = options.thresholds || {};
    this.windowMs = options.windowMs || 5 * 60 * 1000;
    this.counters = new Map();
  }

  count(eventCategory) {
    const now = Number(this.clock());
    const current = this.counters.get(eventCategory);
    if (!current || now >= current.windowEndsAt) {
      const next = { count: 1, windowEndsAt: now + this.windowMs };
      this.counters.set(eventCategory, next);
      return next.count;
    }
    current.count += 1;
    return current.count;
  }

  policyFor(record) {
    if (Object.hasOwn(IMMEDIATE_POLICIES, record.event)) return { policy: IMMEDIATE_POLICIES[record.event], threshold: 1 };
    if (record.event === 'rate_limit_cleanup_failure') return { policy: CLEANUP_POLICY, threshold: 2 };
    if (record.event === 'database_latency') {
      const threshold = this.thresholds.databaseLatencyMs;
      if (!threshold || !Number.isFinite(record.durationMs) || record.durationMs < threshold) return undefined;
      return { policy: DATABASE_LATENCY_POLICY, threshold: 1 };
    }
    const thresholdPolicy = Object.hasOwn(THRESHOLD_POLICIES, record.event) ? THRESHOLD_POLICIES[record.event] : undefined;
    if (!thresholdPolicy) return undefined;
    const threshold = this.thresholds[thresholdPolicy.threshold];
    if (!Number.isInteger(threshold) || threshold < 1) return undefined;
    return { policy: thresholdPolicy, threshold };
  }

  evaluate(record = {}) {
    const selected = this.policyFor(record);
    if (!selected) return { delivered: false, status: 'dashboard_only', aggregateCount: 0 };
    const aggregateCount = this.count(record.event);
    if (aggregateCount < selected.threshold) return { delivered: false, status: 'threshold_pending', aggregateCount };

    const route = safeRoute(record.route) || 'global';
    const cooldownKey = `${record.event}:${route}`;
    const cooldown = this.cooldown.evaluate(cooldownKey, this.cooldownSeconds);
    if (!cooldown.allowed) return { delivered: false, status: 'cooldown_suppressed', aggregateCount };

    const payload = safePayload(record, selected.policy, this.clock);
    const result = this.delivery.deliver(payload);
    return { delivered: result.delivered === true, status: result.status, aggregateCount };
  }

  reset() {
    this.counters.clear();
    this.cooldown.reset();
  }
}

module.exports = { AlertPolicyEngine, safePayload };
