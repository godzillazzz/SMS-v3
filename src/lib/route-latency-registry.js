'use strict';

const MAX_SAMPLES_PER_ROUTE = 512;
const MAX_ROUTES = 256;

const state = new Map();

function normalizeMethod(method) {
  const value = String(method || '').trim().toUpperCase();
  return /^[A-Z]{3,10}$/.test(value) ? value : 'UNKNOWN';
}

function normalizePath(path) {
  const raw = String(path || '').split('?')[0].trim();
  if (!raw || !raw.startsWith('/')) return '/';
  const normalized = raw.split('/').map((segment) => {
    if (!segment) return '';
    if (/^\d+$/.test(segment) || /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment)) return ':id';
    return segment;
  }).join('/');
  return normalized.length > 180 ? normalized.slice(0, 180) : normalized;
}

function normalizeRoute(method, path) {
  return `${normalizeMethod(method)} ${normalizePath(path)}`;
}

function statusClass(status) {
  const value = Number(status);
  if (value >= 200 && value < 300) return '2xx';
  if (value >= 400 && value < 500) return '4xx';
  if (value >= 500 && value < 600) return '5xx';
  return `${Math.floor(value / 100)}xx`;
}

function record({ method, route, status, durationMs, timestamp = Date.now() } = {}) {
  const duration = Number(durationMs);
  const numericStatus = Number(status);
  if (!Number.isFinite(duration) || duration < 0 || !Number.isInteger(numericStatus) || numericStatus < 100 || numericStatus > 599) return false;
  const key = normalizeRoute(method, route);
  if (!state.has(key) && state.size >= MAX_ROUTES) return false;
  const samples = state.get(key) || [];
  samples.push({ timestamp: Number(timestamp), statusClass: statusClass(numericStatus), durationMs: Math.round(duration * 100) / 100 });
  if (samples.length > MAX_SAMPLES_PER_ROUTE) samples.splice(0, samples.length - MAX_SAMPLES_PER_ROUTE);
  state.set(key, samples);
  return true;
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(sorted.length * fraction));
  return sorted[Math.min(sorted.length - 1, rank - 1)];
}

function summarize({ minutes = 15, limit = 50, now = Date.now() } = {}) {
  const cutoff = Number(now) - Number(minutes) * 60 * 1000;
  const routes = [];
  for (const [route, samples] of state) {
    const windowSamples = samples.filter((sample) => sample.timestamp >= cutoff && sample.timestamp <= Number(now));
    if (!windowSamples.length) continue;
    const durations = windowSamples.map((sample) => sample.durationMs);
    const errors = windowSamples.filter((sample) => sample.statusClass === '5xx').length;
    routes.push({
      route,
      count: windowSamples.length,
      errorRate: Math.round((errors / windowSamples.length) * 10000) / 10000,
      p50: percentile(durations, 0.5),
      p95: percentile(durations, 0.95),
      max: Math.max(...durations)
    });
  }
  routes.sort((a, b) => b.p95 - a.p95 || b.max - a.max || a.route.localeCompare(b.route));
  return {
    window: { minutes: Number(minutes), from: new Date(cutoff).toISOString(), to: new Date(Number(now)).toISOString() },
    routes: routes.slice(0, Number(limit))
  };
}

function resetForTest() { state.clear(); }

module.exports = {
  MAX_SAMPLES_PER_ROUTE,
  MAX_ROUTES,
  normalizePath,
  normalizeRoute,
  statusClass,
  record,
  summarize,
  percentile,
  resetForTest
};
