const roles = ['ADMIN', 'MANAGER', 'VIEWER'];

const roleApiMatrix = {
  ADMIN: [
    ['Dashboard', '/api/v1/dashboard', 200],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200],
    ['Users', '/api/v1/users', 200],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 200],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 200],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200],
    ['Report summary', '/api/v1/reports/summary', 200],
    ['System settings', '/api/v1/system-settings', 200]
  ],
  MANAGER: [
    ['Dashboard', '/api/v1/dashboard', 200],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 200],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 200],
    ['Users', '/api/v1/users', 200],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 200],
    ['Report summary', '/api/v1/reports/summary', 200],
    ['System settings', '/api/v1/system-settings', 403]
  ],
  VIEWER: [
    ['Dashboard', '/api/v1/dashboard', 200],
    ['Employees', '/api/v1/employees?page=1&pageSize=20', 200],
    ['Schedule', '/api/v1/schedule-calendar?month={month}', 200],
    ['Leave', '/api/v1/leave-requests?page=1&pageSize=20', 200],
    ['Leave quota', '/api/v1/leave-quotas?page=1&pageSize=20', 403],
    ['License', '/api/v1/licenses?page=1&pageSize=20', 403],
    ['Users', '/api/v1/users', 403],
    ['Data Quality', '/api/v1/data-quality/issues?page=1&pageSize=20', 403],
    ['Audit', '/api/v1/audit-events?page=1&pageSize=1', 403],
    ['Executive Report', '/api/v1/executive-report?year=2026&month=8', 403],
    ['Report summary', '/api/v1/reports/summary', 403],
    ['System settings', '/api/v1/system-settings', 403]
  ]
};

const roleNavigation = {
  ADMIN: {
    required: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา', 'รออนุมัติ', 'ใบอนุญาต รปภ.', 'คุณภาพข้อมูล', 'บันทึกการใช้งานระบบ', 'รายงานผู้บริหาร'],
    forbidden: []
  },
  MANAGER: {
    required: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา', 'รออนุมัติ', 'ใบอนุญาต รปภ.', 'รายงานผู้บริหาร'],
    forbidden: ['คุณภาพข้อมูล', 'บันทึกการใช้งานระบบ', 'โควต้าวันลา', 'ตั้งค่าระบบ']
  },
  VIEWER: {
    required: ['Dashboard', 'ข้อมูลพนักงาน', 'Schedule Calendar', 'คำขอลา'],
    forbidden: ['ใบอนุญาต รปภ.', 'ผู้ใช้และสิทธิ์', 'คุณภาพข้อมูล', 'บันทึกการใช้งานระบบ', 'รายงานผู้บริหาร', 'รายงานและ Export', 'โควต้าวันลา', 'ตั้งค่าระบบ', 'รออนุมัติ']
  }
};

function currentUatMonth(date = new Date()) {
  return date.toISOString().slice(0, 7);
}

function getRoleApiMatrix(role, month = currentUatMonth()) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
  return roleApiMatrix[role].map(([label, path, expectedStatus]) => ({
    label,
    path: path.replace('{month}', month),
    expectedStatus,
    readOnly: true
  }));
}

function getRoleNavigation(role) {
  if (!roles.includes(role)) throw new Error(`Unsupported UAT role: ${role}`);
  return roleNavigation[role];
}

module.exports = { currentUatMonth, getRoleApiMatrix, getRoleNavigation, roleApiMatrix, roleNavigation, roles };
