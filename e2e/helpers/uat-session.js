const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const roles = ['ADMIN', 'MANAGER', 'VIEWER'];

function sessionDirectory(environment = process.env) {
  const runId = String(environment.GITHUB_RUN_ID || 'local');
  const baseUrl = String(environment.UAT_BASE_URL || 'uat-invalid');
  const suffix = crypto.createHash('sha256').update(baseUrl).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `sms-v3-uat-v3-${runId}-${suffix}`);
}

function sessionFile(role, environment = process.env) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
  return path.join(sessionDirectory(environment), `${role.toLowerCase()}.json`);
}

function writeRoleSessions(sessions, environment = process.env) {
  const directory = sessionDirectory(environment);
  fs.rmSync(directory, { recursive: true, force: true });
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  for (const role of roles) {
    if (!(role in sessions)) continue;
    const session = sessions[role];
    if (!session?.accessToken || session.user?.role !== role) throw new Error('AUTH_SESSION_INVALID');
    fs.writeFileSync(sessionFile(role, environment), JSON.stringify(session), { encoding: 'utf8', mode: 0o600 });
  }
}

function readRoleSession(role, environment = process.env) {
  try {
    const session = JSON.parse(fs.readFileSync(sessionFile(role, environment), 'utf8'));
    if (!session?.accessToken || session.user?.role !== role) return undefined;
    return session;
  } catch {
    return undefined;
  }
}

function clearRoleSessions(environment = process.env) {
  fs.rmSync(sessionDirectory(environment), { recursive: true, force: true });
}

module.exports = { clearRoleSessions, readRoleSession, sessionDirectory, writeRoleSessions };
