'use strict';

const expectedCanonical = 'https://sms-v3-staging-ten.vercel.app';

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
  return { response, text: await response.text() };
}

async function verifyBase(name, base, log) {
  for (const path of ['/', '/login', '/api/v1/health', '/api/v1/ready']) {
    const { response, text } = await request(`${base}${path}`);
    log(`${name} ${path} status=${response.status}`);
    if (response.status !== 200) throw new Error(`${name} ${path} returned HTTP ${response.status}`);
    if (path === '/api/v1/ready') {
      let body;
      try { body = JSON.parse(text); } catch { throw new Error(`${name} readiness response was not JSON`); }
      if (body.status !== 'ready' || body.database !== 'ok') throw new Error(`${name} readiness gate failed`);
    }
    if (path === '/') {
      const assets = [...text.matchAll(/(?:src|href)=["'](\/assets\/[^"']+\.(?:css|js))["']/g)].map((match) => match[1]).slice(0, 20);
      for (const asset of assets) {
        const assetResponse = await fetch(`${base}${asset}`, { redirect: 'manual', signal: AbortSignal.timeout(20000) });
        log(`${name} asset status=${assetResponse.status}`);
        if (assetResponse.status !== 200) throw new Error(`${name} asset returned HTTP ${assetResponse.status}`);
      }
    }
  }
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
