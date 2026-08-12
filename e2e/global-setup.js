const fs = require('node:fs');
const path = require('node:path');
const { getUatConfig } = require('./helpers/uat-config');
const { preflightRoleAccounts } = require('./helpers/uat-auth');
const { rolePreflightSummary } = require('./helpers/uat-v3-security');

module.exports = async () => {
  const config = getUatConfig();
  fs.mkdirSync(path.resolve('test-results'), { recursive: true });
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
};
