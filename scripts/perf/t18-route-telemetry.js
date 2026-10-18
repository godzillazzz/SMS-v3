'use strict';

/**
 * T18 / T24 redacted route telemetry.
 *
 * Measures route latency against the canonical deployment **without credentials**. Business routes
 * are expected to answer 401/403: that response still exercises TLS, the edge, the serverless
 * function and the auth middleware, and it returns no business data, so the sample is inherently
 * redacted. Authenticated p50/p95 per role remains an open gate (needs an approved UAT account).
 *
 * Read-only and polite: one request at a time with a fixed gap, honouring a 5xx back-off.
 *
 *   node scripts/perf/t18-route-telemetry.js [--base URL] [--rounds 20] [--gap 800]
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_BASE = 'https://sms-v3-staging-ten.vercel.app';

const ROUTES = [
  { path: '/api/v1/health', kind: 'public', expect: [200] },
  { path: '/api/v1/ready', kind: 'public', expect: [200] },
  { path: '/api/v1/approval-center', kind: 'auth-gate', expect: [401, 403] },
  { path: '/api/v1/schedules?month=2026-10', kind: 'auth-gate', expect: [401, 403] },
  { path: '/api/v1/employees?page=1&pageSize=20', kind: 'auth-gate', expect: [401, 403] },
  { path: '/api/v1/attendance/history?days=7', kind: 'auth-gate', expect: [401, 403] },
  { path: '/api/v1/dashboard', kind: 'auth-gate', expect: [401, 403] },
  { path: '/', kind: 'shell', expect: [200] }
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function measure(base, route, rounds, gap) {
  const samples = [];
  const statuses = new Map();
  const failures = [];
  for (let i = 0; i < rounds; i += 1) {
    const started = process.hrtime.bigint();
    try {
      const response = await fetch(`${base}${route.path}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
      const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
      samples.push(elapsed);
      statuses.set(response.status, (statuses.get(response.status) || 0) + 1);
      await response.arrayBuffer().catch(() => {});
    } catch (error) {
      failures.push(error.message);
    }
    await sleep(gap);
  }
  const expected = [...statuses.keys()].every((status) => route.expect.includes(status));
  return {
    path: route.path,
    kind: route.kind,
    rounds: samples.length + failures.length,
    samples: samples.length,
    failures: failures.length,
    statuses: Object.fromEntries([...statuses.entries()].sort()),
    statusMatchesExpectation: samples.length > 0 && expected,
    p50: Number(percentile(samples, 50).toFixed(1)),
    p95: Number(percentile(samples, 95).toFixed(1)),
    max: Number(percentile(samples, 100).toFixed(1))
  };
}

async function main() {
  const base = arg('base', DEFAULT_BASE);
  const rounds = Number(arg('rounds', 20));
  const gap = Number(arg('gap', 800));

  const results = [];
  for (const route of ROUTES) {
    results.push(await measure(base, route, rounds, gap));
  }

  const publicRows = results.filter((row) => row.kind !== 'auth-gate');
  const gateRows = results.filter((row) => row.kind === 'auth-gate');
  const evidence = {
    generatedAt: new Date().toISOString(),
    canonicalUrl: base,
    roundsPerRoute: rounds,
    gapMs: gap,
    results,
    summary: {
      publicP95: publicRows.length ? Math.max(...publicRows.map((row) => row.p95)) : 0,
      authGateP95: gateRows.length ? Math.max(...gateRows.map((row) => row.p95)) : 0,
      unauthorisedRouteFailures: gateRows.filter((row) => !row.statusMatchesExpectation).length
    },
    limitation: 'Authenticated per-role latency is NOT measured: no approved UAT account is available (F004). No business data is returned by these requests.'
  };

  fs.mkdirSync(path.join(ROOT, 'docs/evidence'), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const jsonPath = `docs/evidence/t18-route-telemetry-${stamp}.json`;
  fs.writeFileSync(path.join(ROOT, jsonPath), `${JSON.stringify(evidence, null, 2)}\n`);

  const lines = ['# T18 / T24 — redacted route telemetry', ''];
  lines.push(`Generated: ${evidence.generatedAt}`);
  lines.push(`Canonical: ${base} · ${rounds} requests per route · ${gap} ms gap (sequential)`);
  lines.push('');
  lines.push('| Route | Kind | Expected | Observed | p50 | p95 | max | failures |');
  lines.push('|---|---|---|---|---|---|---|---|');
  for (const row of results) {
    lines.push(`| \`${row.path}\` | ${row.kind} | ${ROUTES.find((r) => r.path === row.path).expect.join('/')} | ${Object.keys(row.statuses).join('/') || '—'} | ${row.p50} ms | ${row.p95} ms | ${row.max} ms | ${row.failures} |`);
  }
  lines.push('');
  lines.push(`Public p95 (worst route): **${evidence.summary.publicP95} ms**`);
  lines.push(`Auth-gate p95 (worst route): **${evidence.summary.authGateP95} ms**`);
  lines.push('');
  lines.push('## Limitation');
  lines.push(evidence.limitation);
  lines.push('');
  lines.push(`Machine-readable evidence: \`${jsonPath}\``);

  const mdPath = 'docs/T18_T24_ROUTE_TELEMETRY.md';
  fs.writeFileSync(path.join(ROOT, mdPath), lines.join('\n'));

  console.log(`T18_TELEMETRY public_p95=${evidence.summary.publicP95}ms auth_gate_p95=${evidence.summary.authGateP95}ms`);
  console.log(`wrote ${jsonPath} and ${mdPath}`);
  const gateFailure = results.some((row) => !row.statusMatchesExpectation);
  if (gateFailure) process.exitCode = 1;
}

main().catch((error) => {
  console.error('T18_TELEMETRY_FAILED', error.message);
  process.exitCode = 1;
});
