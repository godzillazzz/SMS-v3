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

test('MANAGER in the same department can read a private file using the actor department from the database', async () => {
  reset();
  const response = await getFile();
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, bytes);
  assert.deepEqual(actorLookups, [{
    where: { id: 'actor-employee' },
    select: { id: true, department: true, isActive: true, deletedAt: true }
  }]);
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
  assert.equal(actorLookups.length, 1);
});

test('SUPERVISOR in the same department can read a private file', async () => {
  reset({ role: 'SUPERVISOR' });
  const response = await getFile();
  assert.equal(response.status, 200);
  assert.equal(actorLookups.length, 1);
});

test('MANAGER in another department is denied', async () => {
  reset({ employee: { id: 'actor-employee', department: 'Finance', isActive: true, deletedAt: null } });
  const response = await getFile();
  assert.equal(response.status, 403);
  assert.equal(resolverReads, 0);
});

test('actor without a linked employee is denied', async () => {
  reset({ employeeAuthorityId: null, employee: null });
  const response = await getFile();
  assert.equal(response.status, 403);
  assert.equal(actorLookups.length, 0);
  assert.equal(resolverReads, 0);
});

test('actor whose employee record is missing is denied', async () => {
  reset({ employee: null });
  const response = await getFile();
  assert.equal(response.status, 403);
  assert.equal(resolverReads, 0);
});

test('inactive or deleted actor employee is denied', async (t) => {
  for (const employee of [
    { id: 'actor-employee', department: 'Operations', isActive: false, deletedAt: null },
    { id: 'actor-employee', department: 'Operations', isActive: true, deletedAt: new Date() }
  ]) {
    await t.test(employee.isActive ? 'deleted' : 'inactive', async () => {
      reset({ employee });
      const response = await getFile();
      assert.equal(response.status, 403);
      assert.equal(resolverReads, 0);
    });
  }
});

test('VIEWER is denied by route authorization', async () => {
  reset({ role: 'VIEWER' });
  const response = await getFile();
  assert.equal(response.status, 403);
  assert.equal(actorLookups.length, 0);
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
