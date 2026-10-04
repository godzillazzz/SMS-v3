'use strict';
// Production history is independently matched in memory. No Preview ledger facts are used.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const INSPECT = require('./verify-attendance-time-policy-production-migration');
const { PREDECESSOR, TARGET } = INSPECT;
const SAFE_NAME = /^\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*$/;
function sha256(bytes) { return crypto.createHash('sha256').update(bytes).digest('hex'); }
function assert(ok, category) { if (!ok) throw new Error(category); }
function git(root, args, bytes = false) { return execFileSync('git', args, { cwd: root, encoding: bytes ? null : 'utf8', stdio: ['ignore','pipe','pipe'] }); }
function hasNewlineInsideSqlQuotedConstruct(sql) {
  let state = 'normal';
  let dollarTag = '';
  for (let i = 0; i < sql.length; i += 1) {
    const current = sql[i];
    const next = sql[i + 1];
    if ((current === '\n' || current === '\r') && ['single', 'double', 'dollar'].includes(state)) return true;
    if (state === 'line-comment') {
      if (current === '\n' || current === '\r') state = 'normal';
      continue;
    }
    if (state === 'block-comment') {
      if (current === '*' && next === '/') { state = 'normal'; i += 1; }
      continue;
    }
    if (state === 'single') {
      if (current === '\\') {
        if (next === '\n' || next === '\r') return true;
        i += 1;
        continue;
      }
      if (current === "'" && next === "'") { i += 1; continue; }
      if (current === "'") state = 'normal';
      continue;
    }
    if (state === 'double') {
      if (current === '"' && next === '"') { i += 1; continue; }
      if (current === '"') state = 'normal';
      continue;
    }
    if (state === 'dollar') {
      if (sql.startsWith(dollarTag, i)) { i += dollarTag.length - 1; state = 'normal'; dollarTag = ''; }
      continue;
    }
    if (current === '-' && next === '-') { state = 'line-comment'; i += 1; continue; }
    if (current === '/' && next === '*') { state = 'block-comment'; i += 1; continue; }
    if (current === "'") { state = 'single'; continue; }
    if (current === '"') { state = 'double'; continue; }
    if (current === '$') {
      const match = sql.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollarTag = match[0]; state = 'dollar'; i += dollarTag.length - 1; }
    }
  }
  return false;
}

function safeCrlfCandidate(bytes) {
  const sql = bytes.toString('utf8');
  if (!Buffer.from(sql, 'utf8').equals(bytes) || sql.includes('\r') || !sql.includes('\n')
      || /\bCOPY\b[\s\S]*\bFROM\s+STDIN\b/i.test(sql)
      || hasNewlineInsideSqlQuotedConstruct(sql)) return null;
  const candidate = Buffer.from(sql.replace(/\n/g, '\r\n'), 'utf8');
  return candidate.equals(bytes) ? null : candidate;
}

function candidateVariants(source, manifest) {
  const variants = [{ ...source, digest: sha256(source.bytes), transform: 'IDENTITY' }];
  if (manifest.candidateTransforms.includes('LF_TO_CRLF_SQL_SAFE')) {
    const crlf = safeCrlfCandidate(source.bytes);
    if (crlf) variants.push({
      ...source,
      bytes: crlf,
      digest: sha256(crlf),
      label: source.label + '_CRLF',
      transform: 'LF_TO_CRLF_SQL_SAFE',
    });
  }
  return variants;
}

