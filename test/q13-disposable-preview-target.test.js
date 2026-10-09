'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTarget, targetFingerprint } = require('../scripts/ci/verify-deployment-target');
const { verifyQ13DisposablePreviewTarget } = require('../scripts/ci/verify-q13-disposable-preview-target');

function dbPair(project) {
  return {
    DATABASE_URL: `postgresql://postgres.${project}@aws-0-us-east-1.pooler.supabase.com:6543/postgres`,
    DIRECT_URL: `postgresql://postgres@db.${project}.supabase.co:5432/postgres`,
  };
}
function fp(pair) {
  return targetFingerprint(parseTarget('DATABASE_URL', pair.DATABASE_URL),
    parseTarget('DIRECT_URL', pair.DIRECT_URL));
}
function valid() {
  const disposable = dbPair('q13disposable');
  const shared = dbPair('sharedpreview');
  const production = dbPair('productiontarget');
  return {
    ...disposable,
    UAT_TARGET_MODE: 'preview',
    UAT_SCOPE: 'q13b-specialist-write-targeted',
    UAT_DISPOSABLE_PREVIEW_DB_APPROVED: 'YES',
    UAT_BASE_URL: 'https://sms-v3-q13-disposable-isolated-godzillazz.vercel.app',
    UAT_EXPECTED_DEPLOYMENT_ID: 'dpl_Q13IsolatedCheck01',
    Q13_DISPOSABLE_PROJECT_ID: 'prj_Q13IsolatedCheck01',
    Q13_APPROVED_DISPOSABLE_TARGET_FINGERPRINT: fp(disposable),
    Q13_APPROVED_SHARED_PREVIEW_TARGET_FINGERPRINT: fp(shared),
    Q13_APPROVED_PRODUCTION_TARGET_FINGERPRINT: fp(production),
  };
}

test('Q13 disposable fingerprint guard accepts three distinct logical database identities only as preliminary proof', () => {
  const out = verifyQ13DisposablePreviewTarget(valid());
  assert.equal(out.previewTargetGuard, 'PASS');
  assert.equal(out.deployedRuntimeTargetIdentity, 'NOT_VERIFIED');
  assert.equal(out.credentialsEmitted, false);
  assert.equal(verifyQ13DisposablePreviewTarget({ ...valid(), UAT_SCOPE: 'q13c-business-workflow-targeted' }).distinctFromProduction, true);
});

const invalid = [
  ['missing explicit attestation', e => { delete e.UAT_DISPOSABLE_PREVIEW_DB_APPROVED; }],
  ['missing disposable db URL', e => { delete e.DATABASE_URL; }],
  ['wrong disposable fingerprint', e => { e.Q13_APPROVED_DISPOSABLE_TARGET_FINGERPRINT = 'a'.repeat(64); }],
  ['same shared fingerprint', e => { e.Q13_APPROVED_SHARED_PREVIEW_TARGET_FINGERPRINT = e.Q13_APPROVED_DISPOSABLE_TARGET_FINGERPRINT; }],
  ['same production fingerprint', e => { e.Q13_APPROVED_PRODUCTION_TARGET_FINGERPRINT = e.Q13_APPROVED_DISPOSABLE_TARGET_FINGERPRINT; }],
  ['wrong pooled and direct logical target pair', e => { e.DIRECT_URL = dbPair('otherdb').DIRECT_URL; }],
  ['same shared R5-B deployment', e => { e.UAT_EXPECTED_DEPLOYMENT_ID = 'dpl_6SxGPuH374ogrr2mjzwDkincaMCA'; }],
  ['same shared Vercel project', e => { e.Q13_DISPOSABLE_PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s'; }],
  ['same shared R5-B URL', e => { e.UAT_BASE_URL = 'https://sms-v3-staging-ntizvmjdo-godzillazz.vercel.app'; }],
  ['untrusted arbitrary preview URL', e => { e.UAT_BASE_URL = 'https://other-preview.vercel.app'; }],
  ['Production UAT', e => { e.UAT_TARGET_MODE = 'production'; }],
  ['full scope could mutate without targeted authorization', e => { e.UAT_SCOPE = 'full'; }],
];
for (const [name, change] of invalid) {
  test(`Q13 guard denies ${name} without emitting raw connection details`, () => {
    const e = valid();
    change(e);
    assert.throws(() => verifyQ13DisposablePreviewTarget(e),
      {message: 'Q13_DISPOSABLE_PREVIEW_TARGET_NOT_PROVEN'});
  });
}
