const crypto = require('node:crypto');
const net = require('node:net');

function normalizeIpIdentity(value) {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  const normalized = value.trim().toLowerCase().replace(/^::ffff:/, '');
  return net.isIP(normalized) ? normalized : 'unknown';
}

function normalizeAccountIdentity(value) {
  if (typeof value !== 'string' || !value.trim()) return 'unknown';
  return value.trim().toLowerCase();
}

function getRequestIpIdentity(req, { isVercel = Boolean(process.env.VERCEL) } = {}) {
  const platformValue = isVercel
    ? req.get?.('x-vercel-forwarded-for') || req.headers?.['x-vercel-forwarded-for']
    : undefined;
  const candidate = Array.isArray(platformValue) ? platformValue[0] : platformValue;
  const firstAddress = typeof candidate === 'string' ? candidate.split(',')[0] : candidate;
  return normalizeIpIdentity(firstAddress || req.ip);
}

function hashRateLimitIdentity({ secret, scope, identity }) {
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32) {
    throw new Error('Rate-limit hash secret is unavailable.');
  }
  return crypto.createHmac('sha256', secret).update(scope).update('\0').update(identity).digest('hex');
}

module.exports = { normalizeIpIdentity, normalizeAccountIdentity, getRequestIpIdentity, hashRateLimitIdentity };
