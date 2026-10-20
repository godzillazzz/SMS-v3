'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const MAX_JSON_BYTES = 256 * 1024;
const MAX_JSON_DEPTH = 24;
const MAX_PAGES = 100;
const SHA = /^[0-9a-f]{40}$/;
const DEPLOYMENT = /^dpl_[A-Za-z0-9]+$/;
const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;
const SELFIE_MANIFEST = '.github/releases/approved-attendance-selfie-policy-migration.json';
const CANONICAL_HOST = 'sms-v3-staging-ten.vercel.app';

function fail(message) { throw new Error(`trusted Production baseline: ${message}`); }
function assert(ok, message) { if (!ok) fail(message); }
function own(o, k) { return o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k); }
function sha(v) { return typeof v === 'string' && SHA.test(v); }
function deploymentId(v) { return typeof v === 'string' && DEPLOYMENT.test(v); }
function object(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

// JSON.parse is deliberately not used for untrusted release evidence: this parser
// rejects duplicate object members and bounds both input size and nesting.
function parseBoundedJson(input, label = 'JSON') {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  assert(Buffer.byteLength(text, 'utf8') <= MAX_JSON_BYTES, `${label} exceeds size limit`);
  let depth = 0;
  const duplicate = /(?:^|[,{}])\s*"((?:\\.|[^"\\])*)"\s*:/g;
  // Detect duplicate keys per object with a small token scanner.
  let i = 0;
  function ws() { while (/\s/.test(text[i] || '')) i += 1; }
  function str() { assert(text[i] === '"', `${label} malformed string`); i += 1; let out = ''; while (i < text.length) { const c = text[i++]; if (c === '"') return out; if (c === '\\') { assert(i < text.length, `${label} malformed escape`); out += c + text[i++]; } else { assert(c >= ' ' && c !== '\u2028' && c !== '\u2029', `${label} control character`); out += c; } } fail(`${label} unterminated string`); }
  function value() {
    ws(); assert(++depth <= MAX_JSON_DEPTH, `${label} nesting exceeds limit`);
    const c = text[i];
    if (c === '{') { i++; const keys = new Set(); ws(); if (text[i] === '}') { i++; depth--; return; } while (true) { ws(); const k = str(); assert(!keys.has(k), `${label} duplicate key: ${k}`); keys.add(k); ws(); assert(text[i++] === ':', `${label} expected colon`); value(); ws(); if (text[i] === '}') { i++; break; } assert(text[i++] === ',', `${label} expected comma`); } }
    else if (c === '[') { i++; ws(); if (text[i] !== ']') { while (true) { value(); ws(); if (text[i] === ']') { i++; break; } assert(text[i++] === ',', `${label} expected comma`); } } else i++; }
    else if (c === '"') str();
    else { const m = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/); assert(m, `${label} invalid value`); i += m[0].length; }
    depth--;
  }
  value(); ws(); assert(i === text.length, `${label} trailing data`);
  try { return JSON.parse(text); } catch { fail(`${label} malformed`); }
}

function normalizeCanonicalUrl(raw, expected = CANONICAL_HOST) {
  assert(typeof raw === 'string' && raw.trim() === raw, 'canonical URL missing or padded');
  let u; try { u = new URL(raw); } catch { fail('canonical URL malformed'); }
  assert(u.protocol === 'https:', 'canonical URL must use HTTPS');
  assert(!u.username && !u.password, 'canonical URL userinfo is forbidden');
  assert(u.hostname === expected && u.hostname === u.hostname.toLowerCase() && !u.hostname.endsWith('.'), 'canonical URL host mismatch');
  assert(!u.port || u.port === '443', 'canonical URL port mismatch');
  assert(u.pathname === '/' && !u.search && !u.hash, 'canonical URL path/query mismatch');
  return `https://${expected}`;
}

