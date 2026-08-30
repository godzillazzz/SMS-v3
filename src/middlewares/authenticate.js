const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');
const {
  synchronizeDueLifecycleEventsForRequest,
  synchronizeDueLifecycleEventsForEmployee
} = require('../services/employee-lifecycle.service');

const userSelect = {
  id: true,
  email: true,
  role: true,
  employeeId: true,
  isActive: true,
  accountStatus: true,
  passwordResetRequired: true,
  tokenVersion: true,
  employee: { select: { id: true, isActive: true, deletedAt: true } }
};

async function loadSynchronizedUser(userId) {
  let user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  if (user?.employeeId) {
    await synchronizeDueLifecycleEventsForEmployee(user.employeeId);
    user = await prisma.user.findUnique({ where: { id: userId }, select: userSelect });
  }
  return user;
}

async function authenticate(req, _res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Authentication required.'));

  try {
    const claims = jwt.verify(header.slice(7), env.jwtSecret, { algorithms: [env.jwtAlgorithm], issuer: env.jwtIssuer, audience: env.jwtAudience });
    await synchronizeDueLifecycleEventsForRequest();
    const user = await loadSynchronizedUser(claims.sub);
    if (!user || !user.isActive || user.accountStatus !== 'ACTIVE' || user.passwordResetRequired || user.tokenVersion !== claims.tokenVersion) throw new Error('Token no longer valid.');
    if (claims.impersonation) {
      const impersonator = await loadSynchronizedUser(claims.impersonatorSub);
      if (!impersonator || impersonator.role !== 'ADMIN' || !impersonator.isActive || impersonator.accountStatus !== 'ACTIVE' || impersonator.passwordResetRequired || impersonator.tokenVersion !== claims.impersonatorTokenVersion) throw new Error('View As token no longer valid.');
    }
    if (claims.impersonation && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(new HttpError(403, 'View As mode is read-only.'));
    req.user = {
      sub: user.id,
      email: user.email,
      role: user.role,
      tokenVersion: user.tokenVersion,
      impersonation: Boolean(claims.impersonation),
      impersonatorSub: claims.impersonatorSub,
      employeeAuthority: user.employee
        ? { id: user.employee.id, isActive: user.employee.isActive, deletedAt: user.employee.deletedAt }
        : null
    };
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
