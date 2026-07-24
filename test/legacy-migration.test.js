process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildMigrationPlan, parseLegacyDate } = require('../src/services/legacy-migration/transform');
const { safeError } = require('../scripts/migrate-legacy-data');

function sampleSource() {
  const employee = { 'Employee ID': 'SAMPLE-001', Name: 'Sample Person', Department: 'Sample Department', Position: 'Sample Position', Skill: 'Sample Skill', Status: 'Active' };
  const user = { 'User ID': 'SAMPLE-USER-001', Name: 'Sample User', Email: 'sample-user@example.test', Role: 'Admin', Department: 'Sample Department', Status: 'Active', 'Password Hash': 'a'.repeat(64), 'Requested At': '24/7/2026, 9:10:11', 'Approved By': 'SYSTEM', 'Approved At': '24/7/2026', 'Rejection Reason': '', 'Updated At': '2026-07-24 09:10:11', 'Last Login At': '', 'Employee ID': 'SAMPLE-001' };
  const schedule = { Date: '31/7/2026, 00:00:00', 'Employee ID': 'SAMPLE-001', 'Employee Name': 'Sample Person', Department: 'Sample Department', 'Shift Code': 'DAY', 'Start Time': '08:00', 'End Time': '16:00', Hours: '8', Remark: '', Source: 'Sample', Locked: 'TRUE', 'Updated By': 'SYSTEM', 'Updated At': '24/7/2026, 9:10:11', 'License Status': 'Valid', 'License Expiry Date': '2027-07-24', 'License Override': 'FALSE', 'Override Reason': '', 'Override By': '', 'Override At': '' };
  return {
    dashboard: [{ Metric: 'Sample', Value: '1' }],
    employees: [employee],
    users: [user, { ...user, 'User ID': 'SAMPLE-USER-002', Email: 'pending-user@example.test', Role: '', Status: 'Pending', 'Employee ID': '', 'Approved At': '' }],
    shiftTypes: [{ 'Shift Code': 'DAY', 'Shift Name': 'Sample Day', 'Start Time': '08:00', 'End Time': '16:00', Hours: '8', Color: '#000000' }],
    schedule: [schedule],
    employeeLicenses: [{ 'License ID': 'SAMPLE-LICENSE-001', 'Employee ID': 'SAMPLE-001', 'License Type': 'Sample', 'License Number': 'SAMPLE-NUMBER', 'Issue Date': '2026-01-01', 'Expiry Date': '2027-01-01', Status: 'Valid', 'Document URL': '', Remark: '', 'Updated By': 'SYSTEM', 'Updated At': '24/7/2026, 9:10:11' }],
    leave: [{ Timestamp: '24/7/2026, 9:10:11', 'ชื่อ-นามสกุล': 'Sample Person', 'แผนก': 'Sample Department', 'ประเภทการลา': 'Sample Leave', 'วันเริ่มต้น': '2026-07-25', 'วันสิ้นสุด': '2026-07-25', 'จำนวนวัน': '1', 'เหตุผล': 'Sample only', 'ไฟล์แนบ': '', 'สถานะ': 'Pending', 'ผู้อนุมัติ': '', 'วันเวลาที่อนุมัติ': '' }],
    quota: [
      { 'ชื่อพนักงาน': 'Sample Person', 'ลาป่วย': '10', 'ลากิจ': '5', 'ลาพักร้อน': '6' },
      { 'ชื่อพนักงาน': 'Unmatched Sample', 'ลาป่วย': '0', 'ลากิจ': '0', 'ลาพักร้อน': '0' }
    ],
    scheduleApprovals: [{ Month: '2026-07', Status: 'Draft', Revision: '1', 'Changed By': 'SYSTEM', 'Changed At': '24/7/2026, 9:10:11', 'Change Type': 'Sample', 'Approved By': '', 'Approved At': '', 'Approval Note': '', 'Schedule Hash': 'sample-hash' }],
    scheduleApprovalLog: [{ Timestamp: '24/7/2026, 9:10:11', Action: 'Sample', Month: '2026-07', Revision: '1', Status: 'Draft', 'Change Type': 'Sample', 'Performed By': 'SYSTEM', Note: '' }],
    rules: [{ 'Rule ID': 'SAMPLE-RULE', 'Rule Name': 'Sample Rule', Value: '1', Unit: 'unit', Enabled: 'TRUE' }],
    settings: [{ Key: 'SAMPLE_SETTING', Value: 'sample', Description: 'Sample only' }],
    userAudit: [{ Timestamp: '24/7/2026, 9:10:11', Action: 'Sample', 'User ID': 'SAMPLE-USER-001', Email: 'sample-user@example.test', Role: 'Admin', Department: 'Sample Department', Reason: 'Sample only', 'Performed By': 'SYSTEM', 'Employee ID': 'SAMPLE-001' }],
    licenseAudit: [{ Timestamp: '24/7/2026, 9:10:11', Action: 'Sample', 'Employee ID': 'SAMPLE-001', 'License ID': 'SAMPLE-LICENSE-001', 'Work Date': '', 'Shift Code': '', 'License Status': 'Valid', 'Expiry Date': '2027-01-01', Reason: 'Sample only', 'Approved By': 'SYSTEM' }]
  };
}

test('legacy day/month dates are parsed deterministically in the Bangkok source timezone', () => {
  assert.equal(parseLegacyDate('31/7/2026, 09:10:11', 'fixture').toISOString(), '2026-07-31T02:10:11.000Z');
  assert.equal(parseLegacyDate('31/7/2026', 'fixture').toISOString(), '2026-07-30T17:00:00.000Z');
  assert.equal(parseLegacyDate('31/7/2026, 00:00:00', 'fixture', { dateOnly: true }).toISOString(), '2026-07-31T00:00:00.000Z');
});

test('migration plan preserves roles/statuses but excludes legacy password hashes', () => {
  const plan = buildMigrationPlan(sampleSource());
  assert.equal(plan.summary.employees, 1);
  assert.equal(plan.summary.users, 2);
  assert.equal(plan.summary.shiftAssignments, 1);
  assert.equal(plan.summary.quotaUnmatched, 1);
  assert.equal(plan.users[0].role, 'ADMIN');
  assert.equal(plan.users[1].role, 'USER');
  assert.equal(plan.users[1].accountStatus, 'PENDING');
  assert.equal(plan.users[1].isActive, false);
  assert.equal(plan.users.every((user) => user.passwordResetRequired), true);
  assert.equal(Object.hasOwn(plan.users[0], 'passwordHash'), false);
});

test('migration plan rejects duplicate employee/date schedule assignments', () => {
  const source = sampleSource();
  source.schedule.push({ ...source.schedule[0] });
  assert.throws(() => buildMigrationPlan(source), /duplicate employee\/date assignment/);
});

test('migration CLI sanitizes arbitrary Prisma validation payloads', () => {
  const error = new Error('Invalid invocation with private-person@example.test and a source row payload');
  error.name = 'PrismaClientValidationError';
  const result = safeError(error);
  assert.equal(result, 'PrismaClientValidationError during legacy import');
  assert.equal(result.includes('private-person'), false);
});
