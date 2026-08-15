'use strict';

const HEAVY_PATHS = new Set([
  '/api/v1/dashboard',
  '/api/v1/executive-report',
  '/api/v1/reports/summary'
]);

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_RUNTIME_CEILING_MS = 60_000;
const DEFAULT_SAFETY_MARGIN_MS = 3_000;

const preventedByPage = new WeakMap();
const trackerByPage = new WeakMap();

const safetyMetrics = {
  testsFinishingWithOutstandingHeavyReads: 0,
  exceptionalHeavyDrainCount: 0,
  exceptionalHeavyDrainWaitMs: 0
};

function safeError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function pathOf(value) {
  try {
    const url = typeof value === 'string' ? value : value.url();
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isHeavyGetRequest(request) {
  return request?.method?.() === 'GET' && HEAVY_PATHS.has(pathOf(request));
}

function preventedSet(page) {
  let set = preventedByPage.get(page);
  if (!set) {
    set = new WeakSet();
    preventedByPage.set(page, set);
  }
  return set;
}

function markHarnessPreventedHeavyRead(page, request) {
  preventedSet(page).add(request);
  const tracker = trackerByPage.get(page);
  if (tracker) tracker.markPrevented(request);
}

function delay(ms, timers = globalThis) {
  return new Promise((resolve) => timers.setTimeout(resolve, Math.max(0, ms)));
}

function waitForChangeOrDeadline(changePromise, ms, timers = globalThis) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      timers.clearTimeout(timeoutId);
      resolve();
    };
    const timeoutId = timers.setTimeout(finish, Math.max(0, ms));
    changePromise.then(finish, finish);
  });
}
function withTimeout(promise, timeoutMs, code, timers = globalThis) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = timers.setTimeout(() => reject(safeError(code)), timeoutMs);
    })
  ]).finally(() => {
    if (timeoutId !== undefined) timers.clearTimeout(timeoutId);
  });
}

async function performAndWaitForHeavyRequest(page, expectedPath, action, {
  timeout = DEFAULT_REQUEST_TIMEOUT_MS,
  validateStatus = true,
  timers = globalThis
} = {}) {
  if (!HEAVY_PATHS.has(expectedPath)) throw safeError('UAT_HEAVY_READ_ROUTE_NOT_APPROVED');

  let matchedRequest;
  let matchedResponse;
  let requestResolve;
  let responseResolve;
  let finishedResolve;
  let finishedReject;
  const requestPromise = new Promise((resolve) => { requestResolve = resolve; });
  const responsePromise = new Promise((resolve) => { responseResolve = resolve; });
  const finishedPromise = new Promise((resolve, reject) => {
    finishedResolve = resolve;
    finishedReject = reject;
  });

  const onRequest = (request) => {
    if (matchedRequest || request.method() !== 'GET' || pathOf(request) !== expectedPath) return;
    matchedRequest = request;
    requestResolve(request);
  };
  const onResponse = (response) => {
    const request = response.request();
    if (!matchedRequest || request !== matchedRequest) return;
    matchedResponse = response;
    responseResolve(response);
  };
  const onFinished = (request) => {
    if (matchedRequest && request === matchedRequest) finishedResolve(request);
  };
  const onFailed = (request) => {
    if (matchedRequest && request === matchedRequest) finishedReject(safeError('UAT_REQUIRED_HEAVY_READ_FAILED'));
  };

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);

  let actionError;
  let rejectActionFailure;
  const actionFailure = new Promise((_, reject) => { rejectActionFailure = reject; });
  const actionPromise = Promise.resolve()
    .then(action)
    .catch((error) => {
      actionError = error;
      rejectActionFailure(error);
      return undefined;
    });

  try {
    await withTimeout(Promise.race([requestPromise, actionFailure]), timeout, 'UAT_REQUIRED_HEAVY_READ_NOT_STARTED', timers);
    await withTimeout(Promise.all([responsePromise, finishedPromise]), timeout, 'UAT_REQUIRED_HEAVY_READ_TIMEOUT', timers);
    await actionPromise;
    if (actionError) throw actionError;
    if (!matchedResponse) throw safeError('UAT_REQUIRED_HEAVY_READ_RESPONSE_MISSING');
    const status = matchedResponse.status();
    if (validateStatus && (status < 200 || status >= 300)) {
      const error = safeError(status === 504 ? 'UAT_RUNTIME_HEAVY_504' : `UAT_RUNTIME_HEAVY_HTTP_${status}`);
      error.status = status;
      throw error;
    }
    return matchedResponse;
  } finally {
    page.off('request', onRequest);
    page.off('response', onResponse);
    page.off('requestfinished', onFinished);
    page.off('requestfailed', onFailed);
  }
}

