const forbiddenArtifactSegments = new Set([
  '.auth',
  'auth-state',
  'cookies',
  'local-storage',
  'session-storage',
  'storage-state',
  'storagestate'
]);

const textArtifactExtensions = new Set(['.css', '.csv', '.html', '.js', '.json', '.md', '.txt', '.xml']);
const redactedPlaceholder = /^(?:<\s*(?:redacted|masked|secret)\s*>|\[\s*(?:redacted|masked|secret)\s*\]|\*{3,}|redacted|masked|not[-_ ]?set)$/i;

function sensitiveUatValues(environment = process.env) {
  const configuredValues = Array.isArray(environment) ? environment : [
    environment.VERCEL_TRUSTED_OIDC_TOKEN,
    environment.VERCEL_AUTOMATION_BYPASS_SECRET,
    environment.UAT_VERCEL_PROTECTION_BYPASS,
    environment.UAT_ADMIN_EMAIL,
    environment.UAT_ADMIN_PASSWORD,
    environment.UAT_MANAGER_EMAIL,
    environment.UAT_MANAGER_PASSWORD,
    environment.UAT_VIEWER_EMAIL,
    environment.UAT_VIEWER_PASSWORD
  ];
  return configuredValues.filter(Boolean).sort((left, right) => String(right).length - String(left).length);
}

