'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const MANIFEST_RELATIVE_PATH = 'governance/preview-baseline-reconstruction-20260907.json';
const EXPECTED_BRANCH = 'fix/serverless-database-reliability';
const EXPECTED_BASE_SHA = 'c421e13c82a88f1dc26a5f737712eecce7df8920';
const EXPECTED_BASE_TREE = '695cfb1e44e08e979fdfbd196ec811b84faf30f7';
const EXPECTED_HEAD = '202609010002_mdg_master_codes_department_site_authority';
const CORRECTED_FIRST_PENDING = '202608240004_g06_attendance_event_workflow_v1';

const RECONCILED_PREDECESSOR = Object.freeze({
  migrationName: '202608240003_g06_security_site_qr_gps_v1',
  resolveRun: '34080212561',
  diagnosticRun: '34089859937',
});

const BASELINE_ALLOWLIST = Object.freeze([
  '202608240004_g06_attendance_event_workflow_v1',
  '202608250001_g06_face_match_only_mode_v1',
  '202608250002_g06_department_security_site_default_v1',
  '202608250003_attendance_governance_v1',
  '202608270001_attendance_adjustment_request_v4',
  '202608270002_attendance_effective_correction_authority_v4',
  '202608270003_attendance_face_evidence_v1',
  '202608270004_attendance_face_evidence_rls_v1',
  '202608270005_g06_server_authority_rls_v1',
  '202608270005_g06_server_only_rls_v1',
]);

const FORBIDDEN_RESOLVE_MIGRATIONS = Object.freeze([
  '202608300001_perf05_hot_path_indexes',
  '202608310001_cfg03_leave_type_master',
  '202608310002_cfg04_shift_type_active_state',
  '202608310003_cfg05_auto_schedule_pattern_master',
  '202608310004_cfg06_approval_authority_policy',
  '202608310005_cfg07_data_retention_center',
  '202609010001_emp_ux_department_position_master',
  '202609010002_mdg_master_codes_department_site_authority',
]);

const HEX_40 = /^[0-9a-f]{40}$/i;
const HEX_64 = /^[0-9a-f]{64}$/i;

function repoRoot(cwd = process.cwd()) {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

function readManifest(cwd = process.cwd()) {
  const root = repoRoot(cwd);
  const manifestPath = path.join(root, MANIFEST_RELATIVE_PATH);
  return { root, manifestPath, manifest: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) };
}

function stripSqlComments(sql) {
  return String(sql)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\r\n]*/g, ' ');
}

function hasDataStatements(sql) {
  return /(?:^|;)\s*(?:INSERT|UPDATE|DELETE|COPY)\b/im.test(stripSqlComments(sql));
}

