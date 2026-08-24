'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const json = (file) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

function onlyStatement(policy) {
  assert.equal(policy.Version, '2012-10-17');
  assert.equal(policy.Statement.length, 1);
  return policy.Statement[0];
}

test('Preview backend IAM policy is least-privilege for server-side Rekognition verification', () => {
  const statement = onlyStatement(json('infra/aws/g06-face-verification-preview-backend-policy.json'));
  assert.equal(statement.Effect, 'Allow');
  assert.equal(statement.Resource, '*');
  assert.deepEqual([...statement.Action].sort(), [
    'rekognition:CompareFaces',
    'rekognition:CreateFaceLivenessSession',
    'rekognition:GetFaceLivenessSessionResults'
  ]);
  assert.deepEqual(statement.Condition, { StringEquals: { 'aws:RequestedRegion': 'ap-southeast-7' } });
  assert.equal(statement.Action.some((action) => /Collection|IndexFaces|SearchFaces|DeleteFaces|S3|KMS|IAM|STS/i.test(action)), false);
});

test('Preview browser temporary credential policy permits only StartFaceLivenessSession in Thailand region', () => {
  const statement = onlyStatement(json('infra/aws/g06-face-liveness-preview-client-policy.json'));
  assert.equal(statement.Effect, 'Allow');
  assert.equal(statement.Resource, '*');
  assert.deepEqual(statement.Action, ['rekognition:StartFaceLivenessSession']);
  assert.deepEqual(statement.Condition, { StringEquals: { 'aws:RequestedRegion': 'ap-southeast-7' } });
});

test('source and frontend never define browser long-lived AWS access-key environment variables', () => {
  const sourceFiles = [
    'src/config/env.js',
    'src/routes/face-verification.routes.js',
    'src/services/aws-rekognition-face-verification.provider.js',
    'frontend/src/api.ts'
  ];
  const combined = sourceFiles.map((file) => fs.readFileSync(path.join(root, file), 'utf8')).join('\n');
  assert.doesNotMatch(combined, /VITE_AWS_ACCESS_KEY|VITE_AWS_SECRET|VITE_AWS_SESSION_TOKEN|AKIA[0-9A-Z]{16}/);
});
