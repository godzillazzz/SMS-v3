'use strict';

// Validates a post-release record so it can serve as immutable audit evidence.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const SHA = /^[0-9a-f]{40}$/;
const ROOT = path.resolve(__dirname, '..', '..');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function validateRecord(record, { run = null, now = new Date() } = {}) {
  assert(record && typeof record === 'object', 'record must be an object');
  assert(record.record_type === 'POST_RELEASE_RECORD', 'record_type mismatch');
  assert(record.approved_manifest === '.github/releases/approved-production.json', 'approved_manifest mismatch');
  assert(typeof record.release_id === 'string' && record.release_id.length > 0, 'release_id missing');
  assert(SHA.test(record.release_head_sha || ''), 'release_head_sha must be a full 40-hex SHA');

  const deployed = record.deployed || {};
  assert(SHA.test(deployed.source_sha || ''), 'deployed.source_sha must be a full 40-hex SHA');
  assert(/^dpl_[A-Za-z0-9]+$/.test(deployed.deployment_id || ''), 'deployed.deployment_id invalid');
  assert(Number.isSafeInteger(deployed.deploy_run_id) && deployed.deploy_run_id > 0, 'deploy_run_id invalid');
  assert(deployed.conclusion === 'SUCCESS', 'record may only exist for a successful deploy');

  const verifiedAt = Date.parse(deployed.verified_at);
  assert(Number.isFinite(verifiedAt), 'verified_at must be a timestamp');
  assert(verifiedAt <= now.getTime(), 'verified_at must not be in the future');

  const previous = record.previous_known_good || {};
  assert(SHA.test(previous.source_sha || ''), 'previous_known_good.source_sha must be a full 40-hex SHA');
  assert(/^dpl_[A-Za-z0-9]+$/.test(previous.deployment_id || ''), 'previous_known_good.deployment_id invalid');
  assert(previous.deployment_id !== deployed.deployment_id, 'previous deployment must differ from the deployed one');

  if (run) {
    assert(run.headSha === record.release_head_sha, 'release_head_sha does not match the deploy run head');
    assert(run.conclusion === 'success', 'deploy run did not succeed');
    assert(Date.parse(run.createdAt) <= verifiedAt, 'verified_at precedes the deploy run');
  }

  try {
    assert(git(['rev-parse', `${deployed.source_sha}^{commit}`]).length === 40, 'deployed source missing');
  } catch {
    throw new Error('deployed.source_sha is not a commit in this repository');
  }
  return Object.freeze({
    releaseId: record.release_id,
    deploymentId: deployed.deployment_id,
    sourceSha: deployed.source_sha,
    releaseHeadSha: record.release_head_sha
  });
}

if (require.main === module) {
  const file = process.argv[2];
  assert(file, 'record path is required');
  const record = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  const result = validateRecord(record);
  process.stdout.write(`POST_RELEASE_RECORD=PASS\nrelease_id=${result.releaseId}\ndeployment_id=${result.deploymentId}\n`);
}

module.exports = { validateRecord, SHA };
