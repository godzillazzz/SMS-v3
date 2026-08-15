'use strict';

const { performance } = require('node:perf_hooks');
const { request } = require('@playwright/test');
const { automationBypassHeaders } = require('./technical-smoke');
const { getUatConfig } = require('./uat-config');
const { pathnameOnly } = require('./uat-network');

const CANONICAL_BASE_URL = 'https://sms-v3-staging-ten.vercel.app';
const CANDIDATE_BASE_URL = 'https://sms-v3-staging-9ktrw39ud-godzillazz.vercel.app';
const MAX_SAMPLES = 3;
const TARGET_LABELS = new Set(['canonical', 'candidate']);
const ROLES = new Set(['ADMIN', 'MANAGER']);
const BENCHMARK_ENDPOINTS = new Set([
  '/api/v1/dashboard',
  '/api/v1/executive-report',
  '/api/v1/reports/summary'
]);
const NETWORK_ENDPOINTS = new Set([
  ...BENCHMARK_ENDPOINTS,
  '/api/v1/licenses',
  '/api/v1/licenses/{licenseId}/documents',
  'license-response-fields',
  'report-center-export',
  'report-center-pdf'
]);

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return undefined;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarizeSamples(samples) {
  const durations = samples.map((sample) => Number(sample.durationMs)).filter(Number.isFinite);
  if (!durations.length) return { count: 0 };
  return {
    count: durations.length,
    minMs: round2(Math.min(...durations)),
    medianMs: round2(median(durations)),
    maxMs: round2(Math.max(...durations))
  };
}

function medianDeltaPercent(canonicalMedian, candidateMedian) {
  if (!Number.isFinite(canonicalMedian) || canonicalMedian <= 0 || !Number.isFinite(candidateMedian)) return undefined;
  return round2(((candidateMedian - canonicalMedian) / canonicalMedian) * 100);
}

function alternatingSequence(sampleCount = MAX_SAMPLES) {
  const count = Number(sampleCount);
  if (!Number.isInteger(count) || count < 1 || count > MAX_SAMPLES) throw new Error('UAT_BENCHMARK_SAMPLE_BUDGET_INVALID');
  const sequence = [];
  for (let sampleIndex = 1; sampleIndex <= count; sampleIndex += 1) {
    sequence.push({ targetLabel: 'canonical', sampleIndex });
    sequence.push({ targetLabel: 'candidate', sampleIndex });
  }
  return sequence;
}

function normalizeApprovedBaseUrl(value) {
  const parsed = new URL(value);
  parsed.hash = '';
  parsed.search = '';
  return parsed.toString().replace(/\/$/, '');
}

function assertApprovedBenchmarkTargets(candidateBaseURL) {
  const candidate = normalizeApprovedBaseUrl(candidateBaseURL);
  if (candidate !== CANDIDATE_BASE_URL) throw new Error('UAT_BENCHMARK_TARGET_REJECTED');
  if (normalizeApprovedBaseUrl(CANONICAL_BASE_URL) !== CANONICAL_BASE_URL) throw new Error('UAT_BENCHMARK_CANONICAL_INVALID');
  return { canonical: CANONICAL_BASE_URL, candidate: CANDIDATE_BASE_URL };
}

function shouldRunPerformanceValidation(environment = process.env) {
  return String(environment.UAT_MODE || 'technical').trim().toLowerCase() === 'authenticated';
}

function safeRequestId(value) {
  const text = String(value || '').trim();
  return /^[A-Za-z0-9:_-]{1,160}$/.test(text) ? text : '';
}

function safeFilterCategory(value) {
  const text = String(value || '').trim().toLowerCase();
  return /^[a-z0-9-]{1,80}$/.test(text) ? text : 'default-current-period';
}

