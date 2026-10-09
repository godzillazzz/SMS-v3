'use strict';
const crypto = require('node:crypto');
const target = require('../../.github/uat/authenticated-readonly-target.json');
const { fail } = require('../../e2e/uat-v3/config');
const paths = ['src/app.js', 'src/config/prisma.js', 'src/services/runtime-database-target-guard.service.js', 'src/utils/database-target-identity.js'];
async function verifyTrust(fetcher = fetch, env = process.env, approved = target) {
  if (!env.GITHUB_TOKEN || !/^[a-f0-9]{40}$/.test(env.UAT_SOURCE_SHA || '') || !/^[a-f0-9]{40}$/.test(env.UAT_TRUSTED_MAIN_SHA || '')) fail('UAT_TRUST_CONFIGURATION_REQUIRED');
  async function get(path) {
    const response = await fetcher('https://api.github.com/repos/godzillazzz/SMS-v3/' + path, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${env.GITHUB_TOKEN}` }, redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (response.status !== 200) fail('UAT_TRUST_READ_UNVERIFIED');
    return response.json();
  }
  const main = await get('branches/main');
  if (main.protected !== true || main.commit?.sha !== env.UAT_TRUSTED_MAIN_SHA) fail('UAT_TRUSTED_MAIN_PROTECTION_REQUIRED');
  for (const path of paths) {
    const source = await get(`contents/${path}?ref=${env.UAT_SOURCE_SHA}`);
    if (source.type !== 'file' || source.encoding !== 'base64' || source.path !== path || !source.content) fail('UAT_RUNTIME_GUARD_SOURCE_UNVERIFIED');
    const hash = crypto.createHash('sha256').update(Buffer.from(source.content, 'base64')).digest('hex');
    if (hash !== approved.runtime_guard_file_sha256?.[path]) fail('UAT_RUNTIME_GUARD_SOURCE_MISMATCH');
  }
  return { trustedMain: 'PASS', runtimeGuardSource: 'PASS' };
}
if (require.main === module) verifyTrust().then(() => process.stdout.write('UAT_TRUSTED_MAIN_AND_RUNTIME_SOURCE=PASS\n')).catch(() => { process.stderr.write('UAT_TRUSTED_MAIN_OR_RUNTIME_SOURCE_UNVERIFIED\n'); process.exitCode = 1; });
module.exports = { verifyTrust, paths };