function createHeavyReadSafetyTracker(page, {
  now = () => Date.now(),
  timers = globalThis,
  runtimeCeilingMs = DEFAULT_RUNTIME_CEILING_MS,
  safetyMarginMs = DEFAULT_SAFETY_MARGIN_MS
} = {}) {
  const outstanding = new Map();
  const waiters = new Set();
  let closed = false;
  let preventedStarts = 0;
  let realHeavyStarts = 0;

  const notify = () => {
    for (const resolve of [...waiters]) resolve();
    waiters.clear();
  };
  const nextChange = () => new Promise((resolve) => waiters.add(resolve));

  const onRequest = (request) => {
    if (!isHeavyGetRequest(request)) return;
    if (preventedSet(page).has(request)) {
      preventedStarts += 1;
      return;
    }
    realHeavyStarts += 1;
    outstanding.set(request, { startedAt: now(), failedAt: undefined });
    notify();
  };
  const onFinished = (request) => {
    if (!outstanding.has(request)) return;
    outstanding.delete(request);
    notify();
  };
  const onFailed = (request) => {
    const state = outstanding.get(request);
    if (!state) return;
    state.failedAt = now();
    notify();
  };
  const onClose = () => {
    closed = true;
    notify();
  };

  page.on('request', onRequest);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);
  page.on('close', onClose);

  const tracker = {
    markPrevented(request) {
      preventedSet(page).add(request);
      if (outstanding.delete(request)) {
        preventedStarts += 1;
        realHeavyStarts -= 1;
        notify();
      }
    },
    summary() {
      const current = now();
      const outstandingHeavyReads = [...outstanding.entries()].map(([request, state]) => ({
        method: request?.method?.() === 'GET' ? 'GET' : 'UNKNOWN',
        path: pathOf(request),
        ageMs: Math.max(0, current - state.startedAt),
        state: state.failedAt === undefined ? 'LIVE' : 'CLIENT_FAILED'
      }));
      return {
        outstanding: outstanding.size,
        outstandingHeavyReads,
        preventedStarts,
        realHeavyStarts,
        closed
      };
    },
    async assertNormalCompletion() {
      if (outstanding.size === 0) return this.summary();

      safetyMetrics.testsFinishingWithOutstandingHeavyReads += 1;
      safetyMetrics.exceptionalHeavyDrainCount += 1;
      const waitStartedAt = now();
      try {
        if (closed) throw safeError('UAT_UNEXPECTED_OUTSTANDING_HEAVY_READ');
        while (outstanding.size > 0) {
          const current = now();
          let nextDeadline = Infinity;
          let liveTimedOut = false;
          for (const [request, state] of [...outstanding.entries()]) {
            const deadline = state.startedAt + runtimeCeilingMs + safetyMarginMs;
            nextDeadline = Math.min(nextDeadline, deadline);
            if (current < deadline) continue;
            if (state.failedAt !== undefined) outstanding.delete(request);
            else liveTimedOut = true;
          }
          if (liveTimedOut) throw safeError('UAT_HEAVY_READ_DRAIN_TIMEOUT');
          if (outstanding.size === 0) break;
          await waitForChangeOrDeadline(
            nextChange(),
            Math.max(0, nextDeadline - now()),
            timers
          );
          if (closed && outstanding.size > 0) throw safeError('UAT_UNEXPECTED_OUTSTANDING_HEAVY_READ');
        }
      } finally {
        safetyMetrics.exceptionalHeavyDrainWaitMs += Math.max(0, now() - waitStartedAt);
      }
      throw safeError('UAT_UNEXPECTED_OUTSTANDING_HEAVY_READ');
    },
    stop() {
      page.off('request', onRequest);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
      page.off('close', onClose);
      if (trackerByPage.get(page) === tracker) trackerByPage.delete(page);
      waiters.clear();
    }
  };

  trackerByPage.set(page, tracker);
  return tracker;
}

function safetyMetricsSnapshot() {
  return { ...safetyMetrics };
}

function resetSafetyMetrics() {
  safetyMetrics.testsFinishingWithOutstandingHeavyReads = 0;
  safetyMetrics.exceptionalHeavyDrainCount = 0;
  safetyMetrics.exceptionalHeavyDrainWaitMs = 0;
}

let exitSummaryInstalled = false;
function installSafetySummaryExitLog() {
  if (exitSummaryInstalled) return;
  exitSummaryInstalled = true;
  process.on('exit', () => {
    const metrics = safetyMetricsSnapshot();
    console.log(`UAT_HEAVY_READ_SAFETY_SUMMARY tests_finishing_with_outstanding=${metrics.testsFinishingWithOutstandingHeavyReads} exceptional_drain_count=${metrics.exceptionalHeavyDrainCount} exceptional_drain_wait_ms=${metrics.exceptionalHeavyDrainWaitMs}`);
  });
}

module.exports = {
  DEFAULT_REQUEST_TIMEOUT_MS,
  DEFAULT_RUNTIME_CEILING_MS,
  DEFAULT_SAFETY_MARGIN_MS,
  HEAVY_PATHS,
  createHeavyReadSafetyTracker,
  installSafetySummaryExitLog,
  isHeavyGetRequest,
  markHarnessPreventedHeavyRead,
  pathOf,
  performAndWaitForHeavyRequest,
  resetSafetyMetrics,
  safetyMetricsSnapshot
};