function loadSources(root, manifest) {
  assert(manifest.formatVersion === 1 && manifest.canonicalCandidates.length === 18
    && JSON.stringify(manifest.candidateTransforms) === JSON.stringify(['IDENTITY','LF_TO_CRLF_SQL_SAFE']), 'CANDIDATE_MANIFEST_INVALID');
  assert(git(root, ['rev-parse','HEAD']).trim() === manifest.application.sha
    && git(root, ['rev-parse','HEAD^{tree}']).trim() === manifest.application.tree, 'APPLICATION_SOURCE_MISMATCH');
  const schema = fs.readFileSync(path.join(root,'prisma/schema.prisma'));
  assert(sha256(schema) === '4f0c0b129b8b52826ddca8ddb03ddbd678ef25ea96fa22aa1928e406e4112d03', 'SCHEMA_PIN_MISMATCH');
  const pins = new Map([[PREDECESSOR,'0cb317e8c243793321f3b3d5cad7f23b845d595f8373f9b62edab1c31c79c82f'],[TARGET,'5822719590321945832adf87647ca448773f5eff8cb40b7d35ccdd8cf5f443ee']]);
  const canonical = new Map();
  const candidates = new Map();
  for (const source of INSPECT.sourceMigrations(root)) {
    assert(SAFE_NAME.test(source.name), 'SOURCE_NAME_INVALID');
    const relative = 'prisma/migrations/'+source.name+'/migration.sql';
    const bytes = fs.readFileSync(path.join(root,relative));
    assert(bytes.equals(git(root,['show','HEAD:'+relative],true)), 'APPLICATION_MIGRATION_BYTES_MISMATCH');
    if (pins.has(source.name)) assert(sha256(bytes) === pins.get(source.name), 'MIGRATION_SQL_PIN_MISMATCH');
    canonical.set(source.name, { bytes, digest: sha256(bytes), name: source.name });
    // Only completed history can use a newline-equivalent immutable candidate.
    candidates.set(source.name, candidateVariants({ bytes, label: 'KNOWN_SOURCE_MATCH' }, manifest));
  }
  assert(canonical.has(PREDECESSOR) && canonical.has(TARGET), 'SOURCE_ORDER_UNAVAILABLE');
  const seen = new Set();
  for (const item of [...manifest.canonicalCandidates,...manifest.optionalHistoricalMigrations]) {
    assert(SAFE_NAME.test(item.name) && !seen.has(item.name), 'CANDIDATE_NAME_INVALID'); seen.add(item.name);
    const list = candidates.get(item.name) || [];
    for (const pin of item.candidates) {
      assert(/^[a-f0-9]{40}$/.test(pin.commit) && /^[a-f0-9]{40}$/.test(pin.blob), 'GIT_PIN_INVALID');
      const relative = 'prisma/migrations/'+item.name+'/migration.sql';
      assert(git(root,['rev-parse',pin.commit+':'+relative]).trim() === pin.blob, 'GIT_BLOB_PIN_MISMATCH');
      const bytes = git(root,['show',pin.blob],true);
      list.push(...candidateVariants({ bytes, label: 'KNOWN_HISTORICAL_SOURCE_MATCH', commit: pin.commit }, manifest));
    }
    candidates.set(item.name,list);
  }
  // A 001/002 historical rewrite is never approved by this candidate manifest.
  assert(!seen.has(PREDECESSOR) && !seen.has(TARGET), 'TARGET_HISTORY_OVERRIDE_FORBIDDEN');
  return { canonical, candidates };
}

