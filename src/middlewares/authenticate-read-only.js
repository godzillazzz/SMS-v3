'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const prisma = require('../config/prisma');
const HttpError = require('../utils/http-error');

// Restricted to endpoints whose contract must be read-only. Unlike authenticate,
// this intentionally never runs due lifecycle reconciliation that can write rows.
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

function activeAccount(user, tokenVersion) {
  return user && user.isActive && user.accountStatus === 'ACTIVE'
    && !user.passwordResetRequired && user.tokenVersion === tokenVersion;
}

function bangkokToday(now = new Date()) {
  const shifted = new Date(now.getTime() + (7 * 60 * 60 * 1000));
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()));
}

async function hasDueTerminationEvent(employeeId) {
  if (!employeeId || !prisma.employeeLifecycleEvent?.findMany) return false;
  const events = await prisma.employeeLifecycleEvent.findMany({
    where: {
      employeeId,
      status: 'PENDING',
      effectiveDate: { lte: bangkokToday() },
      type: { in: ['EMPLOYMENT_TERMINATION', 'MASTER_EDIT'] }
    },
    select: { type: true, newValue: true }
  });
  return events.some((event) => event.type === 'EMPLOYMENT_TERMINATION'
    || (event.type === 'MASTER_EDIT' && event.newValue?.employee?.isActive === false));
}

function authenticateReadOnly(...authorizedRoles) {
  return async function authenticateReadOnlyMiddleware(req, _res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) return next(new HttpError(401, 'Authentication required.'));

    try {
      const claims = jwt.verify(header.slice(7), env.jwtSecret, {
        algorithms: [env.jwtAlgorithm], issuer: env.jwtIssuer, audience: env.jwtAudience
      });
      const user = await prisma.user.findUnique({ where: { id: claims.sub }, select: userSelect });
      if (!activeAccount(user, claims.tokenVersion)) throw new Error('Token no longer valid.');
      let impersonator;
      if (claims.impersonation) {
        impersonator = await prisma.user.findUnique({ where: { id: claims.impersonatorSub }, select: userSelect });
        if (!activeAccount(impersonator, claims.impersonatorTokenVersion) || impersonator.role !== 'ADMIN') {
          throw new Error('View As token no longer valid.');
        }
      }
      if (authorizedRoles.length && !authorizedRoles.includes(user.role)) {
        return next(new HttpError(403, 'You do not have permission for this action.'));
      }
      if (await hasDueTerminationEvent(user.employeeId)) throw new Error('Token no longer valid.');

      if (claims.impersonation) {
        if (await hasDueTerminationEvent(impersonator.employeeId)) throw new Error('View As token no longer valid.');
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next(new HttpError(403, 'View As mode is read-only.'));
      }

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
  };
}

module.exports = { authenticateReadOnly };
