const fs = require('node:fs');
const path = require('node:path');
const { getUatConfig } = require('./helpers/uat-config');
const { preflightRoleAccounts } = require('./helpers/uat-auth');
const { rolePreflightSummary } = require('./helpers/uat-v3-security');
const { clearRoleSessions, writeRoleSessions } = require('./helpers/uat-session');

module.exports = async () => {
  const config = getUatConfig();
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
  if (process.env.UAT_STAGE_DIAGNOSTIC_FILE) {
    fs.writeFileSync(process.env.UAT_STAGE_DIAGNOSTIC_FILE, '', 'utf8');
  }
  clearRoleSessions();
  if (config.mode !== 'authenticated') {
    fs.writeFileSync(path.resolve('test-results/uat-v3-account-preflight.json'), JSON.stringify({ mode: config.mode, roles: { ADMIN: 'SKIPPED', MANAGER: 'SKIPPED', VIEWER: 'SKIPPED' } }));
    return;
  }

  const preflight = await preflightRoleAccounts();
  fs.writeFileSync(path.resolve('test-results/uat-v3-account-preflight.json'), JSON.stringify({ mode: config.mode, roles: rolePreflightSummary(preflight.results) }));
  if (!preflight.allReady) {
    const error = new Error('AUTH_ACCOUNT_UNAVAILABLE');
    error.code = 'AUTH_ACCOUNT_UNAVAILABLE';
    throw error;
  }
  writeRoleSessions(preflight.sessions);
};
