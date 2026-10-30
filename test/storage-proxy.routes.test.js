'use strict';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:placeholder@localhost:5432/smsv3_test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const Module = require('node:module');
const path = require('node:path');

let actor = { sub: 'actor-user', role: 'MANAGER', employeeAuthority: { id: 'actor-employee' } };
let tokenRequired = true;
const authFilename = Module._resolveFilename('../src/middlewares/authenticate', module);
require.cache[authFilename] = {
  id: authFilename,
  filename: authFilename,
  loaded: true,
  exports: {
    authenticate: (req, _res, next) => {
      if (tokenRequired && req.headers.authorization !== 'Bearer test-token') {
        return next(Object.assign(new Error('Authentication required.'), { statusCode: 401 }));
      }
      req.user = actor;
      return next();
    },
    authorize: (...roles) => (req, _res, next) => roles.includes(req.user.role)
      ? next()
      : next(Object.assign(new Error('You do not have permission for this action.'), { statusCode: 403 }))
  },
  children: [],
  paths: Module._nodeModulePaths(path.dirname(authFilename))
};

const { createStorageProxyRouter } = require('../src/routes/storage-proxy.routes');
const ownerEmployee = { id: 'owner-employee', department: 'Operations' };
const liveFile = {
  id: 'license-1',
  employeeId: ownerEmployee.id,
  employee: ownerEmployee,
  storageDeletedAt: null,
  storageDeletionRequestedAt: null,
  purgedAt: null,
  purgeRequestedAt: null
};
const bytes = Buffer.from('private document');
let file = liveFile;
let actorEmployee = { id: 'actor-employee', department: 'Operations', isActive: true, deletedAt: null };
let actorLookups = [];
let resolverReads = 0;
const db = {
  employeeLicenseDocument: { findUnique: async () => file },
  employee: {
    findUnique: async (query) => {
      actorLookups.push(query);
      return query.where.id === actorEmployee?.id ? actorEmployee : null;
    }
  }
};
const app = express();
app.use('/api/v1/storage-proxy', createStorageProxyRouter({
  db,
  resolver: { read: async () => {
    resolverReads += 1;
    return { bytes, mimeType: 'application/pdf', sizeBytes: bytes.length, checksum: 'checksum' };
  } },
  auditService: { log: async () => {} }
}));
app.use((error, _req, res, _next) => res.status(error.statusCode || 500).json({ error: error.message }));

function reset({ role = 'MANAGER', employeeAuthorityId = 'actor-employee', employee = { id: 'actor-employee', department: 'Operations', isActive: true, deletedAt: null }, currentFile = liveFile, requireToken = true } = {}) {
  actor = { sub: 'actor-user', role, employeeAuthority: employeeAuthorityId ? { id: employeeAuthorityId, isActive: true, deletedAt: null } : null };
  tokenRequired = requireToken;
  actorEmployee = employee;
  file = currentFile;
  actorLookups = [];
  resolverReads = 0;
}

async function getFile({ withToken = true } = {}) {
  const call = request(app).get('/api/v1/storage-proxy/license/license-1');
  return withToken ? call.set('Authorization', 'Bearer test-token') : call;
}

// OWNER policy 2026-10-30 (and 18 Oct 2026, attendance-supervisor.service.js "MANAGER/SUPERVISOR are
// cross-department executives"): a department is only a place of work; every MANAGER and SUPERVISOR
// supervises all VIEWERs, so they may open private files of employees in any department.
test('MANAGER in the same department can read a private file', async () => {
  reset();
  const response = await getFile();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, bytes);
  assert.equal(resolverReads, 1);
});

test('ADMIN can read a private file without an employee lookup', async () => {
  reset({ role: 'ADMIN', employeeAuthorityId: null, employee: null });
  const response = await getFile();
  assert.equal(response.status, 200);
  assert.equal(actorLookups.length, 0);
});

test('same employee access remains allowed when the employee has no department', async () => {
  reset({
    employeeAuthorityId: ownerEmployee.id,
    employee: { id: ownerEmployee.id, department: null, isActive: true, deletedAt: null }
  });
  const response = await getFile();
  assert.equal(response.status, 200);
});

test('SUPERVISOR in the same department can read a private file', async () => {
  reset({ role: 'SUPERVISOR' });
  const response = await getFile();
  assert.equal(response.status, 200);
});

test('OWNER policy 2026-10-30: MANAGER and SUPERVISOR of another department can read the file (cross-department)', async (t) => {
  for (const role of ['MANAGER', 'SUPERVISOR']) {
    await t.test(role, async () => {
      reset({ role, employee: { id: 'actor-employee', department: 'Finance', isActive: true, deletedAt: null } });
      const response = await getFile();
      assert.equal(response.status, 200);
      assert.equal(resolverReads, 1);
    });
  }
});

test('OWNER policy 2026-10-30: MANAGER without a linked employee or department can read the file', async (t) => {
  for (const role of ['MANAGER', 'SUPERVISOR']) {
    await t.test(role, async () => {
      reset({ role, employeeAuthorityId: null, employee: null });
      const response = await getFile();
      assert.equal(response.status, 200);
      assert.equal(actorLookups.length, 0);
    });
  }
});

test('actor whose linked employee is inactive or deleted is denied', async (t) => {
  for (const authority of [
    { id: 'actor-employee', isActive: false, deletedAt: null },
    { id: 'actor-employee', isActive: true, deletedAt: new Date() }
  ]) {
    await t.test(authority.isActive ? 'deleted' : 'inactive', async () => {
      reset();
      actor = { ...actor, employeeAuthority: authority };
      const response = await getFile();
      assert.equal(response.status, 403);
      assert.equal(resolverReads, 0);
    });
  }
});

test('VIEWER is denied by route authorization (own or other employee files alike, unchanged since before AUD-M1)', async (t) => {
  for (const employeeAuthorityId of ['actor-employee', ownerEmployee.id]) {
    await t.test(employeeAuthorityId, async () => {
      reset({ role: 'VIEWER', employeeAuthorityId });
      const response = await getFile();
      assert.equal(response.status, 403);
      assert.equal(actorLookups.length, 0);
      assert.equal(resolverReads, 0);
    });
  }
});

test('a file without an owning employee is still denied for non-ADMIN (unchanged since before AUD-M1)', async () => {
  reset({ role: 'SUPERVISOR', currentFile: { ...liveFile, employee: null, employeeId: 'missing-employee' } });
  const response = await getFile();
  assert.equal(response.status, 403);
  assert.equal(resolverReads, 0);
});

test('request without a token is unauthorized', async () => {
  reset();
  const response = await getFile({ withToken: false });
  assert.equal(response.status, 401);
  assert.equal(resolverReads, 0);
});

test('deleted file returns 410 before reading storage', async () => {
  reset({ currentFile: { ...liveFile, storageDeletedAt: new Date() } });
  const response = await getFile();
  assert.equal(response.status, 410);
  assert.equal(actorLookups.length, 0);
  assert.equal(resolverReads, 0);
});
