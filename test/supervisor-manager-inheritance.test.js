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

test('internal SUPERVISOR key retains the former Supervisor superset of internal MANAGER', () => {
  const violations = [];
  for (const file of productionRoots.flatMap(sourceFiles)) {
    const relative = path.relative(root, file).replaceAll('\\', '/');
    for (const [index, line] of fs.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
      const isManagerAuthorize = /authorize\([^\n]*['"]MANAGER['"]/.test(line);
      const isManagerRoleArray = /\[['"]ADMIN['"],\s*['"]MANAGER['"]\]|\[['"]MANAGER['"],\s*['"]ADMIN['"]\]/.test(line);
      const isDirectManagerRoleCheck = /(?:^|[^\w])(?:[\w?.]+\.)?role\s*[!=]==?\s*['"]MANAGER['"]/.test(line);
      const intentionalPolicyToggle = relative === 'frontend/src/components/ApprovalAuthorityMatrixPanel.tsx';
      // OWNER policy (18 Oct 2026): the approval chain is stage-scoped — only a MANAGER may
      // forward the manager stage, so this single control intentionally omits SUPERVISOR.
      const intentionalApprovalStage = relative === 'frontend/src/pages/attendance-supervisor/AttendanceSupervisorPage.tsx'
        && line.includes('PENDING_MANAGER');
      const intentionalApprovalDispatch = relative === 'src/services/approval-center.service.js' && line.includes("if (role === 'MANAGER') return managerCanApproveLeave");
      const intentionalScheduleApproval = relative === 'src/routes/operations.routes.js' && line.includes('schedule/approve-month')
        || relative === 'src/routes/operations.routes.js' && line.includes('schedule-approvals/:id')
        || relative === 'src/routes/operations.routes.js' && line.includes('SCHEDULE_MANAGER_APPROVAL_ONLY')
        || relative === 'src/routes/schedules.routes.js' && line.includes("router.post('/approve'")
        || relative === 'src/services/approval-policy.service.js' && line.includes("type: 'SCHEDULE_APPROVAL'")
        || relative === 'src/services/schedule.service.js' && line.includes('actorUser.role')
        || relative === 'frontend/src/main.tsx' && line.includes('schedule: [')
        || relative === 'frontend/src/main.tsx' && line.includes('approval-banner');
      if ((isManagerAuthorize || isManagerRoleArray || isDirectManagerRoleCheck) && !line.includes('SUPERVISOR') && !intentionalPolicyToggle && !intentionalApprovalStage && !intentionalApprovalDispatch && !intentionalScheduleApproval) {
        violations.push(`${relative}:${index + 1}:${line.trim()}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test('MANAGER key keeps monthly approval while SUPERVISOR is denied', () => {
  const schedule = fs.readFileSync(path.join(root, 'src/services/schedule.service.js'), 'utf8');
  const operations = fs.readFileSync(path.join(root, 'src/routes/operations.routes.js'), 'utf8');
  assert.match(schedule, /\['ADMIN', 'MANAGER'\]\.includes\(actorUser\.role\)/);
  assert.match(operations, /Manager-role reviewers cannot review their own leave|peer Manager-role/i);
  assert.doesNotMatch(schedule, /\['ADMIN', 'MANAGER', 'SUPERVISOR'\]\.includes\(actorUser\.role\)/);
});
