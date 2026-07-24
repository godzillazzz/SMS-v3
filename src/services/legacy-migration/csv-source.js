const fs = require('node:fs');
const path = require('node:path');
const { parse } = require('csv-parse/sync');

const FILES = Object.freeze({
  dashboard: ['Security Management System - Dashboard.csv', ['Metric', 'Value']],
  employeeLicenses: ['Security Management System - Employee Licenses.csv', ['License ID', 'Employee ID', 'License Type', 'License Number', 'Issue Date', 'Expiry Date', 'Status', 'Document URL', 'Remark', 'Updated By', 'Updated At']],
  employees: ['Security Management System - Employees.csv', ['Employee ID', 'Name', 'Department', 'Position', 'Skill', 'Status']],
  licenseAudit: ['Security Management System - License Audit Log.csv', ['Timestamp', 'Action', 'Employee ID', 'License ID', 'Work Date', 'Shift Code', 'License Status', 'Expiry Date', 'Reason', 'Approved By']],
  quota: ['Security Management System - Quota.csv', ['ชื่อพนักงาน', 'ลาป่วย', 'ลากิจ', 'ลาพักร้อน']],
  rules: ['Security Management System - Rules.csv', ['Rule ID', 'Rule Name', 'Value', 'Unit', 'Enabled']],
  scheduleApprovalLog: ['Security Management System - Schedule Approval Log.csv', ['Timestamp', 'Action', 'Month', 'Revision', 'Status', 'Change Type', 'Performed By', 'Note']],
  scheduleApprovals: ['Security Management System - Schedule Approvals.csv', ['Month', 'Status', 'Revision', 'Changed By', 'Changed At', 'Change Type', 'Approved By', 'Approved At', 'Approval Note', 'Schedule Hash']],
  schedule: ['Security Management System - Schedule.csv', ['Date', 'Employee ID', 'Employee Name', 'Department', 'Shift Code', 'Start Time', 'End Time', 'Hours', 'Remark', 'Source', 'Locked', 'Updated By', 'Updated At', 'License Status', 'License Expiry Date', 'License Override', 'Override Reason', 'Override By', 'Override At']],
  settings: ['Security Management System - Settings.csv', ['Key', 'Value', 'Description']],
  shiftTypes: ['Security Management System - Shift Types.csv', ['Shift Code', 'Shift Name', 'Start Time', 'End Time', 'Hours', 'Color']],
  userAudit: ['Security Management System - User Audit Log.csv', ['Timestamp', 'Action', 'User ID', 'Email', 'Role', 'Department', 'Reason', 'Performed By', 'Employee ID']],
  users: ['Security Management System - Users.csv', ['User ID', 'Name', 'Email', 'Role', 'Department', 'Status', 'Password Hash', 'Requested At', 'Approved By', 'Approved At', 'Rejection Reason', 'Updated At', 'Last Login At', 'Employee ID']],
  leave: ['Security Management System - ลางาน.csv', ['Timestamp', 'ชื่อ-นามสกุล', 'แผนก', 'ประเภทการลา', 'วันเริ่มต้น', 'วันสิ้นสุด', 'จำนวนวัน', 'เหตุผล', 'ไฟล์แนบ', 'สถานะ', 'ผู้อนุมัติ', 'วันเวลาที่อนุมัติ']]
});

function assertOutsideRepository(sourceDir, repositoryRoot = process.cwd()) {
  const relative = path.relative(path.resolve(repositoryRoot), path.resolve(sourceDir));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    throw new Error('Migration source must remain outside the repository workspace.');
  }
}

function readCsv(filePath, expectedHeaders) {
  let actualHeaders;
  const rows = parse(fs.readFileSync(filePath, 'utf8'), {
    bom: true,
    columns(headers) {
      actualHeaders = headers.map((header) => String(header).trim());
      return actualHeaders;
    },
    skip_empty_lines: true,
    relax_column_count: false
  });
  if (JSON.stringify(actualHeaders) !== JSON.stringify(expectedHeaders)) {
    throw new Error(`Unexpected CSV header schema for ${path.basename(filePath)}.`);
  }
  return rows;
}

function loadLegacySource(sourceDir, options = {}) {
  const resolved = path.resolve(sourceDir);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new Error('Migration source directory was not found.');
  }
  if (options.requireOutsideRepository !== false) assertOutsideRepository(resolved, options.repositoryRoot);

  const result = {};
  for (const [key, [fileName, headers]] of Object.entries(FILES)) {
    const filePath = path.join(resolved, fileName);
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      throw new Error(`Required migration file is missing: ${fileName}.`);
    }
    result[key] = readCsv(filePath, headers);
  }
  return result;
}

module.exports = { FILES, assertOutsideRepository, loadLegacySource, readCsv };
