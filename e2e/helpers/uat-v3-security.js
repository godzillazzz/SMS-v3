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

function isForbiddenArtifactPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
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

function artifactContainsAuthMaterial(content) {
  const value = textContent(content);
  return [
    /["']accessToken["']\s*:\s*["'][A-Za-z0-9._~-]{20,}["']/i,
    /["']refreshToken["']\s*:\s*["'][A-Za-z0-9._~-]{20,}["']/i,
    /Authorization\s*:\s*Bearer\s+[A-Za-z0-9._~-]{20,}/i,
    /(?:smsv3_csrf|smsv3_refresh)\s*[:=]\s*["']?[A-Za-z0-9._~-]{20,}/i,
    /(?:storageState|sessionStorage|localStorage)\s*[:=]\s*["'][^"']{20,}["']/i,
    /cookie(?:s)?\s*[:=]\s*["'][^"']{20,}["']/i
  ].some((pattern) => pattern.test(value));
}

function artifactContainsAnySecret(content, secrets = []) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''));
  return secrets
    .filter(Boolean)
    .filter((secret) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(secret)))
    .some((secret) => buffer.includes(Buffer.from(secret)));
}

function artifactContainsSecret(content, secret) {
  return Boolean(secret) && artifactContainsAnySecret(content, [secret]);
}

function isTextArtifactPath(filePath) {
  const normalized = String(filePath || '').toLowerCase();
  return textArtifactExtensions.has(normalized.slice(normalized.lastIndexOf('.')));
}

function artifactLeakReasons(filePath, content, { bypassSecret = '', secretValues = [] } = {}) {
  const reasons = [];
  if (isForbiddenArtifactPath(filePath)) reasons.push('FORBIDDEN_PATH');
  if (artifactContainsSecret(content, bypassSecret)) reasons.push('VERCEL_BYPASS_SECRET');
  if (artifactContainsAnySecret(content, secretValues)) reasons.push('UAT_SECRET_VALUE');
  if (isTextArtifactPath(filePath) && artifactContainsAuthMaterial(content)) reasons.push('AUTH_MATERIAL');
  return reasons;
}

function rolePreflightSummary(results) {
  return Object.fromEntries(results.map(({ role, ready }) => [role, ready ? 'YES' : 'NO']));
}

function roleSuiteStatus({ mode, configured, failed }) {
  if (mode === 'technical') return 'SKIPPED';
  if (!configured) return 'BLOCKED';
  return failed ? 'FAIL' : 'PASS';
}

module.exports = { artifactContainsAnySecret, artifactContainsAuthMaterial, artifactLeakReasons, isForbiddenArtifactPath, isTextArtifactPath, rolePreflightSummary, roleSuiteStatus };
