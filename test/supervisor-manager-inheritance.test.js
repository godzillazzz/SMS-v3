const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const productionRoots = [path.join(root, 'src'), path.join(root, 'frontend', 'src')];

function sourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    if (!/\.(?:js|ts|tsx)$/.test(entry.name) || /\.test\.(?:js|ts|tsx)$/.test(entry.name)) return [];
    return [full];
  });
}

test('SUPERVISOR inherits every source permission gate granted to MANAGER', () => {
  const violations = [];
  for (const file of productionRoots.flatMap(sourceFiles)) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      const isManagerAuthorize = /authorize\([^\n]*['"]MANAGER['"]/.test(line);
      const isManagerRoleArray = /\[['"]ADMIN['"],\s*['"]MANAGER['"]\]|\[['"]MANAGER['"],\s*['"]ADMIN['"]\]/.test(line);
      const isDirectManagerRoleCheck = /(?:^|[^\w])(?:[\w?.]+\.)?role\s*[!=]==?\s*['"]MANAGER['"]/.test(line);
      const intentionalPolicyToggle = relative === 'frontend/src/components/ApprovalAuthorityMatrixPanel.tsx';
      const intentionalApprovalDispatch = relative === 'src/services/approval-center.service.js' && line.includes("if (role === 'MANAGER') return managerCanApproveLeave");
      if ((isManagerAuthorize || isManagerRoleArray || isDirectManagerRoleCheck) && !line.includes('SUPERVISOR') && !intentionalPolicyToggle && !intentionalApprovalDispatch) {
        violations.push(`${relative}:${index + 1}:${line.trim()}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('SUPERVISOR extras remain additive without granting MANAGER monthly approval', () => {
  const schedule = fs.readFileSync(path.join(root, 'src/services/schedule.service.js'), 'utf8');
  const operations = fs.readFileSync(path.join(root, 'src/routes/operations.routes.js'), 'utf8');
  assert.match(schedule, /\['ADMIN', 'SUPERVISOR'\]\.includes\(actorUser\.role\)/);
  assert.match(operations, /Supervisors cannot review their own leave|Supervisors may review|peer-Supervisor|peer Supervisor/i);
  assert.doesNotMatch(schedule, /\['ADMIN', 'MANAGER', 'SUPERVISOR'\]\.includes\(actorUser\.role\)/);
});
