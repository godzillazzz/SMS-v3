'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createS3ObjectStorage } = require('../../src/services/object-storage-provider');

const enabled = process.env.RUN_REAL_MINIO === 'true';
const bucket = process.env.MINIO_TEST_BUCKET || process.env.MINIO_BUCKET || 'ci-private-integration';
const endpoint = process.env.S3_ENDPOINT || 'http://127.0.0.1:9000';
const credentials = {
  accessKeyId: process.env.S3_ACCESS_KEY_ID || process.env.MINIO_RESTRICTED_ACCESS_KEY || 'ci-integration',
  secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || process.env.MINIO_RESTRICTED_SECRET_KEY || 'ci-integration-secret'
};
const client = new S3Client({ endpoint, region: 'us-east-1', forcePathStyle: true, credentials });
const key = `synthetic/${crypto.randomUUID()}.bin`;
const payload = Buffer.from('synthetic MinIO integration payload\n', 'utf8');
const sha256 = crypto.createHash('sha256').update(payload).digest('hex');

function compose(...args) {
  execFileSync('docker', ['compose', '-f', 'deploy/minio/docker-compose.yml', ...args], {
    cwd: process.cwd(), stdio: 'inherit', env: process.env
  });
}

async function readBody(body) {
  return Buffer.from(await body.transformToByteArray());
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      execFileSync('curl', ['--fail', '--silent', `${endpoint}/minio/health/ready`]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error('MinIO did not become ready');
}

test('real MinIO private storage survives restart and recovers after outage', { skip: !enabled, timeout: 120000 }, async () => {
  await client.send(new HeadBucketCommand({ Bucket: bucket }));
  const storage = createS3ObjectStorage({ environment: {
    STORAGE_PROVIDER: 's3', S3_ENDPOINT: endpoint, S3_REGION: 'us-east-1',
    S3_ACCESS_KEY_ID: credentials.accessKeyId, S3_SECRET_ACCESS_KEY: credentials.secretAccessKey,
    S3_ALLOWED_BUCKETS: bucket
  } });
  assert.deepEqual(await storage.put(bucket, key, { buffer: payload, mimetype: 'application/octet-stream' }), { provider: 's3', bucket, objectKey: key, sha256 });

  const first = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.deepEqual(await readBody(first.Body), payload);
  assert.equal(first.Metadata?.sha256, sha256);
  assert.equal(first.ContentType, 'application/octet-stream');
  console.log(JSON.stringify({ evidence: 'initial-checksum', bucket, key, sha256 }));

  const unauthorized = new S3Client({
    endpoint, region: 'us-east-1', forcePathStyle: true,
    credentials: { accessKeyId: 'ci-wrong', secretAccessKey: 'ci-wrong-secret' }
  });
  await assert.rejects(
    unauthorized.send(new GetObjectCommand({ Bucket: bucket, Key: key })),
    (error) => ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(error.name)
  );
  console.log(JSON.stringify({ evidence: 'access-denied', bucket, key }));

  const signed = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: 60 });
  const signedResponse = await fetch(signed);
  assert.equal(signedResponse.status, 200);
  assert.deepEqual(Buffer.from(await signedResponse.arrayBuffer()), payload);
  const privateResponse = await fetch(`${endpoint}/${bucket}/${key}`);
  assert.notEqual(privateResponse.status, 200);

  compose('restart', 'minio');
  await waitForHealth();
  const afterRestart = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.equal(crypto.createHash('sha256').update(await readBody(afterRestart.Body)).digest('hex'), sha256);
  console.log(JSON.stringify({ evidence: 'restart-persistence', bucket, key, sha256 }));

  compose('stop', 'minio');
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
  console.log(JSON.stringify({ evidence: 'outage-detected', bucket, key }));
  compose('start', 'minio');
  await waitForHealth();
  const afterRecovery = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  assert.deepEqual(await readBody(afterRecovery.Body), payload);
  console.log(JSON.stringify({ evidence: 'error-recovery', bucket, key, sha256 }));

  await assert.rejects(
    unauthorized.send(new DeleteObjectCommand({ Bucket: bucket, Key: key })),
    (error) => ['AccessDenied', 'InvalidAccessKeyId', 'SignatureDoesNotMatch'].includes(error.name)
  );
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  await assert.rejects(client.send(new GetObjectCommand({ Bucket: bucket, Key: key })));
});
