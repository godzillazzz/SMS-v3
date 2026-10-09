'use strict';
const { roles } = require('./role-matrix');
const PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const TEAM_ID = 'team_nemCExHbZ8EAhSgsvefHPAEz';
const CANONICAL_HOSTS = new Set(['sms-v3-staging-ten.vercel.app', 'sms-v3-staging-godzillazzz.vercel.app']);
function fail(code) { const error = new Error(code); error.code = code; throw error; }
function previewUrl(value, localFixture = false) {
  let url; try { url = new URL(value); } catch { fail('UAT_PREVIEW_URL_INVALID'); }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) fail('UAT_PREVIEW_URL_INVALID');
  if (localFixture && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname)) return url.origin;
  if (url.protocol !== 'https:' || CANONICAL_HOSTS.has(url.hostname) || !/^sms-v3-staging-[a-z0-9]+-godzillazz\.vercel\.app$/.test(url.hostname)) fail('UAT_IMMUTABLE_PREVIEW_REQUIRED');
  return url.origin;
}
function readConfig(env = process.env) {
  const baseURL = previewUrl(env.UAT_BASE_URL, env.UAT_LOCAL_FIXTURE === 'true');
  const accounts = {};
  for (const role of roles) {
    const email = String(env[`UAT_${role}_EMAIL`] || '').trim();
    const password = String(env[`UAT_${role}_PASSWORD`] || '');
    if (!email || !password) fail('UAT_CREDENTIALS_REQUIRED');
    accounts[role] = { email, password };
  }
  if (new Set(roles.map((role) => accounts[role].email.toLowerCase())).size !== roles.length) fail('UAT_ROLE_ACCOUNTS_NOT_DISTINCT');
  return { baseURL, accounts };
}
function validateApprovedTarget(target, expected) {
  if (!target || target.authorized !== true || target.database_isolation_verified !== true) fail('UAT_DISPOSABLE_TARGET_NOT_AUTHORIZED');
  if (!/^https:\/\/github\.com\/godzillazzz\/SMS-v3\/actions\/runs\/\d+$/.test(target.database_isolation_evidence || '')) fail('UAT_DB_ISOLATION_EVIDENCE_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(target.database_target_fingerprint || '')) fail('UAT_DB_ISOLATION_FINGERPRINT_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(expected.source_sha || '') || !/^dpl_[A-Za-z0-9]+$/.test(expected.deployment_id || '')) fail('UAT_TARGET_IDENTITY_INVALID');
  if (target.project_id !== PROJECT_ID || target.team_id !== TEAM_ID || target.target_mode !== 'preview') fail('UAT_TARGET_PROJECT_MISMATCH');
  for (const key of ['source_sha', 'source_branch', 'deployment_id', 'url']) if (target[key] !== expected[key]) fail('UAT_APPROVED_TARGET_MISMATCH');
  if (!/^https:\/\/github\.com\/godzillazzz\/SMS-v3\/actions\/runs\/\d+$/.test(target.production_database_identity_evidence || '')) fail('UAT_PRODUCTION_DATABASE_IDENTITY_EVIDENCE_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(target.production_database_target_fingerprint || '') || target.production_database_target_fingerprint === target.database_target_fingerprint) fail('UAT_DATABASE_NOT_DISTINCT_FROM_PRODUCTION');
  for (const path of ['src/app.js', 'src/config/prisma.js', 'src/services/runtime-database-target-guard.service.js', 'src/utils/database-target-identity.js', 'frontend/src/main.tsx', 'frontend/src/theme.ts']) {
    if (!/^[a-f0-9]{64}$/.test(target.runtime_guard_file_sha256?.[path] || '')) fail('UAT_RUNTIME_GUARD_SOURCE_REQUIRED');
  }
  previewUrl(expected.url);
  return true;
}
module.exports = { roles, PROJECT_ID, TEAM_ID, fail, previewUrl, readConfig, validateApprovedTarget };
