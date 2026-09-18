const roles = ['ADMIN', 'MANAGER', 'VIEWER'];

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
    ['System Health', '/api/v1/system-health', 200, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 200, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
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
    ['System Health', '/api/v1/system-health', 403, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 403, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
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
    ['System Health', '/api/v1/system-health', 403, 'src/routes/system-health.routes.js', 'authorize ADMIN'],
    ['Security Sites', '/api/v1/admin/security-sites', 403, 'src/routes/security-sites.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ]
};

const navigationCatalog = {
  dashboard: { id: 'dashboard', label: 'Dashboard' },
  employees: { id: 'employees', label: 'ข้อมูลพนักงาน' },
  licenses: { id: 'licenses', label: 'ใบอนุญาต รปภ.' },
  attendance: { id: 'attendance', label: 'ลงเวลา' },
  attendanceSupervisor: { id: 'attendanceSupervisor', label: 'ลงเวลาแทนพนักงาน' },
  attendanceDevice: { id: 'attendanceDevice', label: 'อุปกรณ์ลงเวลา' },
  schedule: { id: 'schedule', label: 'ตารางกะรายเดือน' },
  shiftSetup: { id: 'shiftSetup', label: 'รหัสกะและเวลา' },
  leave: { id: 'leave', label: 'คำขอลา' },
  leavePending: { id: 'leavePending', label: 'รออนุมัติ' },
  leaveHistory: { id: 'leaveHistory', label: 'ประวัติการลาทั้งหมด' },
  quota: { id: 'quota', label: 'โควต้าวันลา' },
  approvalCenter: { id: 'approvalCenter', label: 'ศูนย์อนุมัติ' },
  rules: { id: 'rules', label: 'กฎการทำงาน' },
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

const roleNavigation = {
  ADMIN: {
    required: Object.keys(navigationCatalog),
    forbidden: []
  },
  MANAGER: {
    required: ['dashboard', 'employees', 'licenses', 'attendance', 'attendanceSupervisor', 'attendanceDevice', 'schedule', 'shiftSetup', 'leave', 'leavePending', 'leaveHistory', 'approvalCenter', 'rules', 'users', 'reportCenter'],
    forbidden: ['quota', 'audit', 'dataQuality', 'systemHealth', 'securitySite', 'settings']
  },
  VIEWER: {
    required: ['dashboard', 'employees', 'attendance', 'attendanceDevice', 'schedule', 'shiftSetup', 'leave', 'leaveHistory', 'rules'],
    forbidden: ['licenses', 'attendanceSupervisor', 'leavePending', 'quota', 'approvalCenter', 'audit', 'dataQuality', 'systemHealth', 'users', 'reportCenter', 'securitySite', 'settings']
  }
};

const rolePageChecks = {
  ADMIN: ['dashboard', 'employees', 'licenses', 'schedule', 'shiftSetup', 'leave', 'leavePending', 'leaveHistory', 'quota', 'approvalCenter', 'rules', 'audit', 'dataQuality', 'systemHealth', 'users', 'reportCenter', 'securitySite', 'settings'],
  MANAGER: ['dashboard', 'employees', 'licenses', 'schedule', 'shiftSetup', 'leave', 'leavePending', 'leaveHistory', 'approvalCenter', 'rules', 'users', 'reportCenter'],
  VIEWER: ['dashboard', 'employees', 'schedule', 'shiftSetup', 'leave', 'leaveHistory', 'rules']
};

function currentUatMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function assertRole(role) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
}

function getRoleApiMatrix(role, month = currentUatMonth()) {
  assertRole(role);
  return roleApiMatrix[role].map(([label, path, expectedStatus, source, guard]) => ({
    label,
    path: path.replace('{month}', month),
    expectedStatus,
    source,
    guard,
    readOnly: true
  }));
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