function auditHistory(rows, sources) {
  const groups = new Map();
  for (const row of rows) {
    if (!SAFE_NAME.test(row?.migration_name || '') || !/^[a-f0-9]{64}$/i.test(row?.checksum || '')) {
      return { state: 'HISTORY_DIVERGED_UNKNOWN', entries: [], pending: [], selected: new Map(), malformed: true };
    }
    if (!groups.has(row.migration_name)) groups.set(row.migration_name, []);
    groups.get(row.migration_name).push(row);
  }
  const entries = [], selected = new Map();
  let unknown = 0, mismatch = 0, failed = 0, duplicates = 0, explained = false;
  for (const [name, group] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
    const complete = group.filter((r) => r.finished_at && !r.rolled_back_at);
    const inactive = group.filter((r) => !r.finished_at && r.rolled_back_at);
    const activeFailed = group.filter((r) => (!r.finished_at && !r.rolled_back_at) || (r.finished_at && r.rolled_back_at));
    const digest = group[0].checksum.toLowerCase();
    const sameChecksum = group.every((r) => r.checksum.toLowerCase() === digest);
    const validReapply = group.length > 1 && complete.length === 1 && inactive.length === group.length-1
      && sameChecksum && inactive.every((r) => Number.isFinite(Date.parse(r.rolled_back_at))
        && Date.parse(r.rolled_back_at) <= Date.parse(complete[0].started_at));
    let completion = 'COMPLETED';
    if (activeFailed.length) { completion = 'FAILED_OR_INCOMPLETE'; failed += activeFailed.length; }
    else if (group.length > 1 && validReapply) completion = 'VALID_ROLLBACK_REAPPLY_HISTORY';
    else if (complete.length !== 1 || group.length > 1) { completion = 'DUPLICATE_UNEXPLAINED'; duplicates += 1; }
    const matches = (sources.candidates.get(name) || []).filter((c) => c.digest === digest);
    const distinct = matches.filter((c,i) => matches.findIndex((other) => other.bytes.equals(c.bytes)) === i);
    const canonical = sources.canonical.get(name);
    let sourceClass;
    if (!sources.candidates.has(name)) { sourceClass = 'UNKNOWN_LEDGER_MIGRATION'; unknown += 1; }
    else if (!sameChecksum || distinct.length !== 1) sourceClass = canonical ? 'KNOWN_SOURCE_CHECKSUM_MISMATCH' : 'UNKNOWN_LEDGER_MIGRATION';
    else {
      sourceClass = canonical?.digest === digest ? 'KNOWN_SOURCE_MATCH' : 'KNOWN_HISTORICAL_SOURCE_MATCH';
      if (completion === 'COMPLETED' || completion === 'VALID_ROLLBACK_REAPPLY_HISTORY') selected.set(name, distinct[0]);
      if (sourceClass === 'KNOWN_HISTORICAL_SOURCE_MATCH') explained = true;
    }
    if (canonical && canonical.digest !== digest) mismatch += 1;
    if (sourceClass === 'UNKNOWN_LEDGER_MIGRATION' && sources.candidates.has(name)) unknown += 1;
    entries.push({ name, recordCount: group.length, completion, sourceClass });
  }
  const pending = [...sources.canonical.keys()].filter((name) => !selected.has(name)).sort();
  let state = explained ? 'HISTORY_DIVERGED_BUT_FULLY_EXPLAINED' : 'HISTORY_CLEAN';
  if (entries.some((e) => ['UNKNOWN_LEDGER_MIGRATION','KNOWN_SOURCE_CHECKSUM_MISMATCH'].includes(e.sourceClass))) state = 'HISTORY_DIVERGED_UNKNOWN';
  if (duplicates) state = 'DUPLICATE_HISTORY_UNEXPLAINED';
  if (failed) state = 'FAILED_OR_PARTIAL_HISTORY';
  return { state, entries, pending, selected, unknown, mismatch, failed, duplicates };
}

function ledgerClass(rows, name) {
  const group = rows.filter((r) => r.migration_name === name);
  if (!group.length) return 'ABSENT';
  return group.length === 1 && group[0].finished_at && !group[0].rolled_back_at ? 'APPLIED' : 'UNEXPLAINED';
}
function physicalClass(ledger, shape) {
  if (shape === 'UNKNOWN') return 'UNKNOWN';
  if (shape === 'PARTIAL' || ledger === 'UNEXPLAINED') return 'PARTIAL';
  if (ledger === 'APPLIED') return shape === 'VALID' ? 'LEDGER_APPLIED_SCHEMA_VALID' : 'LEDGER_APPLIED_SCHEMA_MISSING';
  return shape === 'VALID' ? 'LEDGER_ABSENT_SCHEMA_PRESENT' : 'LEDGER_ABSENT_SCHEMA_ABSENT';
}
function planFor(history, predecessor, target) {
  if (!['HISTORY_CLEAN','HISTORY_DIVERGED_BUT_FULLY_EXPLAINED'].includes(history.state)) return 'PLAN_HISTORY_RECOVERY_REQUIRED';
  if ([predecessor,target].includes('PARTIAL')) return 'PLAN_PARTIAL_SCHEMA_RECOVERY_REQUIRED';
  if (history.pending.some((n) => ![PREDECESSOR,TARGET].includes(n))) return 'PLAN_FAIL_CLOSED';
  if (predecessor === 'LEDGER_APPLIED_SCHEMA_VALID' && target === 'LEDGER_APPLIED_SCHEMA_VALID' && !history.pending.length) return 'PLAN_NO_DATABASE_CHANGE';
  if (predecessor === 'LEDGER_ABSENT_SCHEMA_ABSENT' && target === 'LEDGER_ABSENT_SCHEMA_ABSENT'
    && history.pending.join(',') === [PREDECESSOR,TARGET].join(',')) return 'PLAN_APPLY_001_THEN_002';
  if (predecessor === 'LEDGER_APPLIED_SCHEMA_VALID' && target === 'LEDGER_ABSENT_SCHEMA_ABSENT'
    && history.pending.join(',') === TARGET) return 'PLAN_APPLY_002_ONLY';
  return 'PLAN_FAIL_CLOSED';
}