function verifySafeRecordPath(root, recordPath, fsApi = fs) {
  assert(typeof root === 'string' && path.isAbsolute(root), 'repository root missing');
  assert(typeof recordPath === 'string' && recordPath.length > 0 && recordPath.trim() === recordPath, 'record path missing');
  assert(!path.isAbsolute(recordPath) && !recordPath.includes('\\') && SAFE_PATH.test(recordPath), 'record path unsafe');
  const absRoot = fsApi.realpathSync(root);
  const abs = path.resolve(absRoot, recordPath);
  assert(abs === absRoot || abs.startsWith(`${absRoot}${path.sep}`), 'record path escapes repository');
  const stat = fsApi.lstatSync(abs);
  assert(!stat.isSymbolicLink(), 'record path symlink is forbidden');
  assert(stat.isFile(), 'record path is not a regular file');
  const real = fsApi.realpathSync(abs);
  assert(real === absRoot || real.startsWith(`${absRoot}${path.sep}`), 'record path symlink escapes repository');
  return { path: recordPath, absolute: abs, realpath: real, exists: true };
}

function validateManifestValue(manifest, root) {
  assert(object(manifest), 'migration manifest must be an object');
  assert(manifest.migration_id === 'SELFIE-POLICY', 'migration profile mismatch');
  assert(manifest.manifest_path === SELFIE_MANIFEST || manifest.manifestPath === SELFIE_MANIFEST, 'manifest path mismatch');
  assert(own(manifest, 'current_production_deployment_id'), 'deployment field missing');
  if (manifest.current_production_deployment_id !== null) assert(deploymentId(manifest.current_production_deployment_id), 'deployment ID malformed');
  if (manifest.current_production_deployment_id === null) assert(root, 'null baseline requires repository root');
  return manifest;
}

function invariantFingerprint(snapshot) {
  assert(object(snapshot), 'baseline snapshot missing');
  const volatile = new Set(['observed_at', 'request_id', 'x_vercel_id', 'duration_ms', 'created_at', 'updated_at']);
  function clean(v) { if (Array.isArray(v)) return v.map(clean); if (object(v)) return Object.fromEntries(Object.keys(v).filter(k => !volatile.has(k)).sort().map(k => [k, clean(v[k])])); return v; }
  return require('node:crypto').createHash('sha256').update(JSON.stringify(clean(snapshot))).digest('hex');
}

function sanitizeBaseline(snapshot) {
  const forbidden = /token|authorization|cookie|secret|password|signed.?url|set-cookie|x-api-key/i;
  function clean(v, key = '') { assert(!forbidden.test(key), 'sensitive field in baseline artifact'); if (Array.isArray(v)) return v.map(x => clean(x)); if (object(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, clean(x, k)])); return typeof v === 'string' && forbidden.test(v) ? fail('sensitive payload in baseline artifact') : v; }
  return clean(snapshot);
}

function pageInfo(headers, url) { const link = headers?.get?.('link') || headers?.link || ''; const m = link.match(/<([^>]+)>;\s*rel="?next"?/i); return m ? new URL(m[1], url).toString() : null; }
async function getJson(request, url, label, token = null, method = 'GET') { const u = new URL(url); assert(u.protocol === 'https:', `${label} URL must use HTTPS`); const headers = token ? { Authorization: `Bearer ${token}`, Accept: 'application/json' } : { Accept: 'application/json' }; const r = await request(u.toString(), { method, headers, redirect: 'manual' }); assert(r && r.status === 200, `${label} HTTP failure`); const data = await r.json(); assert(data !== null, `${label} empty JSON`); return { data, headers: r.headers }; }

