'use strict';

process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');

const { assertCorrectionActor } = require('../src/services/attendance-correction.service');

// OWNER policy (18 Oct 2026): SUPERVISOR/MANAGER/ADMIN are cross-department executives.
// `authenticate` does not populate actor.department, so correction reads must not depend on it.
const assignment = { id: '11111111-1111-4111-8111-111111111111', departmentSnapshot: 'OPS', employee: { department: 'OPS' } };
const codeOf = (fn) => {
  try { fn(); return null; } catch (error) { return error.details?.code || error.code || error.message; }
};

test('executives may read corrections for any department and without actor.department', () => {
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR']) {
    assert.equal(assertCorrectionActor({ sub: 'user-1', role }, assignment), role, `${role} must be allowed`);
  }
});

test('non-executive roles are denied', () => {
  for (const role of ['VIEWER', 'EMPLOYEE', 'GUEST']) {
    assert.equal(
      codeOf(() => assertCorrectionActor({ sub: 'user-1', role }, assignment)),
      'ATTENDANCE_CORRECTION_FORBIDDEN',
      `${role} must be denied`
    );
  }
});
