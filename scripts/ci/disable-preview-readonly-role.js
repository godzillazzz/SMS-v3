'use strict';

const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { EXPECTED_ROLE } = require('./preview-readonly-role-privileges');
const { parsePsqlEnvironment, quoteIdentifier } = require('./provision-preview-readonly-role');

function disablePreviewReadonlyRole(args = {}) {
  const env = args.env || process.env;
  const log = args.log || console.log;
  const spawn = args.spawn || spawnSync;
  try {
    if (String(env.VERCEL_ENV || '').toLowerCase() !== 'preview') {
      throw Object.assign(new Error(), { safeCategory: 'PREVIEW_ENVIRONMENT_REQUIRED' });
    }
    const releaseControlRoot = args.releaseControlRoot || env.RELEASE_CONTROL_ROOT || __dirname;
    if (args.targetGuard) args.targetGuard(env, log);
    else {
      const guard = require(path.join(releaseControlRoot, 'scripts', 'ci', 'verify-preview-migration-target.js'));
      guard.verifyPreviewMigrationTarget({ env, log });
    }
    if (!env.DIRECT_URL || !env.DATABASE_URL) {
      throw Object.assign(new Error(), { safeCategory: 'PREVIEW_TARGET_CONFIGURATION_INVALID' });
    }
    const psqlEnv = parsePsqlEnvironment(env.DIRECT_URL, env);
    const result = spawn('psql', ['--no-psqlrc', '--quiet', '--set=ON_ERROR_STOP=1', '--dbname', psqlEnv.PGDATABASE], {
      env: psqlEnv,
      input: `ALTER ROLE ${quoteIdentifier(EXPECTED_ROLE)} NOLOGIN;\n`,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    });
    if (result.error || result.status !== 0) {
      throw Object.assign(new Error(), { safeCategory: 'ROLE_LOGIN_DISABLE_FAILED' });
    }
    log('PREVIEW_READONLY_ROLE_LOGIN_DISABLED=PASS');
    log('RAW_CONNECTION_VALUES_EMITTED=false');
    return { passed: true };
  } catch (error) {
    const category = error?.safeCategory || 'ROLE_LOGIN_DISABLE_FAILED';
    log('PREVIEW_READONLY_ROLE_LOGIN_DISABLED=FAIL');
    log(`PREVIEW_READONLY_ROLE_CLEANUP_CATEGORY=${category}`);
    log('RAW_CONNECTION_VALUES_EMITTED=false');
    return { passed: false, category };
  }
}

if (require.main === module) {
  process.exitCode = disablePreviewReadonlyRole().passed ? 0 : 1;
}

module.exports = { disablePreviewReadonlyRole };
