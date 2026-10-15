'use strict';

const fs = require('node:fs');
const path = require('node:path');

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

function routeGuard(source, route, expectedRoles) {
  const escaped = route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = source.match(new RegExp(`router\\.(?:post|put)\\(['"]${escaped}['"],\\s*authorize\\(([^)]*)\\)`));
  if (!match) throw contractError(`Missing guarded route: ${route}`);
  const roles = [...match[1].matchAll(/['"]([A-Z]+)['"]/g)].map((item) => item[1]);
  if (roles.join(',') !== expectedRoles.join(',')) throw contractError(`Guard drift: ${route}`);
}

function validateApplicationSourceContract(applicationRoot = process.env.UAT_APPLICATION_ROOT) {
  if (!applicationRoot || !fs.existsSync(applicationRoot)) {
    const error = new Error('UAT_APPLICATION_ROOT is required');
    error.code = 'UAT_APPLICATION_SOURCE_REQUIRED';
    throw error;
  }
  const operations = requiredFile(applicationRoot, 'src/routes/operations.routes.js');
  const schedules = requiredFile(applicationRoot, 'src/routes/schedules.routes.js');
  const routing = requiredFile(applicationRoot, 'frontend/src/routing.ts');

  routeGuard(operations, '/schedule/approve-month', ['ADMIN', 'SUPERVISOR']);
  routeGuard(operations, '/schedule-approvals/:id', ['ADMIN', 'SUPERVISOR']);
  routeGuard(schedules, '/approve', ['ADMIN', 'SUPERVISOR']);

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
