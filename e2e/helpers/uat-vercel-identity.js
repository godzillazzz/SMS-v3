const fs = require('node:fs');

const GIT_SHA = /^[0-9a-f]{40}$/i;

function identityError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function optionalString(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function pickStrings(source, fields) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return undefined;
  const picked = {};
  for (const field of fields) {
    const value = optionalString(source[field]);
    if (value !== undefined) picked[field] = value;
  }
  return Object.keys(picked).length > 0 ? picked : undefined;
}

function normalizeDeploymentIdentity(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw identityError('UAT_VERCEL_RESPONSE_INVALID');
  }

  const projectId = optionalString(raw.projectId) || optionalString(raw.project?.id);
  const normalized = {};
  const topLevelFields = ['id', 'url', 'name', 'target'];
  for (const field of topLevelFields) {
    const value = optionalString(raw[field]);
    if (value !== undefined) normalized[field] = value;
  }
  if (projectId !== undefined) normalized.projectId = projectId;

  const readyState = optionalString(raw.readyState) || optionalString(raw.state);
  if (readyState !== undefined) normalized.readyState = readyState;

  const meta = pickStrings(raw.meta, [
    'githubCommitSha',
    'gitCommitSha',
    'githubCommitRef',
    'githubCommitOrg',
    'githubCommitRepo'
  ]);
  if (meta) normalized.meta = meta;

  const gitSource = pickStrings(raw.gitSource, ['sha', 'ref']);
  if (gitSource) normalized.gitSource = gitSource;

  const source = pickStrings(raw.source, ['sha']);
  if (source) normalized.source = source;

  return normalized;
}

function parseDeploymentResponse(text) {
  let raw;
  try {
    raw = JSON.parse(String(text));
  } catch {
    throw identityError('UAT_VERCEL_RESPONSE_JSON_INVALID');
  }
  return normalizeDeploymentIdentity(raw);
}

function assertSuccessfulHttpStatus(status) {
  const code = Number(status);
  if (!Number.isInteger(code) || code < 200 || code > 299) {
    throw identityError('UAT_VERCEL_HTTP_STATUS_NOT_OK');
  }
  return code;
}

if (require.main === module) {
  try {
    const [command, inputPath, outputPath] = process.argv.slice(2);
    if (command !== 'sanitize' || !inputPath || !outputPath) {
      throw identityError('UAT_VERCEL_IDENTITY_COMMAND_INVALID');
    }
    const identity = parseDeploymentResponse(fs.readFileSync(inputPath, 'utf8'));
    fs.writeFileSync(outputPath, `${JSON.stringify(identity)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write('UAT_VERCEL_IDENTITY_SANITIZE=PASS\n');
  } catch (error) {
    process.stderr.write(`${error.code || error.message || 'UAT_VERCEL_IDENTITY_FAILED'}\n`);
    process.exitCode = 1;
  }
}

module.exports = {
  GIT_SHA,
  assertSuccessfulHttpStatus,
  identityError,
  normalizeDeploymentIdentity,
  parseDeploymentResponse
};