function safeEndpoint(value, { network = false } = {}) {
  const raw = String(value || '');
  if (network && NETWORK_ENDPOINTS.has(raw)) return raw;
  const path = pathnameOnly(raw);
  if (BENCHMARK_ENDPOINTS.has(path)) return path;
  if (network && NETWORK_ENDPOINTS.has(path)) return path;
  throw new Error('UAT_PERFORMANCE_ENDPOINT_REJECTED');
}

function sanitizeBenchmarkSample(input) {
  const safe = {};
  if (!TARGET_LABELS.has(input?.targetLabel)) throw new Error('UAT_PERFORMANCE_TARGET_LABEL_INVALID');
  safe.targetLabel = input.targetLabel;
  if (!ROLES.has(input?.role)) throw new Error('UAT_PERFORMANCE_ROLE_INVALID');
  safe.role = input.role;
  safe.endpoint = safeEndpoint(input.endpoint);
  safe.filterCategory = safeFilterCategory(input.filterCategory);
  if (!Number.isInteger(input.sampleIndex) || input.sampleIndex < 1 || input.sampleIndex > MAX_SAMPLES) throw new Error('UAT_PERFORMANCE_SAMPLE_INDEX_INVALID');
  safe.sampleIndex = input.sampleIndex;
  if (!Number.isInteger(input.status) || input.status < 100 || input.status > 599) throw new Error('UAT_PERFORMANCE_STATUS_INVALID');
  safe.status = input.status;
  if (!Number.isFinite(input.durationMs) || input.durationMs < 0) throw new Error('UAT_PERFORMANCE_DURATION_INVALID');
  safe.durationMs = round2(input.durationMs);
  const requestId = safeRequestId(input.requestId);
  if (requestId) safe.requestId = requestId;
  return safe;
}

function sanitizeNetworkMetric(input) {
  if (!TARGET_LABELS.has(input?.targetLabel)) throw new Error('UAT_NETWORK_TARGET_LABEL_INVALID');
  if (!ROLES.has(input?.role)) throw new Error('UAT_NETWORK_ROLE_INVALID');
  const safe = {
    targetLabel: input.targetLabel,
    role: input.role,
    endpoint: safeEndpoint(input.endpoint, { network: true }),
    filterCategory: safeFilterCategory(input.filterCategory)
  };
  if (Number.isInteger(input.status) && input.status >= 100 && input.status <= 599) safe.status = input.status;
  if (Number.isInteger(input.count) && input.count >= 0 && input.count <= 1000) safe.count = input.count;
  if (typeof input.classification === 'string' && /^[A-Z0-9_-]{1,80}$/.test(input.classification)) safe.classification = input.classification;
  return safe;
}

function groupClassification({ complete, candidateFiveXx, delta }) {
  if (candidateFiveXx > 0) return 'PERFORMANCE_REGRESSED';
  if (!complete || !Number.isFinite(delta)) return 'INSUFFICIENT_EVIDENCE';
  if (delta <= -10) return 'PERFORMANCE_IMPROVED';
  if (delta >= 20) return 'PERFORMANCE_REGRESSED';
  return 'PERFORMANCE_NEUTRAL';
}

