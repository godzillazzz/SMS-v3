process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSupabaseLicenseDocumentStorage } = require('../src/services/license-document-storage.service');

test('license storage injected backend preserves put/remove/sign arguments and errors', async () => {
  const calls = [];
  const backend = {
    put: async (...args) => { calls.push(['put', ...args]); return { provider: 's3', bucket: 'licenses' }; },
    remove: async (...args) => { calls.push(['remove', ...args]); },
    sign: async (...args) => { calls.push(['sign', ...args]); return 'signed://license'; }
  };
  const storage = createSupabaseLicenseDocumentStorage({ objectBackend: backend, environment: {} });
  const file = { buffer: Buffer.from('pdf'), mimetype: 'application/pdf' };
  assert.deepEqual(await storage.put('licenses/e1/a.pdf', file), { provider: 's3', bucket: 'licenses' });
  await storage.remove('licenses/e1/a.pdf');
  assert.equal(await storage.createSignedUrl('licenses/e1/a.pdf', 600), 'signed://license');
  assert.equal(calls[0][0], 'put'); assert.equal(calls[0][1], 'licenses/e1/a.pdf'); assert.equal(calls[2][2], 600);
});

test('license injected backend failure is propagated without Supabase fallback', async () => {
  let calls = 0;
  const storage = createSupabaseLicenseDocumentStorage({ objectBackend: { put: async () => { calls += 1; throw new Error('transport failed'); }, remove: async () => {}, sign: async () => 'x' }, environment: {} });
  await assert.rejects(storage.put('licenses/e1/a.pdf', { buffer: Buffer.from('x'), mimetype: 'application/pdf' }), /transport failed/);
  assert.equal(calls, 1);
});
