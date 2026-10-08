// Default-branch, owner-only Production dispatch authorization checks.
// Pure functions for offline regression testing. This script NEVER deploys.
'use strict';

const fs = require('node:fs');
const SHA = /^[0-9a-f]{40}$/;
const BATCH = /^R[1-9][0-9]*-[A-Z][A-Z0-9]*$/;
const COMMAND = /^\/sms-v3-dispatch (R[1-9][0-9]*-[A-Z][A-Z0-9]*) ([0-9a-f]{40}) ([0-9a-f]{40})$/;
const REPO = 'godzillazzz/SMS-v3';
const OWNER = 'godzillazzz';
const ISSUE = 548;
const SOURCE_BRANCH = 'fix/serverless-database-reliability';
const PROJECT = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const ENVIRONMENT = 'production-sms-v3-staging';

function requireTrue(ok, message) {
  if (!ok) throw new Error(message);
}

function parseCommand(message) {
  const match = typeof message === 'string' && message.match(COMMAND);
  requireTrue(Boolean(match), 'Invalid exact production dispatch command');
  return { batch: match[1], control: match[2], application: match[3] };
}

function verifyEvent(event, repository = REPO) {
  requireTrue(repository === REPO, 'Unexpected repository');
  requireTrue(event?.action === 'created', 'Unexpected event action');
  requireTrue(event?.issue?.number === ISSUE && !event.issue.pull_request, 'Not the dedicated release issue');
  requireTrue(event?.issue?.state === 'open', 'Release issue must be open');
  requireTrue(event?.comment?.user?.login === OWNER, 'Only repository Owner may issue this command');
  requireTrue(event?.sender?.login === OWNER, 'Untrusted event sender');
  requireTrue(event?.comment?.author_association === 'OWNER', 'Commenter is not repository Owner');
  return parseCommand(event.comment.body);
}

function verifyManifest(manifest, command, branchControl) {
  requireTrue(command && BATCH.test(command.batch) && SHA.test(command.control) && SHA.test(command.application), 'Invalid dispatch parameters');
  requireTrue(branchControl === command.control, 'Integration HEAD moved; refuse stale Control SHA');
  requireTrue(manifest && typeof manifest === 'object' && !Array.isArray(manifest), 'Missing release manifest');
  requireTrue(manifest.release_batch_id === command.batch, 'Release batch mismatch');
  requireTrue(manifest.commit_sha === command.application, 'Frozen Application SHA mismatch');
  requireTrue(SHA.test(manifest.tree_sha || ''), 'Invalid frozen application tree');
  requireTrue(SHA.test(manifest.current_production_source_sha || ''), 'Invalid previous application SHA');
  requireTrue(/^dpl_[A-Za-z0-9]+$/.test(manifest.rollback_deployment_id || ''), 'Missing rollback deployment');
  requireTrue(manifest.source_branch === SOURCE_BRANCH, 'Unexpected integration branch');
  requireTrue(manifest.target_project_id === PROJECT, 'Unexpected Vercel project');
  requireTrue(manifest.target_environment === 'production', 'Unexpected Vercel environment');
  requireTrue(manifest.manifest_state === 'APPROVED_FOR_OWNER_PRODUCTION_DECISION', 'Manifest not decision-ready');
  requireTrue(manifest.owner_action === 'APPROVE_PRODUCTION_ONLY', 'Unexpected Owner gate');
  requireTrue(manifest.run_migrations === false, 'Production workflow must not execute migrations');
  requireTrue(manifest.db_schema_mutation === 'NONE' || manifest.database_change_policy === 'PRE_APPLIED_APPROVED_MIGRATION', 'Unapproved schema scope');
  requireTrue(['NO_DATABASE_CHANGES', 'PRE_APPLIED_APPROVED_MIGRATION'].includes(manifest.database_change_policy), 'Unsupported database change policy');
  requireTrue(manifest.canonical_url === 'https://sms-v3-staging-ten.vercel.app', 'Unexpected Production canonical');
  return { batch: command.batch, control: command.control, application: command.application };
}

function hasExactSuccessfulCi(response, sha) {
  return Array.isArray(response?.workflow_runs) && response.workflow_runs.some(run =>
    run.name === 'CI' && run.head_sha === sha && run.status === 'completed' && run.conclusion === 'success');
}
function assertCi(applicationRuns, controlRuns, command) {
  requireTrue(hasExactSuccessfulCi(applicationRuns, command.application), 'Frozen Application exact-SHA CI missing');
  requireTrue(hasExactSuccessfulCi(controlRuns, command.control), 'Control exact-SHA CI missing');
}

function inspectDispatchPage(response, sha) {
  requireTrue(SHA.test(sha), 'Invalid Control SHA');
  requireTrue(Array.isArray(response?.workflow_runs), 'Unable to enumerate existing Production runs');
  requireTrue(Number.isInteger(response.total_count) && response.total_count >= 0, 'Invalid Production run count');
  const duplicate = response.workflow_runs.some(run =>
    run.event === 'workflow_dispatch' && run.head_sha === sha);
  requireTrue(!duplicate, 'A Production dispatch already exists for this Control SHA');
  return response.workflow_runs.length;
}

function main(args, environment) {
  const read = path => JSON.parse(fs.readFileSync(path, 'utf8'));
  if (args[0] === 'event') {
    const command = verifyEvent(read(args[1]), environment.GITHUB_REPOSITORY);
    process.stdout.write('batch=' + command.batch + '\ncontrol=' + command.control + '\napplication=' + command.application + '\n');
  } else if (args[0] === 'manifest') {
    const command = {batch: environment.BATCH, control: environment.CONTROL_SHA, application: environment.APPLICATION_SHA};
    verifyManifest(read(args[1]), command, environment.ACTUAL_SHA);
    process.stdout.write('RELEASE_DISPATCH_MANIFEST=PASS\n');
  } else if (args[0] === 'ci') {
    const command = {control: environment.CONTROL_SHA, application: environment.APPLICATION_SHA};
    assertCi(read(args[1]), read(args[2]), command);
    process.stdout.write('RELEASE_DISPATCH_EXACT_SHA_CI=PASS\n');
  } else if (args[0] === 'duplicate') {
    const count = inspectDispatchPage(read(args[1]), environment.CONTROL_SHA);
    process.stdout.write('PRODUCTION_RUN_PAGE_ENTRIES=' + count + '\n');
  } else {
    throw new Error('Unknown release dispatch guard mode');
  }
}

if (require.main === module) {
  try { main(process.argv.slice(2), process.env); }
  catch (error) { process.stderr.write('RELEASE_DISPATCH_GUARD=FAIL ' + error.message + '\n'); process.exitCode = 1; }
}
module.exports = {parseCommand, verifyEvent, verifyManifest, hasExactSuccessfulCi, assertCi, inspectDispatchPage};