function fileSha256(filePath) {
  const canonical = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n');
  return crypto.createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function gitValue(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
}

function verifyManifestProvenance(manifest) {
  const predecessor = (manifest.reconciled_predecessors || [])
    .find((entry) => entry.resolve_run === RECONCILED_PREDECESSOR.resolveRun);
  if (!predecessor) throw new Error('missing authoritative 240003 resolve provenance');
  if (predecessor.migration_name !== RECONCILED_PREDECESSOR.migrationName) {
    throw new Error('run 34080212561 migration-name attribution mismatch');
  }
  if (predecessor.resolve_command_target !== RECONCILED_PREDECESSOR.migrationName) {
    throw new Error('run 34080212561 command target mismatch');
  }
  if (predecessor.diagnostic_confirmation_run !== RECONCILED_PREDECESSOR.diagnosticRun) {
    throw new Error('240003 diagnostic confirmation run mismatch');
  }
  if (predecessor.ledger_state !== 'APPLIED_NOT_PENDING') {
    throw new Error('240003 reconciled ledger state mismatch');
  }

  const pending = (manifest.candidates || [])
    .find((entry) => entry.migration_name === CORRECTED_FIRST_PENDING);
  if (!pending) throw new Error('240004 candidate missing');
  if (pending.eligible_for_resolve !== true) throw new Error('240004 must remain a conditional resolve candidate');
  if (String(pending.diagnostic_evidence_run || '') !== RECONCILED_PREDECESSOR.diagnosticRun) {
    throw new Error('240004 diagnostic evidence run mismatch');
  }
  for (const [key, value] of Object.entries(pending)) {
    if (/(?:prior_?resolve|resolve_?run|run_?resolve)/i.test(key)
      && String(value || '').includes(RECONCILED_PREDECESSOR.resolveRun)) {
      throw new Error('run 34080212561 cannot be attributed to 240004');
    }
  }

  const ledger = pending.ledger_evidence || {};
  if (ledger.checksum_match_source !== true
    || ledger.finished !== false
    || ledger.rolled_back !== false
    || Number(ledger.applied_steps_count) !== 0
    || ledger.state !== 'FAILED') {
    throw new Error('240004 failed-ledger evidence mismatch');
  }

  const semantic = pending.semantic_evidence || {};
  if (Number(semantic.expected_object_count) !== 52
    || Number(semantic.matching_object_count_before_cast_normalization) !== 50
    || Number(semantic.differing_object_count_before_cast_normalization) !== 2
    || Number(semantic.missing_object_count) !== 0) {
    throw new Error('240004 semantic evidence mismatch');
  }
  const differences = semantic.differences || [];
  if (differences.length !== 2
    || !differences.some((item) => String(item).includes('attendance_sessions_expectation_digest_format'))
    || !differences.some((item) => String(item).includes('attendance_events_context_digest_format'))
    || !differences.every((item) => String(item).includes('::text cast only'))) {
    throw new Error('240004 cast-only difference provenance mismatch');
  }
  return true;
}

function verifyManifestOrdering(manifest) {
  const candidates = new Map((manifest.candidates || []).map((candidate) => [candidate.migration_name, candidate]));
  const blocked = new Map((manifest.blocked_migrations || []).map((candidate) => [candidate.migration_name, candidate]));
  const migrationOrder = manifest.migration_order || [];
  const allNames = new Set([...candidates.keys(), ...blocked.keys()]);
  if (new Set(migrationOrder).size !== migrationOrder.length) throw new Error('manifest migration order contains duplicates');
  if (allNames.size !== migrationOrder.length || migrationOrder.some((name) => !allNames.has(name))) {
    throw new Error('manifest migration order is incomplete');
  }
  const eligibleInRepositoryOrder = migrationOrder.filter((name) => candidates.get(name)?.eligible_for_resolve === true);
  if (JSON.stringify(eligibleInRepositoryOrder) !== JSON.stringify(manifest.baseline_allowlist || [])) {
    throw new Error('ordered allowlist skips or reorders an eligible unresolved migration');
  }
  if ((manifest.baseline_allowlist || [])[0] !== CORRECTED_FIRST_PENDING) {
    throw new Error('240004 must be first in ordered allowlist');
  }
  return true;
}

function verifyManifest({ cwd = process.cwd(), env = process.env, log = console.log } = {}) {
  const { root, manifestPath, manifest } = readManifest(cwd);
  if (Number(manifest.schema_version) !== 2) throw new Error('manifest schema version mismatch');
  if (manifest.target !== 'sms-v3-preview') throw new Error('manifest target must be sms-v3-preview');
  if (manifest.protected_environment !== 'Preview – sms-v3-staging') throw new Error('manifest protected environment mismatch');
  if (manifest.expected_migration_head !== EXPECTED_HEAD) throw new Error('manifest migration head mismatch');
  if (manifest.source_authority?.branch !== EXPECTED_BRANCH) throw new Error('manifest source branch mismatch');
  if (manifest.source_authority?.base_sha !== EXPECTED_BASE_SHA) throw new Error('manifest base SHA mismatch');
  if (manifest.source_authority?.base_tree !== EXPECTED_BASE_TREE) throw new Error('manifest base tree mismatch');

  const suppliedSha = String(env.SOURCE_SHA || '').trim();
  const suppliedTree = String(env.SOURCE_TREE || '').trim();
  const currentSha = gitValue(['rev-parse', 'HEAD'], root);
  const currentTree = gitValue(['rev-parse', 'HEAD^{tree}'], root);
  if (suppliedSha && (!HEX_40.test(suppliedSha) || suppliedSha !== currentSha)) {
    throw new Error('source SHA does not match checkout');
  }
  if (suppliedTree && (!HEX_40.test(suppliedTree) || suppliedTree !== currentTree)) {
    throw new Error('source tree does not match checkout');
  }

  verifyManifestProvenance(manifest);
  verifyManifestOrdering(manifest);

  const candidates = new Map((manifest.candidates || []).map((candidate) => [candidate.migration_name, candidate]));
  const blocked = new Map((manifest.blocked_migrations || []).map((candidate) => [candidate.migration_name, candidate]));
  if (JSON.stringify(manifest.baseline_allowlist) !== JSON.stringify(BASELINE_ALLOWLIST)) {
    throw new Error('manifest allowlist differs from hardcoded allowlist');
  }
  if (BASELINE_ALLOWLIST.some((name) => !candidates.get(name) || candidates.get(name).eligible_for_resolve !== true)) {
    throw new Error('allowlist contains a non-eligible candidate');
  }
  if (BASELINE_ALLOWLIST.some((name) => !manifest.migration_order.includes(name))) {
    throw new Error('allowlist migration order is invalid');
  }
  if (FORBIDDEN_RESOLVE_MIGRATIONS.some((name) => BASELINE_ALLOWLIST.includes(name))) {
    throw new Error('forbidden migration is in allowlist');
  }
  for (const name of FORBIDDEN_RESOLVE_MIGRATIONS) {
    const entry = blocked.get(name);
    if (!entry || entry.eligible_for_resolve !== false) throw new Error(`forbidden migration classification missing: ${name}`);
  }

  for (const [name, entry] of [...candidates, ...blocked]) {
    if (!HEX_64.test(String(entry.sha256 || ''))) throw new Error(`invalid checksum in manifest: ${name}`);
    const sqlPath = path.join(root, 'prisma', 'migrations', name, 'migration.sql');
    if (!fs.existsSync(sqlPath)) throw new Error(`migration file missing: ${name}`);
    const actualChecksum = fileSha256(sqlPath);
    if (actualChecksum !== String(entry.sha256).toLowerCase()) throw new Error(`migration checksum mismatch: ${name}`);
    const actualData = hasDataStatements(fs.readFileSync(sqlPath, 'utf8'));
    if (actualData !== Boolean(entry.has_data_statements)) throw new Error(`data-statement classification mismatch: ${name}`);
    if (BASELINE_ALLOWLIST.includes(name) && actualData) throw new Error(`data-bearing migration in allowlist: ${name}`);
    if (!BASELINE_ALLOWLIST.includes(name) && entry.eligible_for_resolve === true) {
      throw new Error(`unlisted candidate is marked eligible: ${name}`);
    }
  }

  log(`BASELINE_MANIFEST_SHA256=${fileSha256(manifestPath)}`);
  log('BASELINE_MANIFEST_PROVENANCE=PASS');
  log('BASELINE_MIGRATION_ORDER_GUARD=PASS');
  log('BASELINE_MANIFEST_GUARD=PASS');
  log('BASELINE_ALLOWLIST_GUARD=PASS');
  log('DATA_MIGRATION_REJECT_GUARD=PASS');
  log('SOURCE_IDENTITY=PASS');
  log(`BASELINE_ALLOWLIST=${BASELINE_ALLOWLIST.join(',')}`);
  return { manifest, manifestPath, baselineAllowlist: BASELINE_ALLOWLIST, root };
}

function main() {
  try {
    verifyManifest();
    return 0;
  } catch (error) {
    console.error(`Preview baseline manifest guard failed: ${error.message}`);
    return 1;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = {
  BASELINE_ALLOWLIST,
  CORRECTED_FIRST_PENDING,
  EXPECTED_BASE_SHA,
  EXPECTED_BASE_TREE,
  EXPECTED_BRANCH,
  EXPECTED_HEAD,
  FORBIDDEN_RESOLVE_MIGRATIONS,
  MANIFEST_RELATIVE_PATH,
  RECONCILED_PREDECESSOR,
  fileSha256,
  hasDataStatements,
  normalizeManifest: readManifest,
  verifyManifest,
  verifyManifestOrdering,
  verifyManifestProvenance,
};
