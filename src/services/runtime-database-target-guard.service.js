'use strict';

const { parseAndNormalize } = require('../utils/database-target-identity');

const HEX_64 = /^[0-9a-f]{64}$/i;
const PREVIEW_DATABASE_TARGET_GUARD_ERROR = 'PREVIEW_DATABASE_TARGET_GUARD_FAILED';

function guardError() {
  const error = new Error('Preview database target guard failed.');
  error.name = 'PreviewDatabaseTargetGuardError';
  error.code = PREVIEW_DATABASE_TARGET_GUARD_ERROR;
  return error;
}

function verifyPreviewDatabaseTarget(env = process.env) {
  if (env.VERCEL_ENV !== 'preview') {
    return { required: false, matched: null };
  }

  const approved = String(env.APPROVED_PREVIEW_DATABASE_TARGET_FINGERPRINT || '').trim().toLowerCase();
  if (!HEX_64.test(approved)) throw guardError();

  let fingerprint;
  try {
    ({ fingerprint } = parseAndNormalize(env));
  } catch {
    throw guardError();
  }

  if (fingerprint.toLowerCase() !== approved) throw guardError();
  return { required: true, matched: true };
}

module.exports = {
  PREVIEW_DATABASE_TARGET_GUARD_ERROR,
  verifyPreviewDatabaseTarget,
};
