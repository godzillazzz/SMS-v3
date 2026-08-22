process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { MAX_FILE_SIZE, validateUpload, safeName, createSupabaseLicenseDocumentStorage } = require('../src/services/license-document-storage.service');
const { createFakeLicenseDocumentStorage } = require('./support/fake-license-document-storage');

const pdf = Buffer.from('%PDF-1.7\nfixture');
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const file = (buffer, mimetype, originalname = 'license.pdf') => ({ buffer, mimetype, originalname, size: buffer.length });

test('validates PDF, JPEG, and PNG magic bytes and checksums', () => {
  for (const [buffer, mime] of [[pdf, 'application/pdf'], [jpeg, 'image/jpeg'], [png, 'image/png']]) {
    const result = validateUpload(file(buffer, mime));
    assert.equal(result.mimeType, mime);
    assert.match(result.checksum, /^[a-f0-9]{64}$/);
  }
});

test('accepts the 4 MB boundary and rejects oversized, mismatched, HTML, SVG, and executable uploads', () => {
  assert.equal(MAX_FILE_SIZE, 4 * 1024 * 1024);
  assert.throws(() => validateUpload(), { statusCode: 400 });
  assert.doesNotThrow(() => validateUpload({ ...file(pdf, 'application/pdf'), size: MAX_FILE_SIZE }));
  assert.throws(() => validateUpload({ ...file(pdf, 'application/pdf'), size: MAX_FILE_SIZE + 1 }), { statusCode: 400 });
  for (const candidate of [file(pdf, 'image/png'), file(Buffer.from('<html>'), 'text/html'), file(Buffer.from('<svg>'), 'image/svg+xml'), file(Buffer.from('MZ'), 'application/octet-stream')]) {
    assert.throws(() => validateUpload(candidate), { statusCode: 415 });
  }
});

test('sanitizes display names without using them as object keys', () => {
  assert.equal(safeName('../unsafe<script>.pdf'), '.._unsafe_script_.pdf');
  assert.equal(safeName('  guard   license.pdf  '), 'guard license.pdf');
});

test('fake storage supports metadata, signed URLs, call history, failures, and reset without network', async () => {
  const storage = createFakeLicenseDocumentStorage();
  await storage.put('licenses/e1/random', file(pdf, 'application/pdf'));
  assert.equal(storage.objectExists('licenses/e1/random'), true);
  assert.equal(storage.inspect('licenses/e1/random').mimeType, 'application/pdf');
  assert.equal(await storage.createSignedUrl('licenses/e1/random', 600), 'https://fake-storage.invalid/licenses/e1/random?expires=600');
  assert.equal(storage.calls.createSignedUrl[0].expiresIn, 600);
  await storage.remove('licenses/e1/random');
  assert.equal(storage.objectExists('licenses/e1/random'), false);
  storage.failNextPut();
  await assert.rejects(() => storage.put('x', file(pdf, 'application/pdf')), /fake put failure/);
  storage.reset();
  assert.equal(storage.calls.put.length, 0);
});

test('production adapter uses private object endpoints and sanitizes provider failures', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ signedURL: '/object/sign/private/path' }) }; };
  const storage = createSupabaseLicenseDocumentStorage({ environment: { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'not-a-real-secret', LICENSE_DOCUMENTS_BUCKET: 'private-license-documents' }, fetchImpl });
  await storage.put('licenses/e1/random', file(pdf, 'application/pdf'));
  await storage.createSignedUrl('licenses/e1/random', 600);
  await storage.remove('licenses/e1/random');
  assert.equal(requests.length, 3);
  assert.match(requests[0].url, /\/storage\/v1\/object\/private-license-documents\/licenses\/e1\/random$/);
  assert.equal(JSON.parse(requests[1].options.body).expiresIn, 600);
  assert.equal(requests[2].options.method, 'DELETE');
  const failing = createSupabaseLicenseDocumentStorage({ environment: { SUPABASE_URL: 'https://storage.example.test', SUPABASE_SERVICE_ROLE_KEY: 'hidden', LICENSE_DOCUMENTS_BUCKET: 'private' }, fetchImpl: async () => ({ ok: false }) });
  await assert.rejects(() => failing.put('x', file(pdf, 'application/pdf')), { statusCode: 502, message: 'License document upload failed.' });
});

test('production adapter fails closed when configuration is missing', async () => {
  const storage = createSupabaseLicenseDocumentStorage({ environment: {}, fetchImpl: async () => { throw new Error('network must not run'); } });
  await assert.rejects(() => storage.put('x', file(pdf, 'application/pdf')), { statusCode: 503, message: 'License document storage is not configured.' });
});
