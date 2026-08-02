'use strict';

const expectedCanonical = 'https://sms-v3-staging-ten.vercel.app';
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const loginPath = '/login';

function normalizeBase(raw, name) {
  if (!raw) throw new Error(`${name} is missing`);
  const url = new URL(raw);
  if (url.protocol !== 'https:') throw new Error(`${name} must use HTTPS`);
  const hostname = url.hostname.toLowerCase();
  if (name === 'DEPLOYMENT_URL' && hostname !== 'sms-v3-staging-ten.vercel.app' && !(hostname.startsWith('sms-v3-staging-') && hostname.endsWith('.vercel.app'))) {
    throw new Error('DEPLOYMENT_URL is not an sms-v3-staging deployment');
  }
  return url.origin;
}

async function request(url) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
  return { response, text: await response.text(), location: response.headers.get('location') };
}

function safeLocation(location, base) {
  if (!location) return 'missing';
  try {
    const target = new URL(location, base);
    const baseUrl = new URL(base);
    const canonicalUrl = new URL(expectedCanonical);
    if (target.protocol !== 'https:' || ![baseUrl.hostname, canonicalUrl.hostname].includes(target.hostname)) return 'external';
    return target.pathname;
  } catch {
    return 'invalid';
  }
}

function resolveLoginRedirect(location, base) {
  if (!location) throw new Error('root redirect missing Location');
  let target;
  try { target = new URL(location, base); } catch { throw new Error('root redirect Location is invalid'); }
  const baseUrl = new URL(base);
  const canonicalUrl = new URL(expectedCanonical);
  if (target.protocol !== 'https:' || ![baseUrl.hostname, canonicalUrl.hostname].includes(target.hostname)) {
    throw new Error('root redirect target is external');
  }
  if (target.pathname !== loginPath) throw new Error('root redirect target is not the approved login route');
  return `${target.origin}${target.pathname}`;
}

async function verifyAssets(name, base, text, log) {
  const assets = [...text.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:css|js))["']/g)].map((match) => match[1]).slice(0, 20);
  for (const asset of assets) {
    const assetResponse = await fetch(`${base}${asset}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
    log(`${name} asset status=${assetResponse.status}`);
    if (assetResponse.status !== 200) throw new Error(`${name} asset returned HTTP ${assetResponse.status}`);
  }
}

async function verifyLoginPage(name, base, log) {
  const { response, text, location } = await request(`${base}${loginPath}`);
  log(`${name} ${loginPath} status=${response.status}${redirectStatuses.has(response.status) ? ` location=${safeLocation(location, base)}` : ''}`);
  if (response.status !== 200) throw new Error(`${name} ${loginPath} returned HTTP ${response.status}`);
  await verifyAssets(name, base, text, log);
}

async function verifyRoot(name, base, log) {
  const { response, text, location } = await request(`${base}/`);
  log(`${name} / status=${response.status}${redirectStatuses.has(response.status) ? ` location=${safeLocation(location, base)}` : ''}`);
  if (response.status === 200) {
    await verifyAssets(name, base, text, log);
    return base;
  }
  if (!redirectStatuses.has(response.status)) throw new Error(`${name} / returned HTTP ${response.status}`);
  const loginBase = resolveLoginRedirect(location, base);
  await verifyLoginPage(name, loginBase, log);
  return loginBase;
}

async function verifyApi(name, base, path, log) {
  const { response } = await request(`${base}${path}`);
  log(`${name} ${path} status=${response.status}`);
  if (![200, 201, 202, 204, 401, 403].includes(response.status)) {
    throw new Error(`${name} ${path} returned unexpected HTTP ${response.status}`);
  }
}

async function verifyBase(name, base, log) {
  const loginBase = await verifyRoot(name, base, log);
  if (loginBase === base) await verifyLoginPage(name, base, log);
  for (const path of ['/api/v1/health', '/api/v1/ready']) {
    const { response, text } = await request(`${base}${path}`);
    log(`${name} ${path} status=${response.status}`);
    if (response.status !== 200) throw new Error(`${name} ${path} returned HTTP ${response.status}`);
    if (path === '/api/v1/ready') {
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`${name} readiness response was not JSON`); }
      if (body.status !== 'ready' || body.database !== 'ok') throw new Error(`${name} readiness gate failed`);
    }
  }
  await verifyApi(name, base, '/api/v1/dashboard', log);
  await verifyApi(name, base, '/api/v1/licenses', log);
}

async function main({ env = process.env, log = console.log, error = console.error } = {}) {
  try {
    const deployment = normalizeBase(env.DEPLOYMENT_URL, 'DEPLOYMENT_URL');
    const canonical = normalizeBase(env.CANONICAL_URL || expectedCanonical, 'CANONICAL_URL');
    if (canonical !== expectedCanonical) throw new Error('CANONICAL_URL does not match the approved staging domain');
    await verifyBase('deployment', deployment, log);
    await verifyBase('canonical', canonical, log);
    log('AUTHENTICATED_SMOKE=pending dedicated non-human test account');
    return 0;
  } catch (reason) {
    error(`Post-deploy health gate failed: ${reason.message}`);
    return 1;
  }
}

if (require.main === module) main().then((status) => { process.exitCode = status; });

module.exports = { expectedCanonical, normalizeBase, main };
