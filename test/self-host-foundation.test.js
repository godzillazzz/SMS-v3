const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { parseTrustedProxy } = require('../src/config/env');
const {
  EVIDENCE_INTEGRITY_CONFLICT,
  PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED,
  assertChecksumCompatible,
  createEvidenceStorageProvider,
  createUnconfiguredEvidenceStorageProvider
} = require('../src/services/evidence-storage.provider');

const root = path.resolve(__dirname, '..');

test('trusted proxy configuration is explicit and rejects unbounded trust', () => {
  assert.equal(parseTrustedProxy('false'), false);
  assert.equal(parseTrustedProxy('loopback'), 'loopback');
  assert.deepEqual(parseTrustedProxy('10.42.0.0/24,loopback'), ['10.42.0.0/24', 'loopback']);
  assert.throws(() => parseTrustedProxy('*'), /explicit proxy/i);
  assert.throws(() => parseTrustedProxy('true'), /explicit proxy/i);
  assert.throws(() => parseTrustedProxy('0.0.0.0/0'), /invalid|unbounded/i);
  assert.throws(() => parseTrustedProxy('::/0'), /invalid|unbounded/i);
  assert.throws(() => parseTrustedProxy('not-a-proxy'), /invalid/i);
});

test('evidence provider contract is complete and checksum conflicts fail closed', async () => {
  const calls = [];
  const provider = createEvidenceStorageProvider(Object.fromEntries([
    ['putIfAbsent', async (...args) => calls.push(['putIfAbsent', args])],
    ['verify', async (...args) => calls.push(['verify', args])],
    ['createReadHandle', async (...args) => calls.push(['createReadHandle', args])],
    ['remove', async (...args) => calls.push(['remove', args])],
    ['healthCheck', async (...args) => calls.push(['healthCheck', args])]
  ]));
  await provider.putIfAbsent('capture-1', { checksum: 'same' });
  assert.equal(calls.length, 1);
  assert.deepEqual(assertChecksumCompatible('same', 'same'), { idempotent: true });
  assert.throws(() => assertChecksumCompatible('same', 'different'), { code: EVIDENCE_INTEGRITY_CONFLICT });
});

test('unconfigured private evidence provider fails without pretending readiness', async () => {
  const provider = createUnconfiguredEvidenceStorageProvider();
  await assert.rejects(() => provider.healthCheck(), { code: PRIVATE_STORAGE_PROVIDER_NOT_CONFIGURED });
});

test('self-host artifacts enforce immutable runtime and persistent boundaries', () => {
  const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
  const compose = fs.readFileSync(path.join(root, 'deploy/self-host/docker-compose.reference.yml'), 'utf8');
  const proxy = fs.readFileSync(path.join(root, 'deploy/self-host/nginx.conf'), 'utf8');
  assert.match(dockerfile, /node:22/);
  assert.match(dockerfile, /USER sms/);
  assert.doesNotMatch(dockerfile, /COPY\s+\.env/);
  assert.match(compose, /sms_postgres_data:/);
  assert.match(compose, /profiles:\s*\["migration"\]/);
  assert.doesNotMatch(compose, /down\s+-v/);
  assert.match(proxy, /proxy_pass\s+http:\/\/api:3000/);
  assert.match(proxy, /try_files\s+\$uri\s+\$uri\/\s+\/index\.html/);
});
