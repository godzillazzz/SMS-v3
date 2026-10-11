process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const request = require('supertest');
const jwt = require('jsonwebtoken');
const env = require('../src/config/env');
const jobs = require('../vercel.json').crons;
const calls = [];
let failSchedule = false;
const result = (name) => async () => {
  calls.push(name);
  if (name === 'schedule' && failSchedule) throw new Error('disposable failure');
  return { inspected: 0 };
};
const stub = (module, exports) => { require.cache[require.resolve(module)] = { exports }; };
// Exercise the real router, secret verifier and JWT middleware, with no database or storage access.
stub('../src/config/prisma', {});
stub('../src/services/license-schedule-reconciliation.service', {
  reconcileAllEmployeeLicenseSchedules: result('schedule'), reconcileEmployeeLicenseSchedules: result('employee')
});
stub('../src/services/license-document-retention.service', {
  ...require('../src/services/license-document-retention.service'),
  expireDueLicenseDocuments: result('expired'), cleanupDueLicenseDocuments: result('cleanup')
});
stub('../src/services/license-document-storage.service', {
  ...require('../src/services/license-document-storage.service'), createSupabaseLicenseDocumentStorage: () => ({})
});
stub('../src/services/attendance-face-evidence-storage.service', {
  createSupabaseAttendanceFaceEvidenceStorage: () => ({ purgeExpired: result('attendance') })
});
stub('../src/services/data-retention.service', {
  ...require('../src/services/data-retention.service'), createDataRetentionService: () => ({ runCleanup: result('retention') })
});
stub('../src/services/annual-leave-quota-cron.service', { provisionAnnualLeaveQuotas: result('quota') });
const { notFound, errorHandler } = require('../src/middlewares/error-handler');
const app = express();
app.use('/api/v1', require('../src/routes/operations.routes'));
app.use(notFound);
app.use(errorHandler);
const cronSecret = randomUUID();
test.beforeEach(() => { calls.length = 0; failSchedule = false; process.env.CRON_SECRET = cronSecret; });
test.after(() => { delete process.env.CRON_SECRET; });

test('all four scheduled GET jobs accept only the Cron authority before user JWT authentication', async () => {
  assert.equal(jobs.length, 4);
  for (const job of jobs) {
    const response = await request(app).get(job.path).set('Authorization', `Bearer ${cronSecret}`);
    assert.equal(response.status, 200, job.path);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.body.data);
  }
  assert.deepEqual(calls, ['schedule', 'expired', 'cleanup', 'quota', 'attendance', 'retention']);
});

test('missing, malformed, query-string and role JWT credentials cannot invoke any scheduled job', async () => {
  const headers = [undefined, 'Bearer wrong', 'Basic wrong', cronSecret];
  for (const role of ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER']) {
    headers.push('Bearer ' + jwt.sign({ sub: randomUUID(), role, tokenVersion: 0 }, env.jwtSecret, {
      algorithm: env.jwtAlgorithm, issuer: env.jwtIssuer, audience: env.jwtAudience, expiresIn: '1m'
    }));
  }
  for (const job of jobs) {
    for (const authorization of headers) {
      const query = request(app).get(job.path).query({ secret: cronSecret }).set('User-Agent', 'vercel-cron/1.0');
      if (authorization) query.set('Authorization', authorization);
      assert.equal((await query).status, 401, job.path);
    }
  }
  assert.deepEqual(calls, []);
});

test('an unconfigured CRON_SECRET fails closed for every job', async () => {
  delete process.env.CRON_SECRET;
  for (const job of jobs) {
    assert.equal((await request(app).get(job.path).set('Authorization', 'Bearer undefined')).status, 401);
  }
  assert.deepEqual(calls, []);
});

test('HEAD cannot invoke GET mutations and POST does not regain the old license authority', async () => {
  for (const job of [...jobs].reverse()) {
    assert.equal((await request(app).head(job.path).set('Authorization', `Bearer ${cronSecret}`)).status, 401);
    assert.equal((await request(app).post(job.path).set('Authorization', `Bearer ${cronSecret}`)).status, 401);
  }
  assert.deepEqual(calls, []);
});

test('Cron credentials do not authenticate an ordinary business API', async () => {
  assert.equal((await request(app).get('/api/v1/licenses').set('Authorization', `Bearer ${cronSecret}`)).status, 401);
  assert.deepEqual(calls, []);
});

test('reconciliation failure is an error and does not proceed to document deletion', async () => {
  failSchedule = true;
  const response = await request(app).get('/api/v1/internal/license-reconciliation').set('Authorization', `Bearer ${cronSecret}`);
  assert.equal(response.status, 500);
  assert.deepEqual(calls, ['schedule']);
  assert.equal(JSON.stringify(response.body).includes(cronSecret), false);
});
