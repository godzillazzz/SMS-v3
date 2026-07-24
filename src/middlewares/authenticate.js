const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');

async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Authentication required.'));

  try {
    const claims = jwt.verify(header.slice(7), env.jwtSecret, { algorithms: [env.jwtAlgorithm], issuer: env.jwtIssuer, audience: env.jwtAudience });
    const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: { id: true, email: true, role: true, isActive: true, accountStatus: true, passwordResetRequired: true, tokenVersion: true } });
    if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || user.passwordResetRequired || user.tokenVersion !== claims.tokenVersion) throw new Error('Token no longer valid.');
    req.user = { sub: user.id, email: user.email, role: user.role, tokenVersion: user.tokenVersion };
    return next();
  } catch {
    return next(new HttpError(401, 'Invalid or expired access token.'));
  }
}

function authorize(...roles) {
  return (req, _res, next) => roles.includes(req.user.role)
    ? next()
    : next(new HttpError(403, 'You do not have permission for this action.'));
}

module.exports = { authenticate, authorize };
