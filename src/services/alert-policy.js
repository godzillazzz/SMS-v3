const crypto = require('node:crypto');
const { MemoryAlertDedupStore } = require('./alert-dedup-store');
const { createAlertDedupKey } = require('./alert-dedup-key');
const { safeTimestamp, safeEnvironment, safeRequestId, safeRoute } = require('./alert-safety');

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
    this.thresholds = options.thresholds || {};
    this.windowMs = options.windowMs || 5 * 60 * 1000;
    this.retentionSeconds = options.retentionSeconds || 7 * 24 * 60 * 60;
    this.dedupStore = options.dedupStore || new MemoryAlertDedupStore();
    this.dedupHashSecret = options.dedupHashSecret || crypto.randomBytes(32).toString('hex');
    this.onStoreFailure = options.onStoreFailure;
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

  dedupInput(record, selected) {
    const now = Number(this.clock());
    const occurredAt = new Date(now);
    const windowStart = new Date(Math.floor(now / this.windowMs) * this.windowMs);
    const route = safeRoute(record.route);
    const deploymentEnvironment = safeEnvironment(record.deploymentEnvironment);
    return {
      eventCategory: record.event,
      dedupKeyHash: createAlertDedupKey({
        eventCategory: record.event, route, deploymentEnvironment, windowStart
      }, this.dedupHashSecret),
      severity: selected.policy.severity,
      route,
      deploymentEnvironment,
      windowStart,
      threshold: selected.threshold,
      occurredAt,
      cooldownSeconds: this.cooldownSeconds,
      expiresAt: new Date(now + this.retentionSeconds * 1000)
    };
  }

  storeFailure(record) {
    const result = {
      delivered: false, status: 'store_unavailable', eligible: false, suppressed: false,
      occurrenceCount: 0, cooldownUntil: null, failureCategory: 'alert_dedup_store_unavailable'
    };
    try { this.onStoreFailure?.({ eventCategory: record.event, errorCategory: result.failureCategory }); } catch {}
    return result;
  }

  async evaluate(record = {}) {
    const selected = this.policyFor(record);
    if (!selected) return { delivered: false, status: 'dashboard_only', eligible: false, suppressed: false, occurrenceCount: 0, cooldownUntil: null };
    let input;
    let decision;
    try {
      input = this.dedupInput(record, selected);
      decision = await this.dedupStore.reserve(input);
    } catch {
      return this.storeFailure(record);
    }
    const safeState = {
      eligible: decision.eligible,
      suppressed: decision.suppressed,
      occurrenceCount: decision.occurrenceCount,
      cooldownUntil: decision.cooldownUntil.toISOString()
    };
    if (!decision.eligible) {
      const status = decision.occurrenceCount < selected.threshold ? 'threshold_pending' : 'cooldown_suppressed';
      return { delivered: false, status, ...safeState };
    }

    const payload = safePayload(record, selected.policy, this.clock);
    let result;
    try {
      result = await this.delivery.deliver(payload);
    } catch {
      try { await this.dedupStore.recordDelivery(input, 'failed', new Date(Number(this.clock()))); } catch { return this.storeFailure(record); }
      return { delivered: false, status: 'delivery_failed', ...safeState };
    }
    const deliveryStatus = result.delivered === true ? 'delivered' : (result.status === 'disabled' ? 'suppressed' : 'failed');
    const attemptedAt = result.status === 'disabled' ? undefined : new Date(Number(this.clock()));
    try {
      await this.dedupStore.recordDelivery(input, deliveryStatus, attemptedAt);
    } catch {
      return this.storeFailure(record);
    }
    return { delivered: result.delivered === true, status: result.status, ...safeState };
  }

  async reset(record) {
    if (!record) return this.dedupStore.reset();
    const selected = this.policyFor(record);
    if (!selected) return;
    return this.dedupStore.reset(this.dedupInput(record, selected));
  }
}

module.exports = { AlertPolicyEngine, safePayload };
