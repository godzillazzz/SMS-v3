'use strict';
// Mutation proof: the reviewed attendance pin is load-bearing. Replacing it with the retired
// digest in an isolated scratch clone must make the pin suite fail loudly, with an instruction to
// update ATTENDANCE_SCHEMA_SHA256 and its governed evidence/tests in the same governed commit.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync, execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SCHEMA_PATH = 'prisma/schema.prisma';
const PIN_FILE = 'scripts/ci/attendance-schema-pin.js';
const PIN_TEST = 'test/attendance-schema-pin.test.js';
const RETIRED_SOURCE_SHA = '500aaa53d60d6835cccec16c79ca25de00ab06c6';

// Derived from the retired Git source, never written as a literal in tracked files.
const retiredSchema = execFileSync('git', ['show', `${RETIRED_SOURCE_SHA}:${SCHEMA_PATH}`],
  { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
const retiredDigest = crypto.createHash('sha256').update(retiredSchema).digest('hex');
const { ATTENDANCE_SCHEMA_SHA256 } = require('../scripts/ci/attendance-schema-pin');

// Reporter-agnostic summary parsing: Node prints TAP on non-TTY stdout (CI) and spec otherwise.
function reportedCount(output, label) {
  const match = String(output).match(new RegExp(`^(?:ℹ|#) ${label} (\\d+)$`, 'm'));
  return match ? Number(match[1]) : null;
}

test('replacing the reviewed pin with the retired digest makes the pin suite fail with the governed-update instruction', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sms-pin-mutation-'));
  const scratch = path.join(dir, 'clone');
  execFileSync('git', ['clone', '--quiet', '--shared', ROOT, scratch], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  // Prove the exact control files under test, so the proof holds before and after the commit.
  fs.copyFileSync(path.join(ROOT, PIN_FILE), path.join(scratch, PIN_FILE));
  fs.copyFileSync(path.join(ROOT, PIN_TEST), path.join(scratch, PIN_TEST));

  const helper = fs.readFileSync(path.join(scratch, PIN_FILE), 'utf8');
  assert(helper.includes(ATTENDANCE_SCHEMA_SHA256), 'scratch helper must start from the reviewed pin');
  fs.writeFileSync(path.join(scratch, PIN_FILE), helper.split(ATTENDANCE_SCHEMA_SHA256).join(retiredDigest));
  const mutated = fs.readFileSync(path.join(scratch, PIN_FILE), 'utf8');
  assert(!mutated.includes(ATTENDANCE_SCHEMA_SHA256));
  assert(mutated.includes(retiredDigest));

  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  // Explicit reporter: Node picks TAP for non-TTY stdout (CI runners), which hides the summary.
  const result = spawnSync(process.execPath, ['--test', '--test-reporter=spec', PIN_TEST],
    { cwd: scratch, encoding: 'utf8', timeout: 180000, env });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  assert.notEqual(result.status, 0, `mutated pin must fail the pin suite\n${output}`);
  assert(reportedCount(result.stdout, 'fail') > 0, output);
  assert(reportedCount(result.stdout, 'pass') > 0, output);
  assert(output.includes('ATTENDANCE_SCHEMA_SHA256'), 'failure must name the governed constant');
  assert(output.includes('governed evidence and tests'), 'failure must instruct the governed commit update');
  assert(output.includes('scripts/ci/attendance-schema-pin.js'));
  // The proof itself never writes into the verified repository.
  const dirty = spawnSync('git', ['diff', '--quiet', '--', PIN_FILE, SCHEMA_PATH], { cwd: ROOT });
  assert.equal(dirty.status, 0, 'the verified repository must have no unstaged control-file edit');
});
