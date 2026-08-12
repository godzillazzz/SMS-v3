const forbiddenArtifactSegments = new Set([
  '.auth',
  'auth-state',
  'cookies',
  'local-storage',
  'session-storage',
  'storage-state',
  'storagestate'
]);

function isForbiddenArtifactPath(filePath) {
  const normalized = String(filePath || '').replace(/\\/g, '/').toLowerCase();
  const segments = normalized.split('/').filter(Boolean);
  return segments.some((segment) => forbiddenArtifactSegments.has(segment))
    || /(?:^|[-_.])(auth|storage[-_.]?state|cookies|session)(?:[-_.]|$)/i.test(segments.at(-1) || '');
}

function artifactContainsAuthMaterial(content) {
  const value = Buffer.isBuffer(content) ? content.toString('utf8') : String(content || '');
  return /(?:accessToken|refreshToken|Authorization\s*:\s*Bearer\s+[A-Za-z0-9._-]+|smsv3_csrf\s*[:=]|storageState\s*[:=]|sessionStorage\s*[:=]|localStorage\s*[:=]|cookie(?:s)?\s*[:=])/i.test(value);
}

function artifactContainsAnySecret(content, secrets = []) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(String(content || ''));
  return secrets.filter(Boolean).some((secret) => buffer.includes(Buffer.from(secret)));
}

function rolePreflightSummary(results) {
  return Object.fromEntries(results.map(({ role, ready }) => [role, ready ? 'YES' : 'NO']));
}

function roleSuiteStatus({ mode, configured, failed }) {
  if (mode === 'technical') return 'SKIPPED';
  if (!configured) return 'BLOCKED';
  return failed ? 'FAIL' : 'PASS';
}

module.exports = { artifactContainsAnySecret, artifactContainsAuthMaterial, isForbiddenArtifactPath, rolePreflightSummary, roleSuiteStatus };
