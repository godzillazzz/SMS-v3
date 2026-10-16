// Reference: Production navigation snapshot at 2e43619957ff4f1fb9bc88da5597a8e68e3eace0 (fix/serverless-database-reliability)
const roles = ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'];

const roleApiMatrix = {
  ADMIN: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate'],
    ['Shift types', '/api/v1/shift-types', 200, 'src/routes/shifts.routes.js', 'authenticate'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authenticate; ADMIN/MANAGER global scope'],
    ['Leave pending count', '/api/v1/leave-requests/pending-count', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Approval Center', '/api/v1/approval-center/summary', 200, 'src/routes/approval-center.routes.js', 'authorize ADMIN/MANAGER'],
    ['Scheduling rules', '/api/v1/scheduling-rules', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Users', '/api/v1/users', 200, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Personnel masters', '/api/v1/personnel-masters?activeOnly=true', 200, 'src/routes/personnel-masters.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 200, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 200, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['System Health', '/api/v1/admin/system-health', 200, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 200, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year={year}&month={monthNumber}', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 200, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ],
  MANAGER: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate'],
    ['Shift types', '/api/v1/shift-types', 200, 'src/routes/shifts.routes.js', 'authenticate'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authenticate; MANAGER global scope'],
    ['Leave pending count', '/api/v1/leave-requests/pending-count', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Approval Center', '/api/v1/approval-center/summary', 200, 'src/routes/approval-center.routes.js', 'authorize ADMIN/MANAGER'],
    ['Scheduling rules', '/api/v1/scheduling-rules', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Users', '/api/v1/users', 200, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Personnel masters', '/api/v1/personnel-masters?activeOnly=true', 200, 'src/routes/personnel-masters.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['System Health', '/api/v1/admin/system-health', 403, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 403, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year={year}&month={monthNumber}', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ],
  VIEWER: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate; reduced response'],
    ['Shift types', '/api/v1/shift-types', 200, 'src/routes/shifts.routes.js', 'authenticate'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'VIEWER without employeeId is forbidden'],
    ['Leave pending count', '/api/v1/leave-requests/pending-count', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Approval Center', '/api/v1/approval-center/summary', 403, 'src/routes/approval-center.routes.js', 'authorize ADMIN/MANAGER'],
    ['Scheduling rules', '/api/v1/scheduling-rules', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Users', '/api/v1/users', 403, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Personnel masters', '/api/v1/personnel-masters?activeOnly=true', 403, 'src/routes/personnel-masters.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['System Health', '/api/v1/admin/system-health', 403, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 403, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year={year}&month={monthNumber}', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ]
};

// API permissions reviewed against current Integration route guards.
// Keep SUPERVISOR explicit: it is a first-class role, not a MANAGER alias.
roleApiMatrix.SUPERVISOR = [
  ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
  ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate'],
  ['Shift types', '/api/v1/shift-types', 200, 'src/routes/shifts.routes.js', 'authenticate'],
  ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
  ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authenticate; SUPERVISOR scoped review'],
  ['Leave pending count', '/api/v1/leave-requests/pending-count', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR'],
  ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR'],
  ['License', '/api/v1/licenses?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR'],
  ['Approval Center', '/api/v1/approval-center/summary', 200, 'src/routes/approval-center.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR; policy-scoped'],
  ['Scheduling rules', '/api/v1/scheduling-rules', 200, 'src/routes/operations.routes.js', 'authenticate'],
  ['Users', '/api/v1/users', 200, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR; scope-scoped'],
  ['Personnel masters', '/api/v1/personnel-masters?activeOnly=true', 200, 'src/routes/personnel-masters.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR; scope-scoped'],
  ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
  ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403, 'src/routes/operations.routes.js', 'authorize ADMIN'],
  ['System Health', '/api/v1/admin/system-health', 403, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
  ['Security Sites', '/api/v1/admin/security-sites', 403, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
  ['Executive Report', '/api/v1/executive-report?year={year}&month={monthNumber}', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR; scope-scoped'],
  ['Report summary', '/api/v1/reports/summary', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER/SUPERVISOR; scope-scoped'],
  ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
];

// Write actions are documented separately from the GET-only read matrix.
const roleActionMatrix = {
  ADMIN: [
    ['Approve monthly schedule', 'POST', '/api/v1/schedule/approve-month', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/SUPERVISOR'],
    ['Update schedule approval', 'PUT', '/api/v1/schedule-approvals/:id', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/SUPERVISOR'],
    ['Approve schedule', 'POST', '/api/v1/schedules/approve', 200, 'src/routes/schedules.routes.js', 'authorize ADMIN/SUPERVISOR']
  ],
  MANAGER: [],
  SUPERVISOR: [
    ['Approve monthly schedule', 'POST', '/api/v1/schedule/approve-month', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/SUPERVISOR'],
    ['Update schedule approval', 'PUT', '/api/v1/schedule-approvals/:id', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/SUPERVISOR; status APPROVED only'],
    ['Approve schedule', 'POST', '/api/v1/schedules/approve', 200, 'src/routes/schedules.routes.js', 'authorize ADMIN/SUPERVISOR']
  ],
  VIEWER: []
};

// Login payload omits employeeId. Do not infer VIEWER's linkage from that absence.
// Employee-scoped leave acceptance needs a separately evidenced fixture contract.
roleApiMatrix.VIEWER = roleApiMatrix.VIEWER.filter(([label]) => label !== 'Leave');

const navigationCatalog = {
  dashboard: { id: 'dashboard', label: 'ภาพรวม' },
  employees: { id: 'employees', label: 'ข้อมูลพนักงาน' },

  attendance: { id: 'attendance', label: 'ลงเวลา' },
  attendanceSupervisor: { id: 'attendanceSupervisor', label: 'ศูนย์ควบคุมการลงเวลา' },
  attendanceDevice: { id: 'attendanceDevice', label: 'อุปกรณ์ลงเวลา' },
  schedule: { id: 'schedule', label: 'ตารางกะรายเดือน' },

  shiftSetup: { id: 'shiftSetup', label: 'รหัสกะและเวลา' },
  leave: { id: 'leave', label: 'คำขอลา' },

  leaveHistory: { id: 'leaveHistory', label: 'ประวัติการลาทั้งหมด' },
  quota: { id: 'quota', label: 'โควต้าวันลา' },
  approvalCenter: { id: 'approvalCenter', label: 'ศูนย์อนุมัติ' },
  rules: { id: 'rules', label: 'ตรวจสอบกฎการทำงาน' },
  audit: { id: 'audit', label: 'บันทึกการใช้งานระบบ' },
  dataQuality: { id: 'dataQuality', label: 'คุณภาพข้อมูล' },
  systemHealth: { id: 'systemHealth', label: 'ประสิทธิภาพและสถานะระบบ' },
  users: { id: 'users', label: 'ผู้ใช้และสิทธิ์' },
  reportCenter: { id: 'reportCenter', label: 'รายงานและวิเคราะห์' },

  securitySite: { id: 'securitySite', label: 'จุดรักษาความปลอดภัยและ QR' },
  settings: { id: 'settings', label: 'ตั้งค่าระบบ' }
};

const legacyPageTargets = {
  executiveReport: { id: 'executiveReport', label: 'รายงานผู้บริหาร', navigationId: 'reportCenter', tab: 'executive' },
  reports: { id: 'reports', label: 'รายงานและ Export', navigationId: 'reportCenter', tab: 'details' }
};

const rolePageChecks = {
  ADMIN: ['dashboard', 'approvalCenter', 'employees', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory', 'quota', 'reportCenter', 'users', 'securitySite', 'settings', 'audit', 'dataQuality', 'systemHealth'],
  MANAGER: ['dashboard', 'approvalCenter', 'employees', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory', 'reportCenter', 'users'],
  SUPERVISOR: ['dashboard', 'approvalCenter', 'employees', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory', 'reportCenter', 'users'],
  VIEWER: ['dashboard', 'employees', 'attendance', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory']
};

// Keep navigation contracts explicit so SUPERVISOR cannot silently inherit MANAGER pages.
const roleNavigation = {
  ADMIN: { required: Object.keys(navigationCatalog), forbidden: [] },
  MANAGER: { required: ['dashboard', 'approvalCenter', 'employees', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory', 'reportCenter', 'users'], forbidden: ['quota', 'securitySite', 'settings', 'audit', 'dataQuality', 'systemHealth'] },
  SUPERVISOR: { required: ['dashboard', 'approvalCenter', 'employees', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory', 'reportCenter', 'users'], forbidden: ['quota', 'securitySite', 'settings', 'audit', 'dataQuality', 'systemHealth'] },
  VIEWER: { required: ['dashboard', 'employees', 'attendance', 'attendanceDevice', 'schedule', 'shiftSetup', 'rules', 'leave', 'leaveHistory'], forbidden: ['approvalCenter', 'attendanceSupervisor', 'quota', 'reportCenter', 'users', 'securitySite', 'settings', 'audit', 'dataQuality', 'systemHealth'] }
};

function currentUatMonth(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(date);
  return parts.find((part) => part.type === 'year').value + '-' + parts.find((part) => part.type === 'month').value;
}

function assertRole(role) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
}

function getRoleApiMatrix(role, month = currentUatMonth(), { employeeLinked = false } = {}) {
  assertRole(role);
  return roleApiMatrix[role].map(([label, path, expectedStatus, source, guard]) => ({
    label,
    path: path.replace('{month}', month).replace('{year}', month.split('-')[0]).replace('{monthNumber}', String(Number(month.split('-')[1]))),
    expectedStatus: role === 'VIEWER' && label === 'Leave' && employeeLinked ? 200 : expectedStatus,
    source,
    guard,
    readOnly: true
  }));
}

function getRoleActionMatrix(role) {
  assertRole(role);
  return roleActionMatrix[role].map(([label, method, path, expectedStatus, source, guard]) => ({ label, method, path, expectedStatus, source, guard, readOnly: false }));
}

function getNavigationItem(id) {
  const item = navigationCatalog[id];
  if (!item) throw new Error(`Unsupported UAT navigation id: ${id}`);
  return item;
}

function getLegacyPageTarget(id) {
  const target = legacyPageTargets[id];
  if (!target) throw new Error(`Unsupported UAT legacy page target: ${id}`);
  return target;
}

function getRoleNavigationContract(role) {
  assertRole(role);
  return {
    required: roleNavigation[role].required.map((id) => getNavigationItem(id)),
    forbidden: roleNavigation[role].forbidden.map((id) => getNavigationItem(id))
  };
}

function getRoleNavigation(role) {
  const contract = getRoleNavigationContract(role);
  return {
    required: contract.required.map(({ label }) => label),
    forbidden: contract.forbidden.map(({ label }) => label)
  };
}

function getRolePageChecks(role) {
  assertRole(role);
  return rolePageChecks[role].map((id) => getNavigationItem(id));
}

module.exports = {
  currentUatMonth,
  getLegacyPageTarget,
  getNavigationItem,
  getRoleApiMatrix,
  getRoleActionMatrix,
  getRoleNavigation,
  getRoleNavigationContract,
  getRolePageChecks,
  legacyPageTargets,
  navigationCatalog,
  roleApiMatrix,
  roleNavigation,
  rolePageChecks,
  roles
};
