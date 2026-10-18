'use strict';

/**
 * T30a / T30b / T31 / T32 / T33 / T19 visual audit artifact.
 *
 * The owner-approved UI work for these tasks shipped without an automated acceptance artifact. This
 * script produces one from the live deployment: it records the delivered source (PR merge commit and
 * files), then proves the shipped bundle actually contains every approved sentinel string, with a
 * sha256 per asset so the evidence can be re-checked later.
 *
 * Read-only: it only performs GET requests against the canonical URL.
 *
 *   node scripts/ci/visual-audit-artifacts.js [--base https://...] [--out docs/evidence]
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const { DEFAULT_SENTINELS } = require('./verify-release-artifact');
const manifest = require('../../frontend/src/release-runtime-sentinels.json');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_BASE = 'https://sms-v3-staging-ten.vercel.app';
const ROSTER_SYMBOLS = ['🪄', '✨', '🔒', '⚡'];

// Delivered work per task: the PR that introduced it, with a human-readable scope note.
const TASKS = [
  { id: 'T30a', pr: 556, scope: 'layout/shell', commit: 'e8cb6cbc' },
  { id: 'T30b', pr: '593–596', scope: 'personnel / roster / attendance / system surfaces', commit: '6d651315' },
  { id: 'T31', pr: 597, scope: 'timesheet print pipeline', commit: '451e667b' },
  { id: 'T32', pr: 591, scope: 'branded surfaces', commit: 'beabb62f' },
  { id: 'T33', pr: 592, scope: 'horizontal layout', commit: 'dfac6123' },
  { id: 'T19', pr: 602, scope: 'dashboard metric deep links', commit: '3622eb36' }
];

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function assetPaths(html) {
  const matches = [...String(html).matchAll(/(?:src|href)="(\/assets\/[^"]+\.(?:js|css))"/g)];
  return [...new Set(matches.map((match) => match[1]))];
}

async function fetchText(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
  const body = await response.text();
  return { status: response.status, body, headers: response.headers };
}

async function main() {
  const base = arg('base', DEFAULT_BASE);
  const outDir = arg('out', 'docs/evidence');
  const head = git(['rev-parse', 'HEAD']);

  const root = await fetchText(`${base}/`);
  if (root.status !== 200) throw new Error(`canonical root returned ${root.status}`);

  // Vite lazy chunks are not all referenced from index.html: walk the import graph.
  const seen = new Set();
  const queue = assetPaths(root.body);
  const corpus = [];
  while (queue.length && corpus.length < 200) {
    const asset = queue.shift();
    if (seen.has(asset)) continue;
    seen.add(asset);
    const { status, body } = await fetchText(`${base}${asset}`);
    if (status !== 200) throw new Error(`asset ${asset} returned ${status}`);
    corpus.push({ asset, bytes: Buffer.byteLength(body), sha256: sha256(body), text: body });
    if (asset.endsWith('.js')) {
      for (const match of String(body).matchAll(/["'`](?:\.\/)?([A-Za-z0-9_.-]+\.js)["'`]/g)) {
        const candidate = `/assets/${match[1]}`;
        if (!seen.has(candidate)) queue.push(candidate);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const joined = corpus.map((item) => item.text).join('\n');

  const sentinels = [...new Set([
    ...DEFAULT_SENTINELS,
    ...(manifest.runtime || []),
    ...(manifest.attendanceTimePolicy || [])
  ])];

  const sentinelResults = sentinels.map((value) => {
    const host = corpus.find((item) => item.text.includes(value));
    return {
      sentinel: value,
      shipped: Boolean(host),
      asset: host ? host.asset : null,
      assetSha256: host ? host.sha256 : null
    };
  });

  const symbolResults = ROSTER_SYMBOLS.map((symbol) => {
    const hosts = corpus.filter((item) => item.text.includes(symbol));
    return {
      symbol,
      shipped: hosts.length > 0,
      assets: hosts.map((item) => item.asset)
    };
  });

  const taskResults = TASKS.map((task) => {
    let commit = null;
    let files = [];
    let ancestor = null;
    if (task.commit) {
      try {
        commit = git(['rev-parse', task.commit]);
        // A merge commit shows no files without a diff against its first parent.
        files = git(['diff', '--name-only', `${commit}^1`, commit]).split('\n').filter(Boolean);
        try {
          execFileSync('git', ['merge-base', '--is-ancestor', commit, head], { cwd: ROOT, stdio: 'ignore' });
          ancestor = true;
        } catch {
          ancestor = false;
        }
      } catch {
        commit = null;
      }
    }
    return { ...task, commit, fileCount: files.length, inCurrentSource: ancestor, sampleFiles: files.slice(0, 6) };
  });

  const missingSentinels = sentinelResults.filter((item) => !item.shipped);
  const missingSymbols = symbolResults.filter((item) => !item.shipped);
  const evidence = {
    generatedAt: new Date().toISOString(),
    canonicalUrl: base,
    sourceHead: head,
    assetCount: corpus.length,
    assetBytes: corpus.reduce((sum, item) => sum + item.bytes, 0),
    assets: corpus.map(({ asset, bytes, sha256: digest }) => ({ asset, bytes, sha256: digest })),
    sentinels: sentinelResults,
    rosterSymbols: symbolResults,
    tasks: taskResults,
    result: missingSentinels.length || missingSymbols.length ? 'FAIL' : 'PASS'
  };

  fs.mkdirSync(path.join(ROOT, outDir), { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const jsonPath = path.join(outDir, `visual-audit-${stamp}.json`);
  fs.writeFileSync(path.join(ROOT, jsonPath), `${JSON.stringify(evidence, null, 2)}\n`);

  const lines = [];
  lines.push('# T30a / T30b / T31 / T32 / T33 / T19 — visual audit artifact');
  lines.push('');
  lines.push(`Generated: ${evidence.generatedAt}`);
  lines.push(`Canonical: ${base}`);
  lines.push(`Source head: \`${head}\``);
  lines.push(`Assets inspected: ${evidence.assetCount} (${(evidence.assetBytes / 1024).toFixed(0)} KiB)`);
  lines.push(`Result: **${evidence.result}**`);
  lines.push('');
  lines.push('## Delivered work per task');
  lines.push('| Task | PR | Scope | Merge commit | Files | In current source |');
  lines.push('|---|---|---|---|---|---|');
  for (const task of taskResults) {
    lines.push(`| ${task.id} | #${task.pr} | ${task.scope} | ${task.commit ? `\`${task.commit.slice(0, 8)}\`` : 'n/v'} | ${task.fileCount} | ${task.inCurrentSource === null ? 'n/v' : task.inCurrentSource ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push('## Shipped sentinels');
  lines.push('| Sentinel | Shipped | Asset | Asset sha256 |');
  lines.push('|---|---|---|---|');
  for (const item of sentinelResults) {
    lines.push(`| ${item.sentinel} | ${item.shipped ? 'yes' : '**NO**'} | ${item.asset || '—'} | ${item.assetSha256 ? item.assetSha256.slice(0, 16) : '—'} |`);
  }
  lines.push('');
  lines.push('## Monthly roster symbols');
  lines.push('| Symbol | Shipped | Assets |');
  lines.push('|---|---|---|');
  for (const item of symbolResults) {
    lines.push(`| ${item.symbol} | ${item.shipped ? 'yes' : '**NO**'} | ${item.assets.join(', ') || '—'} |`);
  }
  lines.push('');
  lines.push(`Machine-readable evidence: \`${jsonPath}\``);
  lines.push('');

  const mdPath = 'docs/T30_T33_VISUAL_AUDIT.md';
  fs.writeFileSync(path.join(ROOT, mdPath), lines.join('\n'));

  console.log(`VISUAL_AUDIT_RESULT=${evidence.result}`);
  console.log(`assets=${evidence.assetCount} sentinels=${sentinelResults.length} symbols=${symbolResults.length}`);
  console.log(`wrote ${jsonPath} and ${mdPath}`);
  if (evidence.result !== 'PASS') process.exitCode = 1;
}

main().catch((error) => {
  console.error('VISUAL_AUDIT_FAILED', error.message);
  process.exitCode = 1;
});
