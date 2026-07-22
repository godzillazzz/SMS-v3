const crypto = require('node:crypto');
function trustedPlatformRequestId(req) {
  if (!process.env.VERCEL) return undefined;
  const value = req.get('x-vercel-id');
  return typeof value === 'string' && /^[A-Za-z0-9:_-]{1,128}$/.test(value) ? value : undefined;
}
function requestContext(req, res, next) {
  req.requestId = trustedPlatformRequestId(req) || crypto.randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
}
module.exports = requestContext;
module.exports.trustedPlatformRequestId = trustedPlatformRequestId;
