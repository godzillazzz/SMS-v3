'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { getRoleActionMatrix, getRoleNavigationContract } = require('./role-matrix');

function rolesFromGuard(guard) {
  return [...String(guard).matchAll(/\b(ADMIN|MANAGER|SUPERVISOR|VIEWER)\b/g)].map((match) => match[1]).filter((role, index, values) => values.indexOf(role) === index);
}

function contractError(message) {
  const error = new Error(message);
  error.code = 'UAT_APPLICATION_SOURCE_CONTRACT_INVALID';
  return error;
}

function requiredFile(root, relativePath) {
  const filePath = path.join(root, relativePath);
  if (!fs.existsSync(filePath)) {
    const error = new Error(`Missing application source file: ${relativePath}`);
    error.code = 'UAT_APPLICATION_SOURCE_REQUIRED';
    throw error;
  }
  return fs.readFileSync(filePath, 'utf8');
}

function routeGuard(source, route) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`router\\.(?:post|put)\\(['"]${escaped}['"],\\s*authorize\\(([^)]*)\\)`));
  if (!match) throw contractError(`Missing guarded route: ${route}`);
  return rolesFromGuard(match[1]);
}

function expectedActionGuards(matrix) {
  return matrix.SUPERVISOR.map(([, method, route, , source, guard]) => ({ method, route, source, roles: rolesFromGuard(guard) }));
}

function compareActionMatrix(matrix, sourceFiles) {
  for (const action of expectedActionGuards(matrix)) {
    const source = sourceFiles[action.source];
    if (!source) throw contractError(`Missing action source: ${action.source}`);
    const route = action.source.endsWith('schedules.routes.js')
      ? action.route.replace(/^\/api\/v1\/schedules/, '')
      : action.route.replace(/^\/api\/v1/, '');
    const actual = routeGuard(source, route);
    if (actual.join(',') !== action.roles.join(',')) throw contractError(`Matrix/source guard drift: ${action.route}`);
  }
  if (matrix.MANAGER.some(([, , route]) => route.includes('/schedule/approve'))) throw contractError('Manager schedule approval drift');
}

function validateApplicationSourceContract(applicationRoot = process.env.UAT_APPLICATION_ROOT, roleMatrix = null) {
  if (!applicationRoot || !fs.existsSync(applicationRoot)) {
    const error = new Error('UAT_APPLICATION_ROOT is required');
    error.code = 'UAT_APPLICATION_SOURCE_REQUIRED';
    throw error;
  }
  const operations = requiredFile(applicationRoot, 'src/routes/operations.routes.js');
  const schedules = requiredFile(applicationRoot, 'src/routes/schedules.routes.js');
  const routing = requiredFile(applicationRoot, 'frontend/src/routing.ts');
  const sourceMatrix = roleMatrix || { getRoleActionMatrix, getRoleNavigationContract };
  const matrix = { SUPERVISOR: sourceMatrix.getRoleActionMatrix('SUPERVISOR').map(({ label, method, path: route, expectedStatus, source, guard }) => [label, method, route, expectedStatus, source, guard]), MANAGER: sourceMatrix.getRoleActionMatrix('MANAGER').map(({ label, method, path: route, expectedStatus, source, guard }) => [label, method, route, expectedStatus, source, guard]) };
  compareActionMatrix(matrix, { 'src/routes/operations.routes.js': operations, 'src/routes/schedules.routes.js': schedules });

  routeGuard(operations, '/schedule/approve-month');
  routeGuard(operations, '/schedule-approvals/:id');
  routeGuard(schedules, '/approve');

  const supervisorNavigation = sourceMatrix.getRoleNavigationContract('SUPERVISOR');
  const managerNavigation = sourceMatrix.getRoleNavigationContract('MANAGER');
  const approvalAllowed = /page === ['"]approvals['"][\s\S]{0,180}\['ADMIN', 'SUPERVISOR'\]/.test(routing);
  const attendanceAdminOnly = /page === ['"]attendanceReport['"][\s\S]{0,180}auth\.user\?\.role === ['"]ADMIN['"]/.test(routing);
  if (!approvalAllowed === supervisorNavigation.required.some(({ id }) => id === 'approvals')) throw contractError('Approval navigation matrix drift');
  if (managerNavigation.required.some(({ id }) => id === 'approvals')) throw contractError('Manager approval navigation drift');
  if (!attendanceAdminOnly || !supervisorNavigation.forbidden.some(({ id }) => id === 'attendanceReport')) throw contractError('Attendance report navigation matrix drift');

  const approvalStart = operations.indexOf("router.put('/schedule-approvals/:id'");
  const approvalRoute = approvalStart >= 0 ? operations.slice(approvalStart, approvalStart + 12000) : '';
  if (!/req\.user\.role\s*===\s*['"]SUPERVISOR['"][\s\S]{0,500}input\.status\s*!==\s*['"]APPROVED['"]/.test(approvalRoute)) {
    throw contractError('Supervisor schedule approval ceiling drifted');
  }
  if (!/page === ['"]approvals['"]/.test(routing) || !/\['ADMIN', 'SUPERVISOR'\]/.test(routing)) {
    throw contractError('Approval navigation guard drifted');
  }
  if (!/page === ['"]attendanceReport['"]/.test(routing) || !/auth\.user\?\.role === ['"]ADMIN['"]/.test(routing)) {
    throw contractError('Attendance report navigation guard drifted');
  }
  return true;
}

module.exports = { validateApplicationSourceContract };
