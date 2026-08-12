const roles = ['ADMIN', 'MANAGER', 'VIEWER'];

const roleApiMatrix = {
  ADMIN: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authenticate; ADMIN/MANAGER global scope'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Users', '/api/v1/users', 200, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 200, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 200, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 200, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ],
  MANAGER: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authenticate; MANAGER global scope'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Users', '/api/v1/users', 200, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 200, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ],
  VIEWER: [
    ['Dashboard', '/api/v1/dashboard', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200, 'src/routes/employees.routes.js', 'authenticate; reduced response'],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200, 'src/routes/operations.routes.js', 'authenticate'],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'VIEWER without employeeId is forbidden'],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Users', '/api/v1/users', 403, 'src/routes/users.routes.js', 'authorize ADMIN/MANAGER'],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403, 'src/routes/data-quality.routes.js', 'authorize ADMIN'],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403, 'src/routes/operations.routes.js', 'authorize ADMIN'],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['Report summary', '/api/v1/reports/summary', 403, 'src/routes/operations.routes.js', 'authorize ADMIN/MANAGER'],
    ['System settings', '/api/v1/system-settings', 403, 'src/routes/operations.routes.js', 'authorize ADMIN']
  ]
};

const navigationCatalog = {
  dashboard: { id: 'dashboard', label: 'Dashboard' },
  employees: { id: 'employees', label: 'ข้อมูลพนักงาน' },
  licenses: { id: 'licenses', label: 'ใบอนุญาต รปภ.' },
  schedule: { id: 'schedule', label: 'ตารางกะรายเดือน' },
  shiftSetup: { id: 'shiftSetup', label: 'รหัสกะและเวลา' },
  leave: { id: 'leave', label: 'คำขอลา' },
  leavePending: { id: 'leavePending', label: 'รออนุมัติ' },
  leaveHistory: { id: 'leaveHistory', label: 'ประวัติการลาทั้งหมด' },
  quota: { id: 'quota', label: 'โควต้าวันลา' },
  rules: { id: 'rules', label: 'กฎการทำงาน' },
  audit: { id: 'audit', label: 'บันทึกการใช้งานระบบ' },
  dataQuality: { id: 'dataQuality', label: 'คุณภาพข้อมูล' },
  users: { id: 'users', label: 'ผู้ใช้และสิทธิ์' },
  executiveReport: { id: 'executiveReport', label: 'รายงานผู้บริหาร' },
  reports: { id: 'reports', label: 'รายงานและ Export' },
  settings: { id: 'settings', label: 'ตั้งค่าระบบ' }
};

const roleNavigation = {
  ADMIN: {
    required: Object.keys(navigationCatalog),
    forbidden: []
  },
  MANAGER: {
    required: ['dashboard', 'employees', 'licenses', 'schedule', 'shiftSetup', 'leave', 'leavePending', 'leaveHistory', 'rules', 'users', 'executiveReport', 'reports'],
    forbidden: ['quota', 'audit', 'dataQuality', 'settings']
  },
  VIEWER: {
    required: ['dashboard', 'employees', 'schedule', 'shiftSetup', 'leave', 'leaveHistory', 'rules'],
    forbidden: ['licenses', 'leavePending', 'quota', 'audit', 'dataQuality', 'users', 'executiveReport', 'reports', 'settings']
  }
};

const rolePageChecks = {
  ADMIN: ['dashboard', 'schedule', 'leave', 'licenses', 'dataQuality', 'audit', 'executiveReport'],
  MANAGER: ['dashboard', 'schedule', 'leave', 'licenses', 'executiveReport'],
  VIEWER: ['dashboard', 'schedule', 'leave']
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
  getNavigationItem,
  getRoleApiMatrix,
  getRoleNavigation,
  getRoleNavigationContract,
  getRolePageChecks,
  navigationCatalog,
  roleApiMatrix,
  roleNavigation,
  rolePageChecks,
  roles
};