async function runMatchedBenchmarkGroup({
  role,
  endpoint,
  filterCategory = 'default-current-period',
  sampleCount = MAX_SAMPLES,
  measure
}) {
  if (!ROLES.has(role)) throw new Error('UAT_PERFORMANCE_ROLE_INVALID');
  const safePath = safeEndpoint(endpoint);
  if (typeof measure !== 'function') throw new Error('UAT_BENCHMARK_MEASURE_REQUIRED');
  const samples = [];
  for (const step of alternatingSequence(sampleCount)) {
    const measured = await measure({
      targetLabel: step.targetLabel,
      role,
      endpoint: safePath,
      filterCategory,
      sampleIndex: step.sampleIndex
    });
    const sample = sanitizeBenchmarkSample(measured);
    samples.push(sample);
    if (sample.status >= 500) break;
  }

  const canonicalSamples = samples.filter((sample) => sample.targetLabel === 'canonical');
  const candidateSamples = samples.filter((sample) => sample.targetLabel === 'candidate');
  const stats = [
    { targetLabel: 'canonical', role, endpoint: safePath, filterCategory: safeFilterCategory(filterCategory), ...summarizeSamples(canonicalSamples) },
    { targetLabel: 'candidate', role, endpoint: safePath, filterCategory: safeFilterCategory(filterCategory), ...summarizeSamples(candidateSamples) }
  ];
  const canonicalMedian = stats[0].medianMs;
  const candidateMedian = stats[1].medianMs;
  const delta = medianDeltaPercent(canonicalMedian, candidateMedian);
  const candidateFiveXx = candidateSamples.filter((sample) => sample.status >= 500).length;
  const complete = canonicalSamples.length === sampleCount && candidateSamples.length === sampleCount;
  return {
    role,
    endpoint: safePath,
    filterCategory: safeFilterCategory(filterCategory),
    stats,
    samples,
    ...(Number.isFinite(delta) ? { medianDeltaPercent: delta } : {}),
    classification: groupClassification({ complete, candidateFiveXx, delta })
  };
}

function classifyOverall(groups) {
  const complete = groups.filter((group) => group.stats?.every((stat) => stat.count === MAX_SAMPLES));
  const anyCandidateFiveXx = groups.some((group) => group.samples?.some((sample) => sample.targetLabel === 'candidate' && sample.status >= 500));
  if (anyCandidateFiveXx) return 'PERFORMANCE_REGRESSED';
  if (complete.length < 3) return 'INSUFFICIENT_EVIDENCE';
  const deltas = complete.map((group) => group.medianDeltaPercent).filter(Number.isFinite);
  if (deltas.length < 3) return 'INSUFFICIENT_EVIDENCE';
  if (deltas.every((delta) => delta <= -10)) return 'PERFORMANCE_IMPROVED';
  if (deltas.filter((delta) => delta >= 20).length >= 2 && !deltas.some((delta) => delta <= -10)) return 'PERFORMANCE_REGRESSED';
  if (deltas.every((delta) => Math.abs(delta) < 15)) return 'PERFORMANCE_NEUTRAL';
  return 'INSUFFICIENT_EVIDENCE';
}

