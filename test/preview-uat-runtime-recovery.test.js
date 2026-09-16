const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const request = require('supertest');
const {
  createPreviewUatRecoveryRouter,
  RECOVERY_BRANCH,
  RECOVERY_CONFIRMATION
} = require('../src/routes/preview-uat-recovery.routes');

const credentials = {
  ADMIN: { email: 'uat-admin@example.test', password: 'admin-secret' },
  MANAGER: { email: 'uat-manager@example.test', password: 'manager-secret' },
  VIEWER: { email: 'uat-viewer@example.test', password: 'viewer-secret' }
};

function payload(execute = false) {
  return { confirmation: RECOVERY_CONFIRMATION, execute, accounts: credentials };
}

function createApp({ environment, verifyDatabaseTarget, provision }) {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/internal/preview-uat-recovery', createPreviewUatRecoveryRouter({
    environment,
    prismaClient: {},
    verifyDatabaseTarget,
    provision
  }));
  app.use((error, req, res, _next) => {
    if (error?.issues) return res.status(400).json({ error: 'Validation failed.', requestId: req.requestId });
    return res.status(500).json({ error: 'Internal server error.', requestId: req.requestId });
  });
  return app;
}

const previewEnvironment = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: RECOVERY_BRANCH };
const verifiedTarget = () => ({ required: true, matched: true });

test('runtime recovery is unavailable outside exact guarded Preview branch', async () => {
  let calls = 0;
  const provision = async () => { calls += 1; return []; };
  const production = createApp({ environment: { VERCEL_ENV: 'production', VERCEL_GIT_COMMIT_REF: RECOVERY_BRANCH }, verifyDatabaseTarget: verifiedTarget, provision });
  const wrongBranch = createApp({ environment: { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'main' }, verifyDatabaseTarget: verifiedTarget, provision });
  assert.equal((await request(production).post('/api/v1/internal/preview-uat-recovery').send(payload())).status, 404);
  assert.equal((await request(wrongBranch).post('/api/v1/internal/preview-uat-recovery').send(payload())).status, 404);
  assert.equal(calls, 0);
});

test('runtime recovery fails closed when Preview database fingerprint guard fails', async () => {
  let calls = 0;
  const app = createApp({
    environment: previewEnvironment,
    verifyDatabaseTarget: () => { throw new Error('guard failed'); },
    provision: async () => { calls += 1; return []; }
  });
  const response = await request(app).post('/api/v1/internal/preview-uat-recovery').send(payload());
  assert.equal(response.status, 503);
  assert.equal(calls, 0);
});

test('dry-run is existing-only, uses fixed UAT identities, and returns no credentials', async () => {
  let received;
  const app = createApp({
    environment: previewEnvironment,
    verifyDatabaseTarget: verifiedTarget,
    provision: async (input) => {
      received = input;
      return input.config.accounts.map((account) => ({ account, existing: { id: account.key }, action: 'UPDATE' }));
    }
  });
  const response = await request(app).post('/api/v1/internal/preview-uat-recovery').send(payload(false));
  assert.equal(response.status, 200);
  assert.equal(received.config.dryRun, true);
  assert.equal(received.config.requireExisting, true);
  assert.deepEqual(received.config.accounts.map(({ key, displayName, role }) => [key, displayName, role]), [
    ['UAT_ADMIN', 'UAT Automation Admin', 'ADMIN'],
    ['UAT_MANAGER', 'UAT Automation Manager', 'MANAGER'],
    ['UAT_VIEWER', 'UAT Automation Viewer', 'VIEWER']
  ]);
  assert.deepEqual(response.body.data.accounts, [
    { key: 'UAT_ADMIN', action: 'UPDATE' },
    { key: 'UAT_MANAGER', action: 'UPDATE' },
    { key: 'UAT_VIEWER', action: 'UPDATE' }
  ]);
  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes('example.test'), false);
  assert.equal(serialized.includes('secret'), false);
  assert.equal(response.headers['cache-control'], 'no-store');
});

test('execute mode preserves existing-only constraint and maps account conflicts to 409', async () => {
  let received;
  const executeApp = createApp({
    environment: previewEnvironment,
    verifyDatabaseTarget: verifiedTarget,
    provision: async (input) => {
      received = input;
      return input.config.accounts.map((account) => ({ account, existing: { id: account.key }, action: 'EXISTS' }));
    }
  });
  const executeResponse = await request(executeApp).post('/api/v1/internal/preview-uat-recovery').send(payload(true));
  assert.equal(executeResponse.status, 200);
  assert.equal(received.config.dryRun, false);
  assert.equal(received.config.requireExisting, true);
  assert.equal(executeResponse.body.data.mode, 'EXECUTE');

  const conflict = new Error('conflict');
  conflict.code = 'UAT_BOOTSTRAP_ACCOUNT_CONFLICT';
  const conflictApp = createApp({
    environment: previewEnvironment,
    verifyDatabaseTarget: verifiedTarget,
    provision: async () => { throw conflict; }
  });
  const conflictResponse = await request(conflictApp).post('/api/v1/internal/preview-uat-recovery').send(payload(true));
  assert.equal(conflictResponse.status, 409);
  assert.equal(conflictResponse.body.code, 'UAT_BOOTSTRAP_ACCOUNT_CONFLICT');
});
