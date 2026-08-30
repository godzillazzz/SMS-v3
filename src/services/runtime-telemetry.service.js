const MAX_HTTP_SAMPLES = 500;

const state = {
  startedAt: new Date(),
  droppedSamples: 0,
  httpSamples: []
};

function normalizeDuration(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 100) / 100;
}

function normalizeStatus(value) {
  const status = Number(value);
  return Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
}

function normalizeMethod(value) {
  const method = String(value || '').trim().toUpperCase();
  return /^[A-Z]{3,10}$/.test(method) ? method : 'UNKNOWN';
}

function normalizeRoute(value) {
  const route = String(value || '').trim();
  if (!route || route.length > 160 || route.includes('?')) return 'unmatched';
  return route;
}

function normalizeTimestamp(value) {
  const timestamp = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(timestamp.getTime()) ? new Date() : timestamp;
}

function recordHttpRequest(sample) {
  const durationMs = normalizeDuration(sample?.durationMs);
  const status = normalizeStatus(sample?.status);
  if (durationMs == null || status == null) return false;

  state.httpSamples.push({
    route: normalizeRoute(sample?.route),
    method: normalizeMethod(sample?.method),
    status,
    durationMs,
    timestamp: normalizeTimestamp(sample?.timestamp)
  });

  if (state.httpSamples.length > MAX_HTTP_SAMPLES) {
    const overflow = state.httpSamples.length - MAX_HTTP_SAMPLES;
    state.httpSamples.splice(0, overflow);
    state.droppedSamples += overflow;
  }
  return true;
}

function percentile(sorted, percentileValue) {
  if (!sorted.length) return null;
  const rank = Math.max(1, Math.ceil(percentileValue * sorted.length));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function round(value) {
  return value == null ? null : Math.round(value * 100) / 100;
}

function summarizeHttpSamples(samples = state.httpSamples) {
  const durations = samples.map((sample) => sample.durationMs).sort((a, b) => a - b);
  const serverErrorCount = samples.filter((sample) => sample.status >= 500).length;
  const clientErrorCount = samples.filter((sample) => sample.status >= 400 && sample.status < 500).length;

  const byRoute = new Map();
  for (const sample of samples) {
    const key = `${sample.method} ${sample.route}`;
    const current = byRoute.get(key) || {
      method: sample.method,
      route: sample.route,
      durations: [],
      requestCount: 0,
      serverErrorCount: 0
    };
    current.durations.push(sample.durationMs);
    current.requestCount += 1;
    if (sample.status >= 500) current.serverErrorCount += 1;
    byRoute.set(key, current);
  }

  const slowRoutes = [...byRoute.values()].map((entry) => {
    const routeDurations = [...entry.durations].sort((a, b) => a - b);
    return {
      method: entry.method,
      route: entry.route,
      requestCount: entry.requestCount,
      p50Ms: round(percentile(routeDurations, 0.5)),
      p95Ms: round(percentile(routeDurations, 0.95)),
      maxMs: round(routeDurations[routeDurations.length - 1]),
      serverErrorCount: entry.serverErrorCount
    };
  }).sort((a, b) =>
    (b.p95Ms ?? -1) - (a.p95Ms ?? -1)
    || (b.maxMs ?? -1) - (a.maxMs ?? -1)
    || b.requestCount - a.requestCount
  ).slice(0, 10);

  return {
    requestCount: samples.length,
    serverErrorCount,
    clientErrorCount,
    serverErrorRatePct: samples.length ? round((serverErrorCount / samples.length) * 100) : 0,
    p50Ms: round(percentile(durations, 0.5)),
    p95Ms: round(percentile(durations, 0.95)),
    maxMs: durations.length ? round(durations[durations.length - 1]) : null,
    slowRoutes
  };
}

function snapshotRuntimeTelemetry() {
  const samples = state.httpSamples.map((sample) => ({ ...sample }));
  const summary = summarizeHttpSamples(samples);
  return {
    scope: 'CURRENT_RUNTIME_INSTANCE',
    instanceStartedAt: state.startedAt.toISOString(),
    maxRetainedSamples: MAX_HTTP_SAMPLES,
    retainedSamples: samples.length,
    droppedSamples: state.droppedSamples,
    windowStartedAt: samples[0]?.timestamp?.toISOString?.() || null,
    windowEndedAt: samples[samples.length - 1]?.timestamp?.toISOString?.() || null,
    ...summary
  };
}

function resetRuntimeTelemetryForTest({ startedAt = new Date('2026-01-01T00:00:00.000Z') } = {}) {
  state.startedAt = new Date(startedAt);
  state.droppedSamples = 0;
  state.httpSamples.length = 0;
}

module.exports = {
  MAX_HTTP_SAMPLES,
  recordHttpRequest,
  snapshotRuntimeTelemetry,
  summarizeHttpSamples,
  resetRuntimeTelemetryForTest
};
