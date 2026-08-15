'use strict';

const HEAVY_READ_PATHS = new Set([
  '/api/v1/dashboard',
  '/api/v1/executive-report',
  '/api/v1/reports/summary'
]);

const DEFAULT_RUNTIME_CEILING_MS = 60_000;
const DEFAULT_SAFETY_MARGIN_MS = 3_000;
const DEFAULT_QUIET_WINDOW_MS = 300;

const trackerByPage = new WeakMap();

function authenticatedMode(environment = process.env) {
  return String(environment.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
}

function requestPath(request) {
  try {
    return new URL(request.url()).pathname;
  } catch {
    return '';
  }
}

function isHeavyReadRequest(request) {
  return request?.method?.() === 'GET' && HEAVY_READ_PATHS.has(requestPath(request));
}

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

class HeavyReadSettlementTracker {
  constructor(page, {
    environment = process.env,
    runtimeCeilingMs = DEFAULT_RUNTIME_CEILING_MS,
    safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS,
    quietWindowMs = DEFAULT_QUIET_WINDOW_MS,
    now = () => Date.now(),
    setTimer = setTimeout,
    clearTimer = clearTimeout
  } = {}) {
    this.page = page;
    this.enabled = authenticatedMode(environment);
    this.runtimeCeilingMs = runtimeCeilingMs;
    this.safetyMarginMs = safetyMarginMs;
    this.quietWindowMs = quietWindowMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.outstanding = new Map();
    this.preventedBeforeNetwork = new WeakSet();
    this.waiters = new Set();
    this.generation = 0;
    this.realHeavyStarts = 0;
    this.preventedStarts = 0;
    this.ambiguousFailures = 0;
    this.ceilingSettlements = 0;
    this.closeViolation = false;
    this.stopped = false;

    this.onRequest = (request) => this.handleRequest(request);
    this.onRequestFinished = (request) => this.handleRequestFinished(request);
    this.onRequestFailed = (request) => this.handleRequestFailed(request);
    this.onClose = () => this.handlePageClose();

    if (this.enabled) {
      page.on('request', this.onRequest);
      page.on('requestfinished', this.onRequestFinished);
      page.on('requestfailed', this.onRequestFailed);
      page.on('close', this.onClose);
      trackerByPage.set(page, this);
    }
  }

  signal() {
    const waiters = [...this.waiters];
    this.waiters.clear();
    for (const resolve of waiters) resolve();
  }

  handleRequest(request) {
    if (!this.enabled || !isHeavyReadRequest(request)) return;
    this.realHeavyStarts += 1;
    this.generation += 1;
    this.outstanding.set(request, {
      startMs: this.now(),
      ambiguousFailure: false
    });
    this.signal();
  }

  preventBeforeNetwork(request) {
    if (!this.enabled || !isHeavyReadRequest(request)) return;
    this.preventedBeforeNetwork.add(request);
    if (this.outstanding.delete(request)) {
      this.realHeavyStarts -= 1;
      this.preventedStarts += 1;
      this.generation += 1;
      this.signal();
    }
  }

  handleRequestFinished(request) {
    if (!this.enabled || !this.outstanding.has(request)) return;
    this.outstanding.delete(request);
    this.generation += 1;
    this.signal();
  }

  handleRequestFailed(request) {
    if (!this.enabled || this.preventedBeforeNetwork.has(request)) return;
    const state = this.outstanding.get(request);
    if (!state || state.ambiguousFailure) return;
    state.ambiguousFailure = true;
    this.ambiguousFailures += 1;
    this.generation += 1;
    this.signal();
  }

  handlePageClose() {
    if (!this.enabled || this.outstanding.size === 0) return;
    this.closeViolation = true;
    this.signal();
  }

  deadlineFor(state) {
    return state.startMs + this.runtimeCeilingMs + this.safetyMarginMs;
  }

  expireAmbiguousFailures() {
    const now = this.now();
    let changed = false;
    for (const [request, state] of this.outstanding.entries()) {
      if (!state.ambiguousFailure || now < this.deadlineFor(state)) continue;
      this.outstanding.delete(request);
      this.ceilingSettlements += 1;
      changed = true;
    }
    if (changed) {
      this.generation += 1;
      this.signal();
    }
  }

  assertNoExpiredLiveRequest() {
    const now = this.now();
    for (const state of this.outstanding.values()) {
      if (!state.ambiguousFailure && now >= this.deadlineFor(state)) {
        throw safeError('UAT_HEAVY_READ_DRAIN_TIMEOUT');
      }
    }
  }

  nextDeadlineDelay() {
    const now = this.now();
    let delay = this.runtimeCeilingMs + this.safetyMarginMs;
    for (const state of this.outstanding.values()) {
      delay = Math.min(delay, Math.max(0, this.deadlineFor(state) - now));
    }
    return delay;
  }

  waitForSignalOrTimeout(delayMs) {
    return new Promise((resolve) => {
      let timer;
      const done = () => {
        if (timer) this.clearTimer(timer);
        this.waiters.delete(done);
        resolve();
      };
      this.waiters.add(done);
      timer = this.setTimer(done, Math.max(0, delayMs));
    });
  }

  async drain() {
    if (!this.enabled || (this.realHeavyStarts === 0 && this.outstanding.size === 0)) return this.summary();

    while (true) {
      if (this.closeViolation) throw safeError('UAT_HEAVY_READ_UNSETTLED_ON_PAGE_CLOSE');
      this.expireAmbiguousFailures();
      this.assertNoExpiredLiveRequest();

      if (this.outstanding.size === 0) {
        const quietGeneration = this.generation;
        await this.waitForSignalOrTimeout(this.quietWindowMs);
        if (this.closeViolation) throw safeError('UAT_HEAVY_READ_UNSETTLED_ON_PAGE_CLOSE');
        this.expireAmbiguousFailures();
        this.assertNoExpiredLiveRequest();
        if (this.outstanding.size === 0 && this.generation === quietGeneration) return this.summary();
        continue;
      }

      await this.waitForSignalOrTimeout(this.nextDeadlineDelay());
    }
  }

  summary() {
    return {
      realHeavyStarts: this.realHeavyStarts,
      preventedStarts: this.preventedStarts,
      ambiguousFailures: this.ambiguousFailures,
      ceilingSettlements: this.ceilingSettlements,
      outstanding: this.outstanding.size
    };
  }

  stop() {
    if (this.stopped || !this.enabled) return;
    this.stopped = true;
    this.page.off('request', this.onRequest);
    this.page.off('requestfinished', this.onRequestFinished);
    this.page.off('requestfailed', this.onRequestFailed);
    this.page.off('close', this.onClose);
    trackerByPage.delete(this.page);
    this.signal();
  }
}

function installHeavyReadSettlement(page, options) {
  return new HeavyReadSettlementTracker(page, options);
}

function preventHarnessBootstrapHeavyRead(page, request) {
  trackerByPage.get(page)?.preventBeforeNetwork(request);
}

module.exports = {
  DEFAULT_QUIET_WINDOW_MS,
  DEFAULT_RUNTIME_CEILING_MS,
  DEFAULT_SAFETY_MARGIN_MS,
  HEAVY_READ_PATHS,
  HeavyReadSettlementTracker,
  authenticatedMode,
  installHeavyReadSettlement,
  isHeavyReadRequest,
  preventHarnessBootstrapHeavyRead,
  requestPath
};