async function collectGithub({ request, repository, token, expectedSha, rollbackId }) {
  assert(/^[^/]+\/[^/]+$/.test(repository), 'GitHub repository malformed');
  let url = `https://api.github.com/repos/${repository}/deployments?environment=Production&per_page=100`;
  const rows = []; let pages = 0;
  while (url) { assert(++pages <= MAX_PAGES, 'GitHub pagination exceeds limit'); const r = await getJson(request, url, 'GitHub deployments', token); assert(Array.isArray(r.data), 'GitHub deployments malformed'); rows.push(...r.data); const next = pageInfo(r.headers, url); assert(next || r.data.length < 100, 'GitHub pagination incomplete'); url = next; }
  assert(rows.length > 0, 'GitHub deployments empty');
  for (const row of rows) assert(object(row) && Number.isSafeInteger(row.id) && row.id > 0 && sha(row.sha) && row.environment === 'Production' && Number.isFinite(Date.parse(row.created_at)), 'GitHub deployment malformed');
  const latest = rows.reduce((a, b) => Date.parse(a.created_at) > Date.parse(b.created_at) || (Date.parse(a.created_at) === Date.parse(b.created_at) && a.id > b.id) ? a : b);
  assert(latest.sha === expectedSha, 'latest GitHub SHA mismatch');
  const statuses = []; let su = `https://api.github.com/repos/${repository}/deployments/${latest.id}/statuses?per_page=100`; pages = 0;
  while (su) { assert(++pages <= MAX_PAGES, 'GitHub status pagination exceeds limit'); const r = await getJson(request, su, 'GitHub statuses', token); assert(Array.isArray(r.data), 'GitHub statuses malformed'); statuses.push(...r.data); su = pageInfo(r.headers, su); }
  assert(statuses.length > 0, 'GitHub statuses empty');
  const latestStatus = statuses.reduce((a, b) => Date.parse(a.created_at || a.updated_at) >= Date.parse(b.created_at || b.updated_at) ? a : b);
  assert(latestStatus.state === 'success', 'latest GitHub status is not success');
  const reread = await getJson(request, `https://api.github.com/repos/${repository}/deployments?environment=Production&per_page=100`, 'GitHub deployment reread', token);
  assert(Array.isArray(reread.data)); const same = reread.data.find(x => x.id === latest.id); assert(same && same.sha === latest.sha, 'GitHub deployment changed during read');
  return { latestDeploymentId: latest.id, latestSha: latest.sha, latestStatus: latestStatus.state, paginationComplete: true, rollbackId };
}

function assertVercelUrl(raw, canonical) { const u = new URL(raw); assert(u.protocol === 'https:' && u.hostname === 'api.vercel.com' && !u.username && !u.password && !u.port, 'Vercel endpoint not allowlisted'); assert(!u.pathname.includes('..'), 'Vercel endpoint traversal'); assert(canonical === normalizeCanonicalUrl(canonical), 'canonical identity invalid'); return u; }
async function collectVercel({ request, token, teamId, projectId, deploymentId: id, canonicalUrl }) {
  assert(/^team_[A-Za-z0-9]+$/.test(teamId) && /^prj_[A-Za-z0-9]+$/.test(projectId) && deploymentId(id), 'Vercel identity malformed');
  const endpoint = assertVercelUrl(`https://api.vercel.com/v13/deployments/${encodeURIComponent(id)}?teamId=${encodeURIComponent(teamId)}`, canonicalUrl);
  const readDeployment = async () => { const r = await getJson(request, endpoint, 'Vercel deployment', token); const d = r.data; assert(d.id === id && d.projectId === projectId && d.teamId === teamId && d.target === 'production' && d.readyState === 'READY' && sha(d.meta?.githubCommitSha), 'Vercel deployment identity/state mismatch'); return d; };
  const before = await readDeployment(); const aliasEndpoint = assertVercelUrl(`https://api.vercel.com/v4/aliases/${encodeURIComponent(new URL(canonicalUrl).hostname)}?teamId=${encodeURIComponent(teamId)}`, canonicalUrl);
  const aliasBefore = (await getJson(request, aliasEndpoint, 'Vercel canonical alias', token)).data; assert(aliasBefore.deployment?.id === id, 'canonical alias target mismatch');
  const after = await readDeployment(); const aliasAfter = (await getJson(request, aliasEndpoint, 'Vercel canonical alias reread', token)).data; assert(after.id === before.id && after.meta.githubCommitSha === before.meta.githubCommitSha && aliasAfter.deployment?.id === aliasBefore.deployment?.id, 'Vercel evidence changed during read');
  return { deploymentId: id, projectId, teamId, target: after.target, readyState: after.readyState, sourceSha: after.meta.githubCommitSha, canonicalAliasTarget: aliasAfter.deployment.id };
}

module.exports = { MAX_JSON_BYTES, MAX_JSON_DEPTH, SELFIE_MANIFEST, parseBoundedJson, normalizeCanonicalUrl, verifySafeRecordPath, validateManifestValue, invariantFingerprint, sanitizeBaseline, collectGithub, collectVercel };
