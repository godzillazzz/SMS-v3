process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

function source(file) { return fs.readFileSync(path.join(__dirname, '..', file), 'utf8'); }

test('all four runtime entry points use the explicit contract selector', () => {
  const expected = [
    ['src/services/attendance-simple.service.js', "contract: 'selfie'"],
    ['src/routes/attendance.routes.js', "contract: 'evidence'"],
    ['src/routes/operations.routes.js', "contract: 'license'"],
    ['src/routes/employee-reference-photo.routes.js', "contract: 'reference'"]
  ];
  for (const [file, marker] of expected) {
    const text = source(file);
    assert.match(text, /selectContractStorage/);
    assert.match(text, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Supabase factories remain the explicit default branch of every selector', () => {
  const text = source('src/services/storage-contract-wrappers.js');
  assert.match(text, /provider === 'supabase'/);
  assert.match(text, /return supabaseFactory\(\)/);
  assert.match(text, /storageProvider: 's3'/);
});

test('S3 wrapper preserves service lifecycle surfaces', () => {
  const text = source('src/services/storage-contract-wrappers.js');
  for (const method of ['put', 'remove', 'listObjects', 'reconcileOrphans', 'purgeExpiredSelfies', 'store', 'view', 'purgeExpired', 'getBytes', 'createSignedUrl']) assert.match(text, new RegExp(`async ${method}`));
  assert.match(text, /storageProvider: stored\.provider/);
});
