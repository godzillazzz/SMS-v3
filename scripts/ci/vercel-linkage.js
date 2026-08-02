'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const VERCEL_CLI_VERSION = '56.4.1';
const EXPECTED_PROJECT_ID = 'prj_XwhNUOB2zLSPZ6UgQcfyOKBYJ75s';
const EXPECTED_ORG_ID = 'team_nemCExHbZ8EAhSgsvefHPAEz';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redactVercelOutput(text, secretValues = []) {
  let output = String(text || '');
  const values = [...secretValues]
    .filter((value) => typeof value === 'string' && value.length > 0)
    .sort((left, right) => right.length - left.length);

  for (const value of values) output = output.replace(new RegExp(escapeRegExp(value), 'g'), '[redacted]');

  return output
    .replace(/(?:https?|postgres(?:ql)?):\/\/[^\s'"<>]+/gi, '[redacted-url]')
    .replace(/\b(?:authorization|proxy-authorization|bearer)\s*[:=]\s*[^\s]+/gi, '[redacted-header]')
    .replace(/\b(?:token|password|passwd|secret|api[_ -]?key|jwt)\s*[:=]\s*[^\s]+/gi, '[redacted-secret]')
    .replace(/\b(?:DATABASE_URL|DIRECT_URL|VERCEL_TOKEN|GITHUB_TOKEN)\s*=\s*[^\s]+/gi, '[redacted-environment]')
    .replace(/\?[^\s]+/g, '[redacted-query]')
    .replace(/\b[A-Z]:\\[^\r\n\s]+/g, '[redacted-path]')
    .replace(/[A-Z]:\/[^\r\n\s]+/g, '[redacted-path]')
    .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[redacted-email]')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^\s*[A-Z][A-Z0-9_]+\s*=/.test(line))
    .slice(0, 8)
    .join('\n');
}

function classifyVercelFailure(text, exitCode) {
  if (Number(exitCode) === 0) return 'NONE';
  const normalized = String(text || '').toLowerCase();
  if (/unknown option|unknown command|invalid option|unexpected argument|too many arguments/.test(normalized)) return 'CLI_ARGUMENT_ERROR';
  if (/invalid token|token .*invalid|token .*expired|authentication failed|unauthorized|\b401\b/.test(normalized)) return 'INVALID_OR_EXPIRED_TOKEN';
  if (/project .*not found|project does not exist|no such project/.test(normalized)) return 'PROJECT_NOT_FOUND';
  if (/team .*not found|team .*mismatch|org(?:anization)? .*mismatch|scope .*mismatch|invalid scope/.test(normalized)) return 'ORG_SCOPE_MISMATCH';
  if (/forbidden|not authorized|permission denied|access denied|\b403\b/.test(normalized)) return 'TOKEN_SCOPE_OR_PROJECT_ACCESS';
  if (/project .*mismatch|linkage/.test(normalized)) return 'PROJECT_LINKAGE_MISMATCH';
  if (/timeout|timed out|econnreset|enotfound|network|fetch failed|\b5\d\d\b/.test(normalized)) return 'NETWORK_ERROR';
  return 'UNKNOWN_VERCEL_LINKAGE_ERROR';
}

function extractHttpStatus(text) {
  const match = String(text || '').match(/\b([1-5]\d\d)\b/);
  return match ? match[1] : 'unknown';
}

function runVercelDiagnostic(command, args, env, { cwd = process.cwd(), runner = spawnSync, requireToken = true } = {}) {
  if (requireToken && !env.VERCEL_TOKEN) {
    return {
      status: 1,
      category: 'INVALID_OR_EXPIRED_TOKEN',
      httpStatus: 'unknown',
      sanitizedOutput: 'missing Vercel token'
    };
  }

  const result = runner(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const status = typeof result.status === 'number' ? result.status : 1;
  const output = [result.stdout, result.stderr].filter(Boolean).join('\n');
  const secretValues = [env.VERCEL_TOKEN, env.DATABASE_URL, env.DIRECT_URL, env.GITHUB_TOKEN];
  return {
    status,
    category: classifyVercelFailure(output, status),
    httpStatus: extractHttpStatus(output),
    sanitizedOutput: redactVercelOutput(output, secretValues)
  };
}

function writeTemporaryProjectLinkage(directory, projectId = EXPECTED_PROJECT_ID, orgId = EXPECTED_ORG_ID) {
  if (projectId !== EXPECTED_PROJECT_ID || orgId !== EXPECTED_ORG_ID) throw new Error('unexpected Vercel target');
  const vercelDirectory = path.join(directory, '.vercel');
  fs.mkdirSync(vercelDirectory, { recursive: true });
  const projectPath = path.join(vercelDirectory, 'project.json');
  fs.writeFileSync(projectPath, `${JSON.stringify({ projectId, orgId }, null, 2)}\n`, 'utf8');
  return projectPath;
}

function packageCommand() {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function runDiagnostic(env = process.env) {
  const npx = packageCommand();
  const baseArgs = ['--yes', `vercel@${VERCEL_CLI_VERSION}`];
  const run = (label, args, options = {}) => {
    const result = runVercelDiagnostic(npx, [...baseArgs, ...args, ...(env.VERCEL_TOKEN ? ['--token', env.VERCEL_TOKEN] : [])], env, options);
    console.log(`${label}_EXIT_CODE=${result.status}`);
    console.log(`${label}_CATEGORY=${result.category}`);
    console.log(`${label}_HTTP_STATUS=${result.httpStatus}`);
    if (result.sanitizedOutput) console.log(`${label}_MESSAGE=${result.sanitizedOutput.split('\n')[0]}`);
    return result;
  };

  const version = run('VERCEL_VERSION', ['--version'], { requireToken: false });
  const whoami = run('WHOAMI', ['whoami']);
  const teams = run('TEAM_ACCESS', ['teams', 'list', '--scope', EXPECTED_ORG_ID]);
  const project = run('PROJECT_ACCESS', ['project', 'inspect', EXPECTED_PROJECT_ID, '--scope', EXPECTED_ORG_ID]);
  const projectIdMatch = env.VERCEL_PROJECT_ID === EXPECTED_PROJECT_ID;
  const orgIdMatch = env.VERCEL_ORG_ID === EXPECTED_ORG_ID;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-linkage-'));

  let pull;
  let linkedPull;
  try {
    pull = run('PULL_EXACT', ['pull', '--yes', '--environment=production', '--project', EXPECTED_PROJECT_ID, '--scope', EXPECTED_ORG_ID], { cwd: temporaryDirectory });
    writeTemporaryProjectLinkage(temporaryDirectory);
    linkedPull = run('PULL_LINKED', ['pull', '--yes', '--environment=production', '--scope', EXPECTED_ORG_ID], { cwd: temporaryDirectory });
  } finally {
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }

  const tokenValid = whoami.status === 0 ? 'true' : whoami.category === 'INVALID_OR_EXPIRED_TOKEN' ? 'false' : 'unknown';
  const teamAccess = teams.status === 0 ? 'true' : tokenValid === 'true' ? 'false' : 'unknown';
  const projectAccess = project.status === 0 ? 'true' : tokenValid === 'true' ? 'false' : 'unknown';
  const category = pull.status === 0 ? 'NONE' : linkedPull.status === 0 && projectAccess === 'true' ? 'PROJECT_LINKAGE_MISMATCH' : pull.category;

  console.log(`TOKEN_VALID=${tokenValid}`);
  console.log(`TEAM_ACCESS=${teamAccess}`);
  console.log(`PROJECT_ACCESS=${projectAccess}`);
  console.log(`PROJECT_ID_MATCH=${projectIdMatch}`);
  console.log(`ORG_ID_MATCH=${orgIdMatch}`);
  console.log(`ERROR_CATEGORY=${category}`);
  console.log(`HTTP_STATUS=${pull.httpStatus}`);
  console.log(`EXIT_CODE=${pull.status}`);
  console.log(`DIAGNOSTIC_ONLY=true`);
  console.log('BUILD=false');
  console.log('DEPLOY=false');
  return version.status === 0 ? 0 : 1;
}

if (require.main === module) {
  if (process.argv.includes('--diagnostic')) process.exitCode = runDiagnostic();
}

module.exports = {
  EXPECTED_PROJECT_ID,
  EXPECTED_ORG_ID,
  VERCEL_CLI_VERSION,
  classifyVercelFailure,
  redactVercelOutput,
  runVercelDiagnostic,
  writeTemporaryProjectLinkage
};