async function readFacts(client, sources, log = console.log) {
  return client.$transaction(async (db) => {
    await db.$executeRawUnsafe('SET TRANSACTION READ ONLY');
    const rows = await db.$queryRawUnsafe('SELECT migration_name, checksum, started_at, finished_at, rolled_back_at, applied_steps_count FROM public._prisma_migrations');
    const history = auditHistory(rows,sources);
    for (const e of history.entries) log('LEDGER_MIGRATION='+e.name+' RECORD_COUNT='+e.recordCount+' COMPLETION='+e.completion+' SOURCE='+e.sourceClass);
    log('PRODUCTION_HISTORY_CLASS='+history.state);
    for (const [key,value] of [['UNKNOWN_LEDGER_COUNT',history.unknown],['CHECKSUM_MISMATCH_COUNT',history.mismatch],['FAILED_MIGRATION_COUNT',history.failed],['UNEXPLAINED_DUPLICATE_COUNT',history.duplicates]]) log(key+'='+ (value ?? 'UNKNOWN'));
    const predLedger = ledgerClass(rows,PREDECESSOR), targetLedger = ledgerClass(rows,TARGET);
    log('PREDECESSOR_LEDGER='+predLedger); log('TARGET_LEDGER='+targetLedger);
    log('OTHER_CANONICAL_PENDING='+ (history.pending.filter((n) => ![PREDECESSOR,TARGET].includes(n)).join(',') || 'NONE'));
    const columns = await INSPECT.columns(db);
    const tables = await db.$queryRawUnsafe("SELECT relname FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r' AND relname IN ('attendance_pending_events','attendance_time_policies')");
    const hasPred = tables.some((t) => t.relname === 'attendance_pending_events') || columns.some((c) => (c.table_name === 'attendance_device_enrollments' && c.column_name === 'observation_only')
      || (c.table_name === 'attendance_events' && ['device_enrollment_id','source_mode','device_captured_at','review_required','review_reasons'].includes(c.column_name)));
    let predShape = hasPred ? 'PARTIAL' : 'ABSENT';
    if (hasPred) {
      try {
        const expectedTypes = {
          attendance_device_enrollments: { observation_only:'bool' },
          attendance_events: { device_enrollment_id:'uuid', source_mode:'varchar', device_captured_at:'timestamp', review_required:'bool', review_reasons:'jsonb' },
          attendance_pending_events: { id:'uuid',employee_id:'uuid',shift_assignment_id:'uuid',capture_id:'uuid',event_type:'AttendanceEventType',source_mode:'varchar',captured_at:'timestamp',received_at:'timestamp',location_evidence:'jsonb',device_snapshot:'jsonb',risk_flags:'jsonb',payload_digest:'bpchar',status:'AttendancePendingEventStatus',reviewed_by_user_id:'uuid',reviewed_at:'timestamp',review_comment:'varchar',attendance_event_id:'uuid',created_at:'timestamp',updated_at:'timestamp' }
        };
        for (const [table,fields] of Object.entries(expectedTypes)) for (const [field,type] of Object.entries(fields)) {
          const c = columns.find((c) => c.table_name === table && c.column_name === field);
          assert(c?.udt_name === type, 'PREDECESSOR_COLUMN_TYPE');
          if (type === 'timestamp') assert(c.atttypmod === 3, 'PREDECESSOR_TIMESTAMP_PRECISION');
          const nullable = table === 'attendance_events' ? ['device_enrollment_id','device_captured_at','review_reasons'].includes(field)
            : table === 'attendance_pending_events' && ['reviewed_by_user_id','reviewed_at','review_comment','attendance_event_id'].includes(field);
          assert(c.attnotnull === !nullable, 'PREDECESSOR_COLUMN_NULLABILITY');
        }
        await require('./verify-g06-simple-attendance-production-migration').verify({ prisma: db, log: () => {} });
        const pk = await db.$queryRawUnsafe("SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='attendance_pending_events_pkey' AND contype='p' AND convalidated");
        assert(pk.length === 1, 'PREDECESSOR_PK_MISSING');
        const indexes = await db.$queryRawUnsafe("SELECT c.relname, i.indisvalid, i.indisready, i.indisunique FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid WHERE c.relnamespace='public'::regnamespace AND (c.relname LIKE 'attendance_pending_events_%' OR c.relname IN ('attendance_events_device_enrollment_id_received_at_idx','attendance_events_review_required_received_at_idx'))");
        const expected = require('./verify-g06-simple-attendance-production-migration').EXPECTED_INDEXES;
        assert(expected.every((n) => indexes.some((i) => i.relname === n && i.indisvalid && i.indisready && (!n.endsWith('_key') || i.indisunique))), 'PREDECESSOR_INDEX_INVALID');
        const serverConstraint = await db.$queryRawUnsafe("SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='attendance_events_server_time_check'");
        assert(serverConstraint.length === 0, 'OBSOLETE_SERVER_TIME_CONSTRAINT');
        const defs = await db.$queryRawUnsafe("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname IN ('attendance_events_source_mode_check','attendance_pending_events_offline_only','attendance_pending_events_capture_before_receive')");
        const sourceMode = defs.find((d) => d.conname === 'attendance_events_source_mode_check')?.definition || '';
        assert(['ONLINE','OFFLINE','device_captured_at','effective_event_at','received_at'].every((value) => sourceMode.includes(value)), 'SOURCE_MODE_CONSTRAINT_SHAPE');
        assert(defs.find((d) => d.conname === 'attendance_pending_events_offline_only')?.definition.includes('OFFLINE'), 'PENDING_OFFLINE_CONSTRAINT_SHAPE');
        assert(['captured_at','received_at'].every((value) => defs.find((d) => d.conname === 'attendance_pending_events_capture_before_receive')?.definition.includes(value)), 'PENDING_CAPTURE_CONSTRAINT_SHAPE');
        predShape = 'VALID';
      } catch { predShape = 'PARTIAL'; }
    }
    let targetShape = INSPECT.policyShape(columns);
    if (targetShape === 'PRESENT') {
      try { await INSPECT.verifyPolicySchema(db); targetShape = 'VALID'; } catch { targetShape = 'PARTIAL'; }
    }
    if (targetShape === 'ABSENT' && tables.some((t) => t.relname === 'attendance_time_policies')) targetShape = 'PARTIAL';
    const legacy = await db.$queryRawUnsafe("SELECT EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typnamespace='public'::regnamespace AND t.typname='AttendanceEventProvenance' AND e.enumlabel='GPS_ONLY_UAT') AS gps, EXISTS(SELECT 1 FROM pg_constraint WHERE connamespace='public'::regnamespace AND conname='attendance_events_verification_provenance_check') AS provenance");
    log('LEGACY_GPS_ONLY_UAT='+ (legacy[0]?.gps ? 'YES' : 'NO'));
    log('LEGACY_PROVENANCE_CONSTRAINT='+ (legacy[0]?.provenance ? 'YES' : 'NO'));
    const face = columns.find((c) => c.table_name === 'attendance_events' && c.column_name === 'face_verification_session_id');
    log('FACE_SESSION_NULLABILITY='+ (face ? face.attnotnull ? 'NOT_NULL' : 'NULLABLE' : 'UNKNOWN'));
    const predecessor = physicalClass(predLedger,predShape), target = physicalClass(targetLedger,targetShape);
    log('PREDECESSOR_PHYSICAL_STATE='+predecessor); log('TARGET_PHYSICAL_STATE='+target);
    const plan = planFor(history,predecessor,target);
    log('PRODUCTION_MIGRATION_PLAN='+plan); log('RAW_BUSINESS_ROWS_READ=NO');
    return { rows, history, predecessor, target, plan };
  }, { timeout: 60000 });
}