const authMaterialPatterns = [
  ['ACCESS_TOKEN_PATTERN', /["']accessToken["']\s*:\s*["'](?!<|\[|\*{3,})[A-Za-z0-9._~-]{20,}["']/i],
  ['REFRESH_TOKEN_PATTERN', /["']refreshToken["']\s*:\s*["'](?!<|\[|\*{3,})[A-Za-z0-9._~-]{20,}["']/i],
  ['AUTHORIZATION_HEADER', /["']?Authorization["']?\s*:\s*["']?Bearer\s+[A-Za-z0-9._~-]{20,}/i],
  ['COOKIE_PATTERN', /(?:set-cookie|document\.cookie|["']?cookies?["']?)\s*[:=]\s*["'][^"']{20,}["']/i],
  ['AUTH_STATE_FILE', /["']?(?:storageState|sessionStorage|localStorage)["']?\s*[:=]\s*["']?\s*[{[]/i],
  ['PASSWORD_VALUE', /["']?\b(?:password|passwd)\b["']?\s*[:=]\s*["']?(?!<\s*(?:redacted|masked|secret)\s*>|\[\s*(?:redacted|masked|secret)\s*\]|\*{3,}|redacted\b|masked\b)[^"',\s]{8,}/i],
  ['OTHER_AUTH_MATERIAL', /["']?\b(?:DATABASE_URL|DIRECT_URL|SUPABASE_SERVICE_ROLE_KEY)\b["']?\s*[:=]\s*["']?(?!<\s*(?:redacted|masked|secret)\s*>|\[\s*(?:redacted|masked|secret)\s*\]|\*{3,}|redacted\b|masked\b)[^\s"']+/i]
];

function normalizePath(filePath) {
  return String(filePath || '').replace(/\\/g, '/');
}

function isForbiddenArtifactPath(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  const fileName = segments.at(-1) || '';
  return segments.some((segment) => forbiddenArtifactSegments.has(segment))
    || /^(?:auth[-_.]?state|storage[-_.]?state|cookies|session[-_.]?state)(?:[-_.]|$)/i.test(fileName);
}

function textContent(content) {
  if (!Buffer.isBuffer(content)) return String(content || '');
  const sample = content.subarray(0, Math.min(content.length, 8192));
  if (sample.includes(0)) return '';
  const controlBytes = [...sample].filter((byte) => (byte < 9) || (byte > 13 && byte < 32)).length;
  if (sample.length > 0 && controlBytes / sample.length > 0.02) return '';
  return content.toString('utf8');
}

function hasExactSecret(content, secret) {
  if (!secret || redactedPlaceholder.test(String(secret))) return false;
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''));
  return buffer.includes(Buffer.from(String(secret)));
}

function sanitizeUatDiagnostic(value, environment = process.env) {
  let sanitized = String(value ?? '');
  for (const secret of sensitiveUatValues(environment)) sanitized = sanitized.split(String(secret)).join('[REDACTED]');
  return sanitized
    .replace(/["']?authorization["']?\s*[:=]\s*["']?Bearer(?:\s+|-)[^\s,;}"']+/gi, '[REDACTED_AUTHORIZATION]')
    .replace(/["']?authorization["']?\s*[:=]\s*["']?[^"'\s,;}]+["']?/gi, '[REDACTED_AUTHORIZATION]')
    .replace(/\bBearer(?:\s+|-)[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(/(["']?(?:cookie|set-cookie|accessToken|refreshToken|password|passwd|secret|token|otp|api[-_]?key)["']?\s*[:=]\s*)(["']?)([^"'\s,;}]+)\2/gi, '$1$2[REDACTED]$2')
    .replace(/(["']?(?:storageState|sessionStorage|localStorage)["']?\s*[:=]\s*)([\[{])/gi, '$1[REDACTED_STATE]')
    .replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]')
    .replace(/\b(?:eyJ[A-Za-z0-9._~-]{10,}|[A-Za-z0-9_-]{32,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g, '[REDACTED_TOKEN]');
}

function artifactContainsAuthMaterial(content) {
  const value = textContent(content);
  return authMaterialPatterns.some(([, pattern]) => pattern.test(value));
}

function artifactContainsAnySecret(content, secrets = []) {
  return secrets.filter(Boolean).some((secret) => hasExactSecret(content, secret));
}

function artifactContainsSecret(content, secret) {
  return hasExactSecret(content, secret);
}

function isTextArtifactPath(filePath) {
  const normalized = normalizePath(filePath).toLowerCase();
  return textArtifactExtensions.has(normalized.slice(normalized.lastIndexOf('.')));
}

function addFinding(findings, category) {
  if (!findings.includes(category)) findings.push(category);
}

function artifactLeakFindings(filePath, content, {
  bypassSecret = '',
  secretValues = [],
  passwordValues = [],
  emailValues = []
} = {}) {
  const findings = [];
  if (isForbiddenArtifactPath(filePath)) addFinding(findings, 'AUTH_STATE_FILE');
  if (hasExactSecret(content, bypassSecret)) addFinding(findings, 'BYPASS_SECRET');
  if (artifactContainsAnySecret(content, passwordValues)) addFinding(findings, 'PASSWORD_VALUE');
  if (artifactContainsAnySecret(content, emailValues)) addFinding(findings, 'UAT_EMAIL_VALUE');
  if (artifactContainsAnySecret(content, secretValues)) addFinding(findings, 'OTHER_AUTH_MATERIAL');
  if (isTextArtifactPath(filePath)) {
    const value = textContent(content);
    for (const [category, pattern] of authMaterialPatterns) {
      if (pattern.test(value)) addFinding(findings, category);
    }
  }
  return findings;
}

function sanitizeArtifactPath(filePath, sensitiveValues = []) {
  let value = normalizePath(filePath);
  for (const secret of sensitiveValues.filter(Boolean)) value = value.split(String(secret)).join('[REDACTED]');
  return value.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, '[REDACTED_EMAIL]');
}

function scanArtifact(filePath, content, options = {}) {
  const sensitiveValues = [
    options.bypassSecret,
    ...(options.secretValues || []),
    ...(options.passwordValues || []),
    ...(options.emailValues || [])
  ];
  const categories = artifactLeakFindings(filePath, content, options);
  return {
    path: sanitizeArtifactPath(filePath, sensitiveValues),
    categories,
    safe: categories.length === 0
  };
}

function artifactLeakReasons(filePath, content, options = {}) {
  return artifactLeakFindings(filePath, content, options);
}

function rolePreflightSummary(results) {
  return Object.fromEntries(results.map(({ role, ready }) => [role, ready ? 'YES' : 'NO']));
}

function roleSuiteStatus({ mode, configured, failed }) {
  if (mode === 'technical') return 'SKIPPED';
  if (!configured) return 'BLOCKED';
  return failed ? 'FAIL' : 'PASS';
}

module.exports = {
  artifactContainsAnySecret,
  artifactContainsAuthMaterial,
  artifactContainsSecret,
  artifactLeakFindings,
  artifactLeakReasons,
  isForbiddenArtifactPath,
  isTextArtifactPath,
  rolePreflightSummary,
  roleSuiteStatus,
  sanitizeArtifactPath,
  sanitizeUatDiagnostic,
  sensitiveUatValues,
  scanArtifact,
  textContent
};
