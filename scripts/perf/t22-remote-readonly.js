'use strict';

/**
 * T22 remote read-only latency probe.
 *
 * Measures the real deployed staging endpoint over HTTPS from wherever this runs.
 * It never mutates data: only GET /api/v1/health, GET /api/v1/ready (database ping)
 * and GET / (application shell).
 */

const BASE = process.env.T22_REMOTE_BASE || 'https://sms-v3-staging-ten.vercel.app';
const ROUNDS = Number(process.env.T22_ROUNDS || 100);
const CONCURRENCY = Number(process.env.T22_CONCURRENCY || 1);
const PATHS = ['/api/v1/health', '/api/v1/ready', '/'];

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

async function once(path) {
  const started = process.hrtime.bigint();
  const response = await fetch(`${BASE}${path}`, { method: 'GET', redirect: 'manual' });
  const body = await response.text();
  const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
  return {
    path,
    status: response.status,
    ms: elapsed,
    bytes: body.length,
    region: response.headers.get('x-vercel-id') || '',
    cache: response.headers.get('x-vercel-cache') || '',
    body: body.slice(0, 80)
  };
}

async function runPath(path) {
  const samples = [];
  const errors = [];
  const statuses = new Map();
  const regions = new Set();

  for (let round = 0; round < Math.ceil(ROUNDS / CONCURRENCY); round += 1) {
    const batch = await Promise.all(Array.from({ length: CONCURRENCY }, () => once(path).catch((error) => ({ error }))));
    for (const sample of batch) {
      if (sample.error) { errors.push(String(sample.error.message || sample.error)); continue; }
      samples.push(sample.ms);
      statuses.set(sample.status, (statuses.get(sample.status) || 0) + 1);
      if (sample.region) regions.add(sample.region);
    }
  }

  const ok = samples.length;
  return {
    path,
    requests: ok + errors.length,
    ok,
    errors: errors.length,
    statuses: Object.fromEntries(statuses),
    regions: [...regions],
    p50: Number(percentile(samples, 50).toFixed(1)),
    p95: Number(percentile(samples, 95).toFixed(1)),
    max: Number(percentile(samples, 100).toFixed(1)),
    mean: ok ? Number((samples.reduce((a, b) => a + b, 0) / ok).toFixed(1)) : 0
  };
}

(async () => {
  console.log(`T22_REMOTE_BASE=${BASE}`);
  console.log(`rounds=${ROUNDS} concurrency=${CONCURRENCY}`);
  const results = [];
  for (const path of PATHS) {
    results.push(await runPath(path));
  }
  for (const row of results) {
    console.log(`\nPATH ${row.path}`);
    console.log(`  requests=${row.requests} ok=${row.ok} errors=${row.errors} statuses=${JSON.stringify(row.statuses)}`);
    console.log(`  p50=${row.p50}ms p95=${row.p95}ms max=${row.max}ms mean=${row.mean}ms`);
    console.log(`  x-vercel-id=${row.regions.join(' | ') || 'n/a'}`);
  }
  const ready = results.find((row) => row.path === '/api/v1/ready');
  console.log('\nSUMMARY');
  console.log(`  db_read_p50=${ready.p50}ms db_read_p95=${ready.p95}ms db_read_max=${ready.max}ms`);
  console.log(`  error_rate=${((results.reduce((sum, r) => sum + r.errors, 0) / results.reduce((sum, r) => sum + r.requests, 0)) * 100).toFixed(2)}%`);
})().catch((error) => { console.error('PROBE_FAILED', error.message); process.exit(1); });
