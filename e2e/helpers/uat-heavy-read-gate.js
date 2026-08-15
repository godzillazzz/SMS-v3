'use strict';

const HEAVY_READ_PATHS = new Set([
  '/api/v1/dashboard',
  '/api/v1/executive-report',
  '/api/v1/reports/summary'
]);

const AUTHENTICATED_BROWSER_HEAVY_LIMIT = 2;
const HEAVY_SETTLE_TIMEOUT_MS = 65_000;

function authenticatedMode(environment = process.env) {
  return String(environment.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
}

function requestPath(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return '';
  }
}

function isHeavyReadRequest(request) {
  return request?.method?.() === 'GET' && HEAVY_READ_PATHS.has(requestPath(request.url()));
}

function createSemaphore(limit = AUTHENTICATED_BROWSER_HEAVY_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 8) throw new Error('UAT_HEAVY_READ_LIMIT_INVALID');
  let active = 0;
  let peak = 0;
  const queue = [];

  const dispatch = () => {
    while (active < limit && queue.length > 0) {
      active += 1;
      peak = Math.max(peak, active);
      const resolve = queue.shift();
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        active -= 1;
        dispatch();
      });
    }
  };

  return {
    acquire() {
      return new Promise((resolve) => {
        queue.push(resolve);
        dispatch();
      });
    },
    snapshot() {
      return { active, waiting: queue.length, peak, limit };
    }
  };
}

function waitForRequestSettlement(page, request, timeoutMs = HEAVY_SETTLE_TIMEOUT_MS) {
  let done = false;
  let timer;
  let resolvePromise;
  const promise = new Promise((resolve) => { resolvePromise = resolve; });

  const finish = () => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    page.off('response', onResponse);
    page.off('requestfailed', onRequestFailed);
    page.off('close', finish);
    resolvePromise();
  };
  const onResponse = (response) => {
    if (response.request() === request) finish();
  };
  const onRequestFailed = (failedRequest) => {
    if (failedRequest === request) finish();
  };

  page.on('response', onResponse);
  page.on('requestfailed', onRequestFailed);
  page.on('close', finish);
  timer = setTimeout(finish, timeoutMs);

  return { promise, cancel: finish };
}

function createHeavyReadController({ limit = AUTHENTICATED_BROWSER_HEAVY_LIMIT } = {}) {
  const semaphore = createSemaphore(limit);
  return {
    async run(task) {
      if (typeof task !== 'function') throw new Error('UAT_HEAVY_READ_TASK_REQUIRED');
      const release = await semaphore.acquire();
      try {
        return await task();
      } finally {
        release();
      }
    },
    snapshot: () => semaphore.snapshot()
  };
}

const authenticatedBrowserHeavyReads = createHeavyReadController();

async function continueWithAuthenticatedHeavyReadGate({ page, request, continueRequest, environment = process.env }) {
  if (typeof continueRequest !== 'function') throw new Error('UAT_HEAVY_READ_CONTINUE_REQUIRED');
  if (!authenticatedMode(environment) || !isHeavyReadRequest(request)) return continueRequest();

  return authenticatedBrowserHeavyReads.run(async () => {
    const settled = waitForRequestSettlement(page, request);
    try {
      await continueRequest();
      await settled.promise;
    } finally {
      settled.cancel();
    }
  });
}

module.exports = {
  AUTHENTICATED_BROWSER_HEAVY_LIMIT,
  HEAVY_READ_PATHS,
  HEAVY_SETTLE_TIMEOUT_MS,
  authenticatedMode,
  continueWithAuthenticatedHeavyReadGate,
  createHeavyReadController,
  createSemaphore,
  isHeavyReadRequest,
  requestPath,
  waitForRequestSettlement
};
