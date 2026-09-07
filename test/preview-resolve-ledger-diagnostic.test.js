'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyTargetRow,
  summarizeTargetRows,
} = require('../scripts/ci/diagnose-preview-resolve-ledger');

test('classifies failed, applied, and rolled-back ledger rows without collapsing duplicate names', () => {
  assert.equal(classifyTargetRow({ finished_at: null, rolled_back_at: null }), 'FAILED');
  assert.equal(classifyTargetRow({ finished_at: '2026-09-07T03:54:35.000Z', rolled_back_at: null }), 'APPLIED');
  assert.equal(classifyTargetRow({ finished_at: null, rolled_back_at: '2026-09-07T03:54:35.000Z' }), 'ROLLED_BACK');
});

test('counts a valid applied row while preserving the original failed row', () => {
  const summary = summarizeTargetRows([
    {
      id: 'failed-row',
      migration_name: '202608240003_g06_security_site_qr_gps_v1',
      checksum: '2d706f436f0b8585c8e6c682a525744d4f4cda6a2b10ee09cc5100dde22e5636',
      started_at: '2026-09-07T03:00:00.000Z',
      finished_at: null,
      rolled_back_at: null,
      applied_steps_count: 0,
      logs_present: true,
    },
    {
      id: 'applied-row',
      migration_name: '202608240003_g06_security_site_qr_gps_v1',
      checksum: '2d706f436f0b8585c8e6c682a525744d4f4cda6a2b10ee09cc5100dde22e5636',
      started_at: '2026-09-07T03:54:31.000Z',
      finished_at: '2026-09-07T03:54:35.000Z',
      rolled_back_at: null,
      applied_steps_count: 0,
      logs_present: false,
    },
  ]);
  assert.equal(summary.rowCount, 2);
  assert.equal(summary.failed, 1);
  assert.equal(summary.applied, 1);
  assert.equal(summary.validApplied, true);
});
