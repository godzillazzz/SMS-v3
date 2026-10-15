'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const sqlPath = path.join(root, 'scripts/sql/t39-preview-data-api-hardening.sql');
const sql = fs.readFileSync(sqlPath, 'utf8').replaceAll('\r\n', '\n');

test('T39 hardening is Preview-pinned and cannot be mistaken for a Prisma Production migration', () => {
  assert.match(sql, /T39 Preview-only Data API \/ RLS hardening/);
  assert.match(sql, /pg_control_system\(\)/);
  assert.match(sql, /a96200459370c855ff978934689acb140b1c8573e623696cd854c76afa72fc76/);
  assert.doesNotMatch(sql, /jkexwnlxnxbemwavsebv/);
  assert.ok(!sqlPath.includes(path.join('prisma', 'migrations')));
});

test('T39 enables RLS and removes Data API role access without revoking service_role', () => {
  assert.match(sql, /ALTER TABLE %I\.%I ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated/);
  assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated/);
  assert.match(sql, /REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated, PUBLIC/);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public/);
  assert.doesNotMatch(sql, /FROM\s+service_role/i);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/i);
});

test('T39 SQL fails closed on postcondition drift', () => {
  for (const marker of [
    'T39_POSTCONDITION_RLS_FAILED',
    'T39_POSTCONDITION_RELATION_GRANTS_FAILED',
    'T39_POSTCONDITION_FUNCTION_GRANTS_FAILED',
    'T39_POSTCONDITION_DEFAULT_GRANTS_FAILED',
  ]) {
    assert.match(sql, new RegExp(marker));
  }
});
