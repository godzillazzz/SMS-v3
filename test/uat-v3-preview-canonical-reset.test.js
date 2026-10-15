'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  reconcile, targetUrlIsPreview, canonicalSpecs, isLegacyUat, PREVIEW_REF, ROLES
} = require('../scripts/admin/uat-v3-preview-canonical-reset');

const url = (ref = PREVIEW_REF) => `postgresql://postgres.${ref}:redacted@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`;
const env = () => Object.fromEntries(ROLES.flatMap((role, index) => [
  [`UAT_${role}_EMAIL`, `uat-v3-${role.toLowerCase()}@preview.invalid`],
  [`UAT_${role}_PASSWORD`, `testing-only-distinct-password-${index}`]
]));

test('rejects every non-Preview URL and missing evidence', () => {
  assert.equal(targetUrlIsPreview(url()), true);
  assert.equal(targetUrlIsPreview(`postgresql://postgres:x@db.${PREVIEW_REF}.supabase.co:5432/postgres`), true);
  assert.equal(targetUrlIsPreview(url('jkexwnlxnxbemwavsebv')), false);
  assert.equal(targetUrlIsPreview('postgresql://postgres:secret@db.example.com/postgres'), false);
  assert.equal(targetUrlIsPreview(''), false);
  assert.equal(targetUrlIsPreview(undefined), false);
});

test('requires four canonical email names and four distinct strong passwords', () => {
  const valid = env();
  const specs = canonicalSpecs(valid);
  assert.deepEqual(specs.map((x) => x.role), ROLES);
  assert.deepEqual(specs.map((x) => x.email), ROLES.map((role) => `uat-v3-${role.toLowerCase()}@preview.invalid`));
  assert.throws(() => canonicalSpecs({ ...valid, UAT_SUPERVISOR_EMAIL: 'noncanonical@preview.invalid' }),
    /UAT_V3_SUPERVISOR_EMAIL_NOT_CANONICAL/);
  assert.throws(() => canonicalSpecs({ ...valid, UAT_MANAGER_PASSWORD: 'short' }),
    /UAT_V3_MANAGER_PASSWORD_MISSING_OR_WEAK/);
  assert.throws(() => canonicalSpecs({ ...valid, UAT_MANAGER_PASSWORD: valid.UAT_ADMIN_PASSWORD }),
    /UAT_V3_PASSWORDS_NOT_DISTINCT/);
});

test('archives only old UAT display-name records and excludes canonical/archive', () => {
  assert.equal(isLegacyUat({ displayName: 'AWV1 UAT Admin' }), true);
  assert.equal(isLegacyUat({ displayName: 'UAT Automation Manager' }), true);
  assert.equal(isLegacyUat({ displayName: '[ARCHIVED UAT] UAT Automation Manager' }), false);
  assert.equal(isLegacyUat({ displayName: 'UAT V3 Admin', legacyUserId: 'UAT-V3-PREVIEW-ADMIN' }), false);
  assert.equal(isLegacyUat({ displayName: 'Real Employee' }), false);
});

test('dry run reads only a verified Preview DB and reports counts without identifiers', async () => {
  const calls = [];
  const prismaClient = {
    $queryRaw: async () => {
      calls.push('read_witness');
      return [{ database_name:'postgres', executing_role:'postgres',
        cluster_fingerprint:'a96200459370c855ff978934689acb140b1c8573e623696cd854c76afa72fc76' }];
    },
    user: { findMany: async () => {
      calls.push('read_users');
      return [
        { displayName:'UAT Automation Admin' },
        { displayName:'UAT V3 Admin', legacyUserId:'UAT-V3-PREVIEW-ADMIN' },
        { displayName:'[ARCHIVED UAT] UAT Manager' }
      ];
    } }
  };
  const r=await reconcile({ env:{DATABASE_URL:url(),DIRECT_URL:url()},prismaClient });
  assert.deepEqual(calls,['read_witness','read_users']);
  assert.deepEqual(r,{mode:'READ_ONLY',previewVerified:true,legacyCandidates:1,canonicalPresent:1});
});

test('dry run rejects wrong cluster fingerprint before account reads', async () => {
  const prismaClient = {
    $queryRaw:async () => [{database_name:'postgres',executing_role:'postgres',
      cluster_fingerprint:'7d71885605b8dc006c0c379b0b8d50d2011647707c4820d0fd33839a37cfa06f'}],
    user:{findMany:async()=>{throw new Error('UNEXPECTED_ACCOUNT_READ');}}
  };
  await assert.rejects(
    reconcile({env:{DATABASE_URL:url(),DIRECT_URL:url()},prismaClient}),
    /UAT_V3_PREVIEW_CLUSTER_MISMATCH/
  );
});

test('apply cannot start without an explicit confirmation, and never runs a mutation', async () => {
  const prismaClient = {$transaction:async()=>{throw new Error('MUTATION_WAS_REACHED');}};
  await assert.rejects(
    reconcile({apply:true,env:{DATABASE_URL:url(),DIRECT_URL:url()},prismaClient}),
    /UAT_V3_OWNER_CONFIRMATION_REQUIRED/
  );
});
