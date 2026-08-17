const fs = require('node:fs');
const path = require('node:path');

const stageCodes = Object.freeze([
  'NAV01_LOGIN',
  'NAV02_PRIMARY_NAV',
  'NAV03_DASHBOARD',
  'NAV04_SCHEDULE',
  'NAV05_LEAVE',
  'NAV06_LICENSE',
  'NAV07_DATA_QUALITY',
  'NAV08_AUDIT',
  'RC01_NAVIGATE',
  'RC02_SHELL',
  'RC03_EXEC_REQUEST',
  'RC04_EXEC_KPIS',
  'RC05_FILTERS',
  'RC06_DETAILS_TRIGGER',
  'RC07_DETAILS_RESPONSE',
  'RC08_DETAILS_RENDER',
  'RC09_EXPORT_TAB',
  'RC10_EXPORT_CONTROL',
  'RC11_EXEC_RETURN',
  'RC12_PRINT_CONTENT',
  'RC13_PDF_READY',
  'RC14_PDF_CLICK',
  'RC15_MONITOR',
  'GQ01_API_2026',
  'GQ02_QUOTA_UI',
  'GQ03_API_2027',
  'GQ04_YEAR_UI',
  'GQ05_LEGACY',
  'GQ06_MODAL',
  'GQ07_SUMMARY',
  'GQ08_LEAVE_UI',
  'GQ09_MONITOR'
]);

const stageCodeSet = new Set(stageCodes);

function durationBucket(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs < 1000) return '<1s';
  if (durationMs < 5000) return '1-5s';
  if (durationMs < 15000) return '5-15s';
  if (durationMs < 30000) return '15-30s';
  if (durationMs < 45000) return '30-45s';
  if (durationMs < 60000) return '45-60s';
  return '>=60s';
}

function safeApiPath(value) {
  if (!value) return undefined;
  try {
    const parsed = new URL(String(value), 'https://uat.invalid');
    if (!parsed.pathname.startsWith('/api/v1/')) return undefined;
    return parsed.pathname;
  } catch {
    return undefined;
  }
}

function safeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : undefined;
}

function safeErrorCode(error, fallback = 'UAT_STAGE_FAILED') {
  const code = String(error?.code || fallback).toUpperCase();
  return /^UAT_[A-Z0-9_]+$/.test(code) ? code.slice(0, 120) : fallback;
}

function extractStatus(value) {
  if (!value) return undefined;
  if (typeof value.status === 'function') return safeStatus(value.status());
  return safeStatus(value.status);
}

function assertStageCode(stageCode) {
  if (!stageCodeSet.has(stageCode)) {
    const error = new Error('UAT_STAGE_CODE_INVALID');
    error.code = 'UAT_STAGE_CODE_INVALID';
    throw error;
  }
}

function createStageTracker({ role, testCode, testInfo, diagnosticPath = process.env.UAT_STAGE_DIAGNOSTIC_FILE }) {
  let currentStage;
  let lastCompletedStage;
  let currentStartedAt;
  let lastEvent;

  function persistSnapshot() {
    if (!diagnosticPath) return;
    try {
      fs.mkdirSync(path.dirname(diagnosticPath), { recursive: true });
      fs.appendFileSync(diagnosticPath, `${JSON.stringify(snapshot())}\n`, 'utf8');
    } catch {
      return;
    }
  }

  function begin(stageCode) {
    assertStageCode(stageCode);
    currentStage = stageCode;
    currentStartedAt = Date.now();
    persistSnapshot();
  }

  function finish(stageCode, state, metadata = {}, error) {
    assertStageCode(stageCode);
    const durationMs = Math.max(0, Date.now() - (currentStartedAt || Date.now()));
    const event = {
      role: String(role || 'UNKNOWN').toUpperCase().slice(0, 20),
      testCode: String(testCode || 'UNKNOWN').replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 80),
      stageCode,
      state,
      ...(metadata.safeApiPath ? { safeApiPath: safeApiPath(metadata.safeApiPath) } : {}),
      ...((metadata.safeStatus !== undefined || error?.status !== undefined)
        ? { safeStatus: safeStatus(metadata.safeStatus ?? error.status) }
        : {}),
      durationBucket: durationBucket(durationMs),
      safeErrorCode: state === 'FAIL' ? safeErrorCode(error, metadata.safeErrorCode || 'UAT_STAGE_FAILED') : null
    };
    lastEvent = event;
    currentStage = state === 'FAIL' ? stageCode : undefined;
    if (state === 'PASS') lastCompletedStage = stageCode;
    currentStartedAt = undefined;
    persistSnapshot();
    return event;
  }

  async function run(stageCode, operation, metadata = {}) {
    begin(stageCode);
    try {
      const result = await operation();
      finish(stageCode, 'PASS', {
        ...metadata,
        safeStatus: metadata.safeStatus ?? extractStatus(result)
      });
      return result;
    } catch (error) {
      finish(stageCode, 'FAIL', metadata, error);
      throw error;
    }
  }

  function snapshot() {
    const event = lastEvent || {
      role: String(role || 'UNKNOWN').toUpperCase().slice(0, 20),
      testCode: String(testCode || 'UNKNOWN').replace(/[^A-Za-z0-9_:-]/g, '_').slice(0, 80),
      state: 'NOT_RUN',
      durationBucket: '<1s',
      safeErrorCode: null
    };
    const isRunning = currentStartedAt !== undefined;
    return {
      role: event.role,
      testCode: event.testCode,
      lastCompletedStage: lastCompletedStage || null,
      currentStage: currentStage || null,
      state: isRunning ? 'RUNNING' : event.state,
      ...(event.safeApiPath ? { safeApiPath: event.safeApiPath } : {}),
      ...(event.safeStatus !== undefined ? { safeStatus: event.safeStatus } : {}),
      durationBucket: isRunning ? durationBucket(Date.now() - currentStartedAt) : event.durationBucket,
      safeErrorCode: isRunning ? null : event.safeErrorCode || null
    };
  }

  return {
    begin,
    run,
    snapshot,
    async attach() {
      if (!testInfo?.attach) return;
      persistSnapshot();
      await testInfo.attach('uat-stage.json', {
        body: JSON.stringify(snapshot()),
        contentType: 'application/json'
      });
    }
  };
}

module.exports = { assertStageCode, createStageTracker, durationBucket, safeApiPath, safeErrorCode, safeStatus, stageCodes };
