'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { auditHistory, physicalClass, planFor, buildBundle, statusMatches, candidateVariants, safeCrlfCandidate, run } = require('../scripts/ci/reconcile-production-attendance-migrations');
const { PREDECESSOR, TARGET } = require('../scripts/ci/verify-attendance-time-policy-production-migration');
const OLD = '202607160000_initial_schema';
const UAT = '202609280001_g06_gps_only_uat_event_provenance';
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const bytes = Buffer.from('SELECT 1;\n');
function sources() {
  const canonical = new Map([OLD,PREDECESSOR,TARGET].map((name) => [name,{ name, bytes, digest:hash(bytes) }]));
  const candidates = new Map([...canonical].map(([name,item]) => [name,candidateVariants(item,{ candidateTransforms:['IDENTITY','LF_TO_CRLF_SQL_SAFE'] })]));
  candidates.set(UAT,[{ bytes, digest:hash(bytes) }]);
  return { canonical,candidates };
}
function row(name, extra = {}) {
  return { migration_name:name, checksum:hash(bytes), started_at:'2026-01-02T00:00:00Z', finished_at:'2026-01-02T00:01:00Z', rolled_back_at:null, ...extra };
}
test('current history clean; expected pending order is source authoritative', () => {
  const result = auditHistory([row(OLD)],sources());
  assert.equal(result.state,'HISTORY_CLEAN');
  assert.deepEqual(result.pending,[PREDECESSOR,TARGET]);
  assert.equal(result.entries[0].sourceClass,'KNOWN_SOURCE_MATCH');
});
test('historical byte-exact newline variant is independently explained', () => {
  const result = auditHistory([row(OLD,{ checksum:hash(Buffer.from('SELECT 1;\r\n')) })],sources());
  assert.equal(result.state,'HISTORY_DIVERGED_BUT_FULLY_EXPLAINED');
  assert.equal(result.entries[0].sourceClass,'KNOWN_HISTORICAL_SOURCE_MATCH');
  assert.equal(result.mismatch,1);
});
test('identical source candidates deduplicate by bytes rather than introducing false ambiguity', () => {
  const s = sources(); s.candidates.get(OLD).push({...s.candidates.get(OLD)[0]});
  assert.equal(auditHistory([row(OLD)],s).state,'HISTORY_CLEAN');
});
test('Production historical UAT presence is independent, absence is acceptable', () => {
  assert.equal(auditHistory([row(OLD)],sources()).state,'HISTORY_CLEAN');
  const result = auditHistory([row(OLD),row(UAT)],sources());
  assert.equal(result.state,'HISTORY_DIVERGED_BUT_FULLY_EXPLAINED');
  assert(result.selected.has(UAT));
});
test('unknown migration fails and inventory still includes every safe migration identity', () => {
  const result = auditHistory([row(OLD),row('202601010001_unknown')],sources());
  assert.equal(result.state,'HISTORY_DIVERGED_UNKNOWN'); assert.equal(result.unknown,1);
  assert.equal(result.entries.length,2);
});
test('unmatched checksum emits classification only, never checksum', () => {
  const checksum = 'a'.repeat(64);
  const result = auditHistory([row(OLD,{checksum})],sources());
  assert.equal(result.state,'HISTORY_DIVERGED_UNKNOWN');
  assert.equal(result.entries[0].sourceClass,'KNOWN_SOURCE_CHECKSUM_MISMATCH');
  assert(!JSON.stringify(result).includes(checksum));
});
test('valid duplicate rollback followed by successful reapply requires identical checksum and ordered timestamps', () => {
  const rolled = row(OLD,{ started_at:'2026-01-01T00:00:00Z', finished_at:null, rolled_back_at:'2026-01-01T00:01:00Z' });
  const result = auditHistory([rolled,row(OLD)],sources());
  assert.equal(result.entries[0].completion,'VALID_ROLLBACK_REAPPLY_HISTORY');
  assert.equal(result.state,'HISTORY_CLEAN');
  for (const bad of [{checksum:'b'.repeat(64)},{rolled_back_at:'2026-01-03T00:00:00Z'}]) {
    assert.equal(auditHistory([{...rolled,...bad},row(OLD)],sources()).state,'DUPLICATE_HISTORY_UNEXPLAINED');
  }
});
test('two completed duplicates, rollback-only and active failed rows do not pass', () => {
  assert.equal(auditHistory([row(OLD),row(OLD)],sources()).state,'DUPLICATE_HISTORY_UNEXPLAINED');
  assert.equal(auditHistory([row(OLD,{finished_at:null,rolled_back_at:'2026-01-01'})],sources()).state,'DUPLICATE_HISTORY_UNEXPLAINED');
  assert.equal(auditHistory([row(OLD,{finished_at:null})],sources()).state,'FAILED_OR_PARTIAL_HISTORY');
});
test('malformed ledger names cannot inject sensitive output', () => {
  const result = auditHistory([row('postgresql://secret@private/db')],sources());
  assert.equal(result.state,'HISTORY_DIVERGED_UNKNOWN');
  assert(!JSON.stringify(result).includes('secret'));
});
test('all ledger and physical state combinations fail closed unless independently safe', () => {
  assert.equal(physicalClass('APPLIED','VALID'),'LEDGER_APPLIED_SCHEMA_VALID');
  assert.equal(physicalClass('ABSENT','ABSENT'),'LEDGER_ABSENT_SCHEMA_ABSENT');
  assert.equal(physicalClass('APPLIED','ABSENT'),'LEDGER_APPLIED_SCHEMA_MISSING');
  assert.equal(physicalClass('ABSENT','VALID'),'LEDGER_ABSENT_SCHEMA_PRESENT');
  assert.equal(physicalClass('ABSENT','PARTIAL'),'PARTIAL');
  assert.equal(physicalClass('APPLIED','UNKNOWN'),'UNKNOWN');
});
test('plan resolves zero changes, 001 then 002, or 002 only without assuming Preview state', () => {
  const absent = 'LEDGER_ABSENT_SCHEMA_ABSENT', valid = 'LEDGER_APPLIED_SCHEMA_VALID';
  assert.equal(planFor(auditHistory([row(OLD)],sources()),absent,absent),'PLAN_APPLY_001_THEN_002');
  assert.equal(planFor(auditHistory([row(OLD),row(PREDECESSOR)],sources()),valid,absent),'PLAN_APPLY_002_ONLY');
  assert.equal(planFor(auditHistory([row(OLD),row(PREDECESSOR),row(TARGET)],sources()),valid,valid),'PLAN_NO_DATABASE_CHANGE');
  assert.equal(planFor({state:'HISTORY_DIVERGED_UNKNOWN'},absent,absent),'PLAN_HISTORY_RECOVERY_REQUIRED');
  assert.equal(planFor({state:'HISTORY_CLEAN',pending:[TARGET]},'PARTIAL',absent),'PLAN_PARTIAL_SCHEMA_RECOVERY_REQUIRED');
  assert.equal(planFor({state:'HISTORY_CLEAN',pending:[OLD,TARGET]},valid,absent),'PLAN_FAIL_CLOSED');
  assert.equal(planFor({state:'HISTORY_CLEAN',pending:[TARGET]},'LEDGER_ABSENT_SCHEMA_PRESENT',absent),'PLAN_FAIL_CLOSED');
});
test('Prisma status must report precisely the proven pending set; HTML, errors and extras are not success', () => {
  assert(statusMatches({status:1,stdout:'Following migrations have not yet been applied:\n'+PREDECESSOR+'\n'+TARGET},[PREDECESSOR,TARGET]));
  assert(statusMatches({status:1,stdout:'Following migrations have not yet been applied:\n'+TARGET},[TARGET]));
  assert(statusMatches({status:0,stdout:'Database schema is up to date!'},[]));
  for (const stdout of ['<html>200</html>','P3009 failed migration','Following migrations have not yet been applied:\n'+OLD+'\n'+TARGET,'Database schema is up to date!\nHistory mismatch']) {
    assert(!statusMatches({status:1,stdout},[TARGET]));
  }
});
test('newline conversion cannot modify string, dollar quoted, identifier, or COPY data', () => {
  for (const sql of ["SELECT 'a\nb';\n",'DO $$\nBEGIN\nEND $$;\n','SELECT "a\nb";\n','COPY example FROM STDIN;\n']) assert.equal(safeCrlfCandidate(Buffer.from(sql)),null);
  assert(safeCrlfCandidate(Buffer.from('-- harmless\nSELECT 1;\n')));
});
test('ephemeral bundle does not include absent optional UAT history or edit canonical files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'sms-production-bundle-test-'));
  fs.mkdirSync(path.join(root,'prisma'),{recursive:true}); fs.writeFileSync(path.join(root,'prisma/schema.prisma'),'fixture');
  const s = sources(), facts = {history:auditHistory([row(OLD)],s),plan:'PLAN_APPLY_001_THEN_002'};
  const schema = buildBundle(root,s,facts,root);
  assert(!fs.existsSync(path.join(path.dirname(schema),'migrations',UAT)));
  assert.equal(fs.readFileSync(path.join(root,'prisma/schema.prisma'),'utf8'),'fixture');
  facts.history = auditHistory([row(OLD),row(UAT)],s);
  const withUat = buildBundle(root,s,facts,root);
  assert(fs.existsSync(path.join(path.dirname(withUat),'migrations',UAT,'migration.sql')));
  // Fixture retained in operating-system temporary storage; no broad cleanup.
});
test('target guard refusal happens before any DB observation or mutation', async () => {
  let observed = false, applied = false;
  await assert.rejects(run({guard:()=>{throw new Error('guard');},observe:()=>{observed=true;},apply:()=>{applied=true;}}));
  assert.equal(observed,false); assert.equal(applied,false);
});
function executionFixture() {
  const s = sources(), firstRows = [row(OLD)], postRows = [row(OLD),row(PREDECESSOR),row(TARGET)];
  const absent = 'LEDGER_ABSENT_SCHEMA_ABSENT', valid = 'LEDGER_APPLIED_SCHEMA_VALID';
  const before = {rows:firstRows,history:auditHistory(firstRows,s),predecessor:absent,target:absent,plan:'PLAN_APPLY_001_THEN_002'};
  const after = {rows:postRows,history:auditHistory(postRows,s),predecessor:valid,target:valid,plan:'PLAN_NO_DATABASE_CHANGE'};
  let observation = 0, applies = 0, guards = 0, statuses = 0;
  const output = [];
  const options = {
    env:{SOURCE_SHA:'pin',SOURCE_TREE:'tree'}, manifest:{application:{sha:'pin',tree:'tree'}},sources:s,client:{},
    guard:async()=>{guards+=1;}, log:(line)=>output.push(line),
    observe:async()=> (++observation <= 2 ? before : after),
    bundle:()=>'/runner/temp/prisma/schema.prisma',
    status:()=> (++statuses === 1 ? {status:1,stdout:'Following migrations have not yet been applied:\n'+PREDECESSOR+'\n'+TARGET} : {status:0,stdout:'Database schema is up to date'}),
    apply:()=>{applies+=1;return {status:0};}
  };
  return {options,before,after,output,counts:()=>({observation,applies,guards})};
}
test('approved execution proves read-only phase twice, deploys once, and verifies post state', async()=>{
  const f = executionFixture();
  assert.equal((await run(f.options)).plan,'PLAN_NO_DATABASE_CHANGE');
  assert.deepEqual(f.counts(),{observation:3,applies:1,guards:2});
  assert(f.output.includes('PHASE_A_READ_ONLY_PREFLIGHT=PASS'));
  assert(f.output.includes('POST_MIGRATION_LEDGER_SCHEMA=PASS'));
});
test('unknown history or partial schema stops before any deploy', async()=>{
  for (const plan of ['PLAN_HISTORY_RECOVERY_REQUIRED','PLAN_PARTIAL_SCHEMA_RECOVERY_REQUIRED','PLAN_FAIL_CLOSED']) {
    const f = executionFixture(); f.before.plan = plan;
    await assert.rejects(run(f.options)); assert.equal(f.counts().applies,0);
    assert(f.output.includes('DATABASE_MUTATION_ATTEMPTED=NO'));
  }
});
test('Prisma mismatch or preflight ledger change stops before deploy', async()=>{
  const f = executionFixture(); f.options.status=()=>({status:1,stdout:'History diverged'});
  await assert.rejects(run(f.options)); assert.equal(f.counts().applies,0);
  const changed = executionFixture(); let reads=0;
  changed.options.observe=()=> ++reads===1 ? changed.before : {...changed.before,rows:[...changed.before.rows,row(TARGET)]};
  await assert.rejects(run(changed.options)); assert.equal(changed.counts().applies,0);
});
test('apply failure is reported without raw error and never retried', async()=>{
  const f=executionFixture(); let applies=0;
  f.options.apply=()=>{applies+=1;return {status:1,stderr:'postgresql://password@host/database raw secret migration logs'};};
  await assert.rejects(run(f.options)); assert.equal(applies,1);
  assert(f.output.includes('DATABASE_MUTATION_ATTEMPTED=YES_OR_PARTIAL'));
  assert(!f.output.join('\n').includes('password'));
});
test('already applied and valid execution skips deploy but still proves post invariants', async()=>{
  const f=executionFixture(); f.options.observe=()=>f.after;
  f.options.status=()=>({status:0,stdout:'Database schema is up to date'});
  await run(f.options); assert.equal(f.counts().applies,0);
  assert(f.output.includes('PRODUCTION_MIGRATION_APPLY=SKIPPED_ALREADY_APPLIED'));
});
test('source candidate map is immutable Git-only and does not import Preview evidence', () => {
  const manifest = JSON.parse(fs.readFileSync('scripts/ci/g06-production-migration-candidates.json'));
  assert.equal(manifest.application.sha,'500aaa53d60d6835cccec16c79ca25de00ab06c6');
  assert.equal(manifest.canonicalCandidates.length,18);
  assert(!JSON.stringify(manifest).includes('evidenceRun'));
  assert(!JSON.stringify(manifest).includes('checksum'));
  for (const item of [...manifest.canonicalCandidates,...manifest.optionalHistoricalMigrations]) for (const pin of item.candidates) {
    assert.match(pin.commit,/^[a-f0-9]{40}$/); assert.match(pin.blob,/^[a-f0-9]{40}$/);
  }
});
test('one protected execution retains source, canonical, target, read-only Phase A and post-health gates', () => {
  const workflow = fs.readFileSync('.github/workflows/apply-approved-attendance-time-policy-production-migration.yml','utf8');
  assert(workflow.includes('name: production-sms-v3-staging'));
  assert(workflow.includes('CANONICAL_NATIVE_PROJECT_SHA_REF=PASS'));
  assert(workflow.includes('node /tmp/reconcile-production-attendance-migrations.js'));
  assert(workflow.indexOf('Verify Production database target guard') < workflow.indexOf('Inspect exact Production ledger'));
  assert(!/migrate resolve|db push|prisma-migration.js deploy/.test(workflow));
  assert(workflow.includes('Verify canonical application remains healthy'));
});