function buildBundle(root, sources, facts, tempRoot = os.tmpdir()) {
  assert(['PLAN_NO_DATABASE_CHANGE','PLAN_APPLY_001_THEN_002','PLAN_APPLY_002_ONLY'].includes(facts.plan), 'PLAN_NOT_APPROVED');
  const bundle = fs.mkdtempSync(path.join(tempRoot,'smsv3-production-migrations-'));
  const prismaRoot = path.join(bundle,'prisma'), migrations = path.join(prismaRoot,'migrations');
  fs.mkdirSync(migrations,{ recursive: true });
  fs.copyFileSync(path.join(root,'prisma/schema.prisma'),path.join(prismaRoot,'schema.prisma'));
  for (const [name,item] of sources.canonical) {
    const selected = facts.history.selected.get(name) || item;
    fs.mkdirSync(path.join(migrations,name)); fs.writeFileSync(path.join(migrations,name,'migration.sql'),selected.bytes);
  }
  // Optional UAT sources are added ONLY when independently proven in Production ledger.
  for (const [name,item] of facts.history.selected) if (!sources.canonical.has(name)) {
    assert(SAFE_NAME.test(name),'BUNDLE_NAME_INVALID');
    fs.mkdirSync(path.join(migrations,name)); fs.writeFileSync(path.join(migrations,name,'migration.sql'),item.bytes);
  }
  fs.writeFileSync(path.join(migrations,'migration_lock.toml'),'provider = "postgresql"\n');
  return path.join(prismaRoot,'schema.prisma');
}
function prismaCommand(schema, action, env) {
  return spawnSync(process.platform === 'win32' ? 'npx.cmd' : 'npx',['--no-install','prisma','migrate',action,'--schema',schema],{
    cwd: process.cwd(), env, encoding:'utf8', stdio:['ignore','pipe','pipe'], timeout:180000
  });
}
function statusMatches(result, pending) {
  const text = String(result?.stdout || '')+'\n'+String(result?.stderr || '');
  if (result?.error || /\bP\d{4}\b|failed migration|diverg|mismatch|drift|missing from/i.test(text)) return false;
  if (!pending.length) return result.status === 0 && /database schema is up to date|no pending migrations|all migrations have been applied/i.test(text);
  const names = [...new Set(text.match(/\b\d{12,14}_[A-Za-z0-9][A-Za-z0-9_-]*\b/g) || [])];
  return [0,1].includes(result.status) && /following migration(?:\(s\)|s)? have not yet been applied|pending migration/i.test(text) && names.join(',') === pending.join(',');
}
function fingerprint(rows) {
  return sha256(JSON.stringify([...rows].sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))));
}
async function run(options = {}) {
  const env = options.env || process.env, log = options.log || console.log;
  const root = options.root || process.cwd();
  const guard = options.guard || (async () => {
    const guard = require(path.join(root,'scripts/ci/verify-deployment-target'));
    assert(env.VERCEL_ENV === 'production' && guard.verifyDeploymentTarget({ env, log: () => {}, error: () => {} }) === 0, 'PRODUCTION_TARGET_GUARD_FAILED');
    // Resolve the live canonical again immediately before apply, not just before npm ci.
    assert(env.CURRENT_PRODUCTION_ID && env.CURRENT_PRODUCTION_SHA && env.VERCEL_TOKEN, 'CANONICAL_INPUT_MISSING');
    const cli = spawnSync('npx',['--yes','vercel@56.4.1','inspect',env.EXPECTED_CANONICAL_URL,'--format=json','--token',env.VERCEL_TOKEN],{ env,encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000 });
    assert(cli.status === 0 && !cli.error, 'CANONICAL_READ_FAILED');
    const record = JSON.parse(cli.stdout);
    assert(record.id === env.CURRENT_PRODUCTION_ID && record.target === 'production' && (record.readyState || record.state) === 'READY','CANONICAL_CHANGED');
    await require(path.join(root,'scripts/ci/vercel-api-deployment')).inspectVercelDeployment({
      deploymentId: env.CURRENT_PRODUCTION_ID,teamId:env.VERCEL_ORG_ID,token:env.VERCEL_TOKEN,
      expectedProjectId:env.EXPECTED_PROJECT_ID,expectedCommitSha:env.CURRENT_PRODUCTION_SHA,
      expectedCommitRef:'fix/serverless-database-reliability',expectedTarget:'production',requireReady:true
    });
  });
  // Nothing reads DB before the target guard. Credentials are never logged.
  await guard(); log('PRODUCTION_TARGET_GUARD=PASS');
  const manifest = options.manifest || JSON.parse(fs.readFileSync(env.PRODUCTION_CANDIDATE_MANIFEST,'utf8'));
  assert(manifest.application.sha === env.SOURCE_SHA && manifest.application.tree === env.SOURCE_TREE,'SOURCE_INPUT_MISMATCH');
  const sources = options.sources || loadSources(root,manifest);
  const client = options.client || new (require('@prisma/client').PrismaClient)({ datasources: { db: { url: env.DIRECT_URL } } });
  const observe = options.observe || readFacts;
  let applyAttempted = false, stage = 'READ_ONLY_PREFLIGHT';
  try {
    const facts = await observe(client,sources,log);
    assert(['PLAN_NO_DATABASE_CHANGE','PLAN_APPLY_001_THEN_002','PLAN_APPLY_002_ONLY'].includes(facts.plan),'PREFLIGHT_FAIL_CLOSED');
    const schema = (options.bundle || buildBundle)(root,sources,facts,env.RUNNER_TEMP);
    stage = 'EPHEMERAL_PRISMA_STATUS';
    const status = options.status || ((schema) => prismaCommand(schema,'status',env));
    assert(statusMatches(await status(schema),facts.history.pending),'EPHEMERAL_PRISMA_STATUS_FAIL_CLOSED');
    log('EPHEMERAL_PRISMA_PENDING='+ (facts.history.pending.join(',') || 'NONE'));
    // Read-only state and target re-proved immediately before the single apply; no retry.
    const second = await observe(client,sources,log);
    assert(fingerprint(second.rows) === fingerprint(facts.rows) && second.plan === facts.plan,'PREFLIGHT_CHANGED');
    await guard(); log('PHASE_A_READ_ONLY_PREFLIGHT=PASS');
    if (facts.history.pending.length) {
      stage = 'PINNED_MIGRATION_APPLY';
      applyAttempted = true;
      const result = await (options.apply || ((schema) => prismaCommand(schema,'deploy',env)))(schema);
      assert(result.status === 0 && !result.error,'MIGRATION_APPLY_FAILED_NO_RETRY');
      log('PRODUCTION_MIGRATION_APPLY=PASS');
    } else log('PRODUCTION_MIGRATION_APPLY=SKIPPED_ALREADY_APPLIED');
    stage = 'POST_MIGRATION_READ_ONLY_VERIFICATION';
    const post = await observe(client,sources,log);
    assert(post.plan === 'PLAN_NO_DATABASE_CHANGE' && statusMatches(await status(schema),[]),'POST_MIGRATION_FAIL_CLOSED');
    log('POST_MIGRATION_LEDGER_SCHEMA=PASS');
    log('DATABASE_MUTATION_ATTEMPTED='+ (applyAttempted ? 'YES' : 'NO'));
    return post;
  } catch (error) {
    log('PRODUCTION_RECONCILIATION_FAILURE_STAGE='+stage);
    const sqlCode = String(error?.meta?.code || error?.code || '');
    const category = ['42501','P1010'].includes(sqlCode) ? 'SCHEMA_READ_PERMISSION_DENIED'
      : ['57014','P1002','ETIMEDOUT'].includes(sqlCode) ? 'SCHEMA_QUERY_TIMEOUT'
      : ['42P01','42703','3F000'].includes(sqlCode) ? 'SCHEMA_OBJECT_NOT_FOUND'
      : ['P1001','P1017','ECONNREFUSED','ECONNRESET'].includes(sqlCode) ? 'SCHEMA_CONNECTION_FAILED'
      : 'INVARIANT_OR_QUERY_FAIL_CLOSED';
    log('PRODUCTION_RECONCILIATION_FAILURE_CATEGORY='+category);
    log('DATABASE_MUTATION_ATTEMPTED='+ (applyAttempted ? 'YES_OR_PARTIAL' : 'NO'));
    throw error;
  } finally { if (!options.client) await client.$disconnect(); }
}
if (require.main === module) run().catch(() => { console.error('PRODUCTION_RECONCILIATION=FAIL_CLOSED'); process.exitCode = 1; });
module.exports = { loadSources, auditHistory, ledgerClass, physicalClass, planFor, readFacts, buildBundle, statusMatches, safeCrlfCandidate, candidateVariants, fingerprint, run };