async function createBenchmarkSession({ baseURL, role, environment = process.env }) {
  const config = getUatConfig(environment);
  const account = config.accounts[role];
  if (!ROLES.has(role) || !account?.configured) throw new Error('UAT_BENCHMARK_CREDENTIALS_REQUIRED');
  const loginUrl = `${baseURL}/api/v1/auth/login`;
  const context = await request.newContext({
    baseURL,
    extraHTTPHeaders: {
      Accept: 'application/json',
      ...automationBypassHeaders(environment, config.baseURL, loginUrl, { setBypassCookie: true })
    }
  });
  try {
    const response = await context.post('/api/v1/auth/login', {
      data: { email: account.email, password: account.password, clientType: 'browser' },
      timeout: 30_000
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status() < 200 || response.status() >= 300 || payload?.user?.role !== role || typeof payload?.accessToken !== 'string' || !payload.accessToken) {
      throw new Error('UAT_BENCHMARK_LOGIN_FAILED');
    }
    return { baseURL, role, accessToken: payload.accessToken, context };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}

async function measureBenchmarkGet({ session, targetLabel, role, endpoint, filterCategory, sampleIndex }) {
  const start = performance.now();
  const response = await session.context.get(endpoint, {
    headers: { Authorization: `Bearer ${session.accessToken}` },
    timeout: 60_000
  });
  const durationMs = performance.now() - start;
  const requestId = safeRequestId(response.headers()['x-request-id']);
  return sanitizeBenchmarkSample({
    targetLabel,
    role,
    endpoint,
    filterCategory,
    sampleIndex,
    status: response.status(),
    durationMs,
    requestId
  });
}

function sanitizeBenchmarkGroup(group) {
  const role = ROLES.has(group?.role) ? group.role : undefined;
  if (!role) throw new Error('UAT_PERFORMANCE_ROLE_INVALID');
  const endpoint = safeEndpoint(group.endpoint);
  const filterCategory = safeFilterCategory(group.filterCategory);
  const samples = Array.isArray(group.samples) ? group.samples.map(sanitizeBenchmarkSample) : [];
  const stats = ['canonical', 'candidate'].map((targetLabel) => {
    const targetSamples = samples.filter((sample) => sample.targetLabel === targetLabel);
    return { targetLabel, role, endpoint, filterCategory, ...summarizeSamples(targetSamples) };
  });
  const delta = medianDeltaPercent(stats[0].medianMs, stats[1].medianMs);
  const classification = typeof group.classification === 'string' && /^(?:PERFORMANCE_IMPROVED|PERFORMANCE_NEUTRAL|PERFORMANCE_REGRESSED|INSUFFICIENT_EVIDENCE)$/.test(group.classification)
    ? group.classification
    : groupClassification({ complete: stats.every((stat) => stat.count === MAX_SAMPLES), candidateFiveXx: samples.filter((sample) => sample.targetLabel === 'candidate' && sample.status >= 500).length, delta });
  return {
    role,
    endpoint,
    filterCategory,
    stats,
    samples,
    ...(Number.isFinite(delta) ? { medianDeltaPercent: delta } : {}),
    classification
  };
}

function sanitizePerformanceValidation(value = {}) {
  const safe = {};
  if (value.networkContracts && typeof value.networkContracts === 'object') {
    safe.networkContracts = {};
    for (const key of ['license', 'reportCenter']) {
      if (Array.isArray(value.networkContracts[key])) safe.networkContracts[key] = value.networkContracts[key].map(sanitizeNetworkMetric);
    }
    if (!Object.keys(safe.networkContracts).length) delete safe.networkContracts;
  }
  if (value.benchmark && typeof value.benchmark === 'object') {
    const groups = Array.isArray(value.benchmark.groups) ? value.benchmark.groups.map(sanitizeBenchmarkGroup) : [];
    const classification = /^(?:PERFORMANCE_IMPROVED|PERFORMANCE_NEUTRAL|PERFORMANCE_REGRESSED|INSUFFICIENT_EVIDENCE)$/.test(String(value.benchmark.classification || ''))
      ? value.benchmark.classification
      : classifyOverall(groups);
    safe.benchmark = { groups, classification, smallSample: true };
  }
  return safe;
}

function mergePerformanceValidation(current = {}, next = {}) {
  const left = sanitizePerformanceValidation(current);
  const right = sanitizePerformanceValidation(next);
  const merged = { networkContracts: {} };
  for (const key of ['license', 'reportCenter']) {
    const entries = [...(left.networkContracts?.[key] || []), ...(right.networkContracts?.[key] || [])];
    if (entries.length) merged.networkContracts[key] = entries;
  }
  if (!Object.keys(merged.networkContracts).length) delete merged.networkContracts;
  if (right.benchmark) merged.benchmark = right.benchmark;
  else if (left.benchmark) merged.benchmark = left.benchmark;
  return merged;
}

module.exports = {
  BENCHMARK_ENDPOINTS,
  CANONICAL_BASE_URL,
  CANDIDATE_BASE_URL,
  MAX_SAMPLES,
  alternatingSequence,
  assertApprovedBenchmarkTargets,
  classifyOverall,
  createBenchmarkSession,
  measureBenchmarkGet,
  median,
  medianDeltaPercent,
  mergePerformanceValidation,
  runMatchedBenchmarkGroup,
  safeRequestId,
  sanitizeBenchmarkSample,
  sanitizeNetworkMetric,
  sanitizePerformanceValidation,
  shouldRunPerformanceValidation,
  summarizeSamples
};
