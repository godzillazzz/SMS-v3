const crypto = require('node:crypto');

const clean = (value) => String(value ?? '').trim();
const nullable = (value) => clean(value) || null;
const normalizedKey = (value) => clean(value).replace(/\s+/g, ' ').toLocaleLowerCase('en-US');

function required(value, dataset, rowNumber, field) {
  const result = clean(value);
  if (!result) throw new Error(`${dataset} row ${rowNumber}: required field ${field} is empty.`);
  return result;
}

function bounded(value, max, dataset, rowNumber, field, { required: isRequired = false } = {}) {
  const result = isRequired ? required(value, dataset, rowNumber, field) : nullable(value);
  if (result && result.length > max) throw new Error(`${dataset} row ${rowNumber}: field ${field} exceeds ${max} characters.`);
  return result;
}

function validDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  const candidate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return candidate.getUTCFullYear() === year && candidate.getUTCMonth() === month - 1 && candidate.getUTCDate() === day;
}

function parseLegacyDate(value, context, { required: isRequired = false, dateOnly = false } = {}) {
  const input = clean(value);
  if (!input) {
    if (isRequired) throw new Error(`${context}: required date is empty.`);
    return null;
  }

  let match = input.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const [, y, m, d, hh = '0', mm = '0', ss = '0'] = match;
    const parts = [y, m, d, hh, mm, ss].map(Number);
    if (!validDateParts(...parts)) throw new Error(`${context}: invalid date.`);
    if (dateOnly) return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return new Date(`${y}-${m}-${d}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+07:00`);
  }

  match = input.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2}):(\d{2}))?$/);
  if (match) {
    const [, d, m, y, hh = '0', mm = '0', ss = '0'] = match;
    const parts = [y, m, d, hh, mm, ss].map(Number);
    if (!validDateParts(...parts)) throw new Error(`${context}: invalid day/month date.`);
    if (dateOnly) return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    return new Date(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}+07:00`);
  }
  throw new Error(`${context}: unsupported date format.`);
}

function parseMonth(value, context) {
  const input = clean(value);
  const match = input.match(/^(\d{4})-(\d{2})$/);
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) throw new Error(`${context}: unsupported month format.`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
}

function decimal(value, dataset, rowNumber, field, { defaultValue } = {}) {
  const input = clean(value).replace(/,/g, '');
  if (!input && defaultValue !== undefined) return String(defaultValue);
  if (!/^-?\d+(?:\.\d+)?$/.test(input)) throw new Error(`${dataset} row ${rowNumber}: field ${field} is not numeric.`);
  return input;
}

function integer(value, dataset, rowNumber, field, { defaultValue } = {}) {
  const parsed = decimal(value, dataset, rowNumber, field, { defaultValue });
  if (!/^-?\d+$/.test(parsed)) throw new Error(`${dataset} row ${rowNumber}: field ${field} is not an integer.`);
  return Number(parsed);
}

function boolean(value, dataset, rowNumber, field, { defaultValue = false } = {}) {
  const input = clean(value).toLowerCase();
  if (!input) return defaultValue;
  if (['true', 'yes', '1', 'y', 'ใช่'].includes(input)) return true;
  if (['false', 'no', '0', 'n', 'ไม่'].includes(input)) return false;
  throw new Error(`${dataset} row ${rowNumber}: field ${field} is not boolean.`);
}

function fingerprint(dataset, row) {
  const ordered = Object.fromEntries(Object.keys(row).sort().map((key) => [key, clean(row[key])]));
  return crypto.createHash('sha256').update(`${dataset}\n${JSON.stringify(ordered)}`).digest('hex');
}

function splitName(displayName) {
  const parts = clean(displayName).replace(/\s+/g, ' ').split(' ');
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') || '-' };
}

function mapAccountStatus(status, rowNumber) {
  const value = clean(status).toLowerCase();
  const mapping = { active: 'ACTIVE', pending: 'PENDING', suspended: 'SUSPENDED', rejected: 'REJECTED' };
  if (!mapping[value]) throw new Error(`Users row ${rowNumber}: unsupported account status.`);
  return mapping[value];
}

function mapRole(role, accountStatus, rowNumber) {
  const value = clean(role).toLowerCase();
  if (!value && accountStatus === 'PENDING') return { role: 'VIEWER', legacyRole: null };
  const mapping = { admin: 'ADMIN', manager: 'MANAGER', viewer: 'VIEWER' };
  if (!mapping[value]) throw new Error(`Users row ${rowNumber}: unsupported role.`);
  return { role: mapping[value], legacyRole: clean(role) };
}

function assertUnique(rows, keyFn, dataset, label) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (seen.has(key)) throw new Error(`${dataset} row ${index + 2}: duplicate ${label}.`);
    seen.add(key);
  });
}

function assertUniqueOptional(rows, keyFn, dataset, label) {
  const seen = new Set();
  rows.forEach((row, index) => {
    const key = keyFn(row);
    if (!key) return;
    if (seen.has(key)) throw new Error(`${dataset} row ${index + 2}: duplicate ${label}.`);
    seen.add(key);
  });
}

function buildMigrationPlan(source) {
  assertUnique(source.employees, (row) => normalizedKey(row['Employee ID']), 'Employees', 'employee ID');
  assertUnique(source.users, (row) => normalizedKey(row['User ID']), 'Users', 'user ID');
  assertUnique(source.users, (row) => normalizedKey(row.Email), 'Users', 'email');
  assertUniqueOptional(source.users, (row) => normalizedKey(row['Employee ID']), 'Users', 'employee link');
  assertUnique(source.shiftTypes, (row) => normalizedKey(row['Shift Code']), 'Shift Types', 'shift code');
  assertUnique(source.employeeLicenses, (row) => normalizedKey(row['License ID']), 'Employee Licenses', 'license ID');

  const employees = source.employees.map((row, index) => {
    const rowNumber = index + 2;
    const legacyEmployeeId = bounded(row['Employee ID'], 100, 'Employees', rowNumber, 'Employee ID', { required: true });
    const displayName = bounded(row.Name, 255, 'Employees', rowNumber, 'Name', { required: true });
    return {
      legacyEmployeeId,
      employeeCode: bounded(legacyEmployeeId, 50, 'Employees', rowNumber, 'Employee ID', { required: true }),
      displayName,
      ...splitName(displayName),
      department: bounded(row.Department, 100, 'Employees', rowNumber, 'Department'),
      jobTitle: bounded(row.Position, 100, 'Employees', rowNumber, 'Position'),
      skill: bounded(row.Skill, 255, 'Employees', rowNumber, 'Skill'),
      isActive: clean(row.Status).toLowerCase() === 'active'
    };
  });
  const employeeByLegacyId = new Map(employees.map((item) => [normalizedKey(item.legacyEmployeeId), item]));
  const employeeByName = new Map();
  employees.forEach((item) => {
    const key = normalizedKey(item.displayName);
    const matches = employeeByName.get(key) || [];
    matches.push(item);
    employeeByName.set(key, matches);
  });

  const users = source.users.map((row, index) => {
    const rowNumber = index + 2;
    const accountStatus = mapAccountStatus(row.Status, rowNumber);
    const role = mapRole(row.Role, accountStatus, rowNumber);
    const employeeLegacyId = nullable(row['Employee ID']);
    if (employeeLegacyId && !employeeByLegacyId.has(normalizedKey(employeeLegacyId))) throw new Error(`Users row ${rowNumber}: employee reference was not found.`);
    const legacyHash = required(row['Password Hash'], 'Users', rowNumber, 'Password Hash');
    if (!/^[a-f0-9]{64}$/i.test(legacyHash)) throw new Error(`Users row ${rowNumber}: unsupported legacy password hash format.`);
    return {
      legacyUserId: bounded(row['User ID'], 100, 'Users', rowNumber, 'User ID', { required: true }),
      displayName: bounded(row.Name, 150, 'Users', rowNumber, 'Name', { required: true }),
      email: bounded(row.Email, 255, 'Users', rowNumber, 'Email', { required: true }).toLowerCase(),
      ...role,
      accountStatus,
      isActive: accountStatus === 'ACTIVE',
      passwordResetRequired: true,
      department: bounded(row.Department, 100, 'Users', rowNumber, 'Department'),
      requestedAt: parseLegacyDate(row['Requested At'], `Users row ${rowNumber} Requested At`),
      approvedByLegacyRef: bounded(row['Approved By'], 255, 'Users', rowNumber, 'Approved By'),
      approvedAt: parseLegacyDate(row['Approved At'], `Users row ${rowNumber} Approved At`),
      rejectionReason: bounded(row['Rejection Reason'], 2000, 'Users', rowNumber, 'Rejection Reason'),
      legacyUpdatedAt: parseLegacyDate(row['Updated At'], `Users row ${rowNumber} Updated At`),
      lastLoginAt: parseLegacyDate(row['Last Login At'], `Users row ${rowNumber} Last Login At`),
      employeeLegacyId
    };
  });

  const shiftTypes = source.shiftTypes.map((row, index) => {
    const rowNumber = index + 2;
    return {
      code: bounded(row['Shift Code'], 50, 'Shift Types', rowNumber, 'Shift Code', { required: true }),
      name: bounded(row['Shift Name'], 150, 'Shift Types', rowNumber, 'Shift Name', { required: true }),
      startTime: bounded(row['Start Time'], 20, 'Shift Types', rowNumber, 'Start Time'),
      endTime: bounded(row['End Time'], 20, 'Shift Types', rowNumber, 'End Time'),
      hours: decimal(row.Hours, 'Shift Types', rowNumber, 'Hours'),
      color: bounded(row.Color, 50, 'Shift Types', rowNumber, 'Color')
    };
  });
  const shiftCodeSet = new Set(shiftTypes.map((item) => normalizedKey(item.code)));

  const scheduleKeys = new Set();
  const shiftAssignments = source.schedule.map((row, index) => {
    const rowNumber = index + 2;
    const employeeLegacyId = required(row['Employee ID'], 'Schedule', rowNumber, 'Employee ID');
    const shiftCode = required(row['Shift Code'], 'Schedule', rowNumber, 'Shift Code');
    if (!employeeByLegacyId.has(normalizedKey(employeeLegacyId))) throw new Error(`Schedule row ${rowNumber}: employee reference was not found.`);
    if (!shiftCodeSet.has(normalizedKey(shiftCode))) throw new Error(`Schedule row ${rowNumber}: shift type reference was not found.`);
    const workDate = parseLegacyDate(row.Date, `Schedule row ${rowNumber} Date`, { required: true, dateOnly: true });
    const uniqueKey = `${workDate.toISOString().slice(0, 10)}|${normalizedKey(employeeLegacyId)}`;
    if (scheduleKeys.has(uniqueKey)) throw new Error(`Schedule row ${rowNumber}: duplicate employee/date assignment.`);
    scheduleKeys.add(uniqueKey);
    return {
      employeeLegacyId,
      shiftCode,
      workDate,
      employeeNameSnapshot: bounded(row['Employee Name'], 255, 'Schedule', rowNumber, 'Employee Name', { required: true }),
      departmentSnapshot: bounded(row.Department, 100, 'Schedule', rowNumber, 'Department'),
      startTime: bounded(row['Start Time'], 20, 'Schedule', rowNumber, 'Start Time'),
      endTime: bounded(row['End Time'], 20, 'Schedule', rowNumber, 'End Time'),
      hours: decimal(row.Hours, 'Schedule', rowNumber, 'Hours'),
      remark: bounded(row.Remark, 2000, 'Schedule', rowNumber, 'Remark'),
      source: bounded(row.Source, 100, 'Schedule', rowNumber, 'Source'),
      locked: boolean(row.Locked, 'Schedule', rowNumber, 'Locked'),
      updatedByLegacyRef: bounded(row['Updated By'], 255, 'Schedule', rowNumber, 'Updated By'),
      legacyUpdatedAt: parseLegacyDate(row['Updated At'], `Schedule row ${rowNumber} Updated At`),
      licenseStatus: bounded(row['License Status'], 100, 'Schedule', rowNumber, 'License Status'),
      licenseExpiryDate: parseLegacyDate(row['License Expiry Date'], `Schedule row ${rowNumber} License Expiry Date`, { dateOnly: true }),
      licenseOverride: boolean(row['License Override'], 'Schedule', rowNumber, 'License Override'),
      overrideReason: bounded(row['Override Reason'], 2000, 'Schedule', rowNumber, 'Override Reason'),
      overrideByLegacyRef: bounded(row['Override By'], 255, 'Schedule', rowNumber, 'Override By'),
      overrideAt: parseLegacyDate(row['Override At'], `Schedule row ${rowNumber} Override At`)
    };
  });

  const employeeLicenses = source.employeeLicenses.map((row, index) => {
    const rowNumber = index + 2;
    const employeeLegacyId = required(row['Employee ID'], 'Employee Licenses', rowNumber, 'Employee ID');
    if (!employeeByLegacyId.has(normalizedKey(employeeLegacyId))) throw new Error(`Employee Licenses row ${rowNumber}: employee reference was not found.`);
    return {
      legacyLicenseId: bounded(row['License ID'], 100, 'Employee Licenses', rowNumber, 'License ID', { required: true }),
      employeeLegacyId,
      licenseType: bounded(row['License Type'], 150, 'Employee Licenses', rowNumber, 'License Type', { required: true }),
      licenseNumber: bounded(row['License Number'], 255, 'Employee Licenses', rowNumber, 'License Number'),
      issueDate: parseLegacyDate(row['Issue Date'], `Employee Licenses row ${rowNumber} Issue Date`, { dateOnly: true }),
      expiryDate: parseLegacyDate(row['Expiry Date'], `Employee Licenses row ${rowNumber} Expiry Date`, { dateOnly: true }),
      status: bounded(row.Status, 100, 'Employee Licenses', rowNumber, 'Status'),
      documentUrl: bounded(row['Document URL'], 2000, 'Employee Licenses', rowNumber, 'Document URL'),
      documentMigrationStatus: clean(row['Document URL']) ? 'LEGACY_REFERENCE_PENDING' : 'NONE',
      remark: bounded(row.Remark, 2000, 'Employee Licenses', rowNumber, 'Remark'),
      updatedByLegacyRef: bounded(row['Updated By'], 255, 'Employee Licenses', rowNumber, 'Updated By'),
      legacyUpdatedAt: parseLegacyDate(row['Updated At'], `Employee Licenses row ${rowNumber} Updated At`)
    };
  });

  const leaveRequests = source.leave.map((row, index) => {
    const rowNumber = index + 2;
    const name = required(row['ชื่อ-นามสกุล'], 'Leave', rowNumber, 'employee name');
    const matches = employeeByName.get(normalizedKey(name)) || [];
    if (matches.length !== 1) throw new Error(`Leave row ${rowNumber}: employee name did not match exactly one employee.`);
    return {
      sourceFingerprint: fingerprint('leave', { ...row, __sourceRowNumber: rowNumber }),
      employeeLegacyId: matches[0].legacyEmployeeId,
      requestedAt: parseLegacyDate(row.Timestamp, `Leave row ${rowNumber} Timestamp`, { required: true }),
      employeeNameSnapshot: bounded(name, 255, 'Leave', rowNumber, 'employee name', { required: true }),
      departmentSnapshot: bounded(row['แผนก'], 100, 'Leave', rowNumber, 'department'),
      leaveType: bounded(row['ประเภทการลา'], 100, 'Leave', rowNumber, 'leave type', { required: true }),
      startDate: parseLegacyDate(row['วันเริ่มต้น'], `Leave row ${rowNumber} start date`, { required: true, dateOnly: true }),
      endDate: parseLegacyDate(row['วันสิ้นสุด'], `Leave row ${rowNumber} end date`, { required: true, dateOnly: true }),
      dayCount: decimal(row['จำนวนวัน'], 'Leave', rowNumber, 'day count'),
      reason: bounded(row['เหตุผล'], 2000, 'Leave', rowNumber, 'reason'),
      attachmentUrl: bounded(row['ไฟล์แนบ'], 2000, 'Leave', rowNumber, 'attachment'),
      attachmentMigrationStatus: clean(row['ไฟล์แนบ']) ? 'LEGACY_REFERENCE_PENDING' : 'NONE',
      status: bounded(row['สถานะ'], 100, 'Leave', rowNumber, 'status', { required: true }),
      approvedByLegacyRef: bounded(row['ผู้อนุมัติ'], 255, 'Leave', rowNumber, 'approver'),
      approvedAt: parseLegacyDate(row['วันเวลาที่อนุมัติ'], `Leave row ${rowNumber} approved at`)
    };
  });

  const quotaNameCounts = new Map();
  source.quota.forEach((row) => quotaNameCounts.set(normalizedKey(row['ชื่อพนักงาน']), (quotaNameCounts.get(normalizedKey(row['ชื่อพนักงาน'])) || 0) + 1));
  const leaveQuotas = source.quota.map((row, index) => {
    const rowNumber = index + 2;
    const name = required(row['ชื่อพนักงาน'], 'Quota', rowNumber, 'employee name');
    const matches = employeeByName.get(normalizedKey(name)) || [];
    const duplicate = quotaNameCounts.get(normalizedKey(name)) > 1;
    return {
      sourceFingerprint: fingerprint('quota', { ...row, __sourceRowNumber: rowNumber }),
      employeeLegacyId: matches.length === 1 ? matches[0].legacyEmployeeId : null,
      employeeNameSnapshot: bounded(name, 255, 'Quota', rowNumber, 'employee name', { required: true }),
      sickLeave: decimal(row['ลาป่วย'], 'Quota', rowNumber, 'sick leave', { defaultValue: 0 }),
      personalLeave: decimal(row['ลากิจ'], 'Quota', rowNumber, 'personal leave', { defaultValue: 0 }),
      vacationLeave: decimal(row['ลาพักร้อน'], 'Quota', rowNumber, 'vacation leave', { defaultValue: 0 }),
      matchStatus: matches.length === 1 ? (duplicate ? 'DUPLICATE_MATCHED' : 'MATCHED') : (duplicate ? 'DUPLICATE_UNMATCHED' : 'UNMATCHED')
    };
  });

  const scheduleApprovals = source.scheduleApprovals.map((row, index) => {
    const rowNumber = index + 2;
    return {
      month: parseMonth(row.Month, `Schedule Approvals row ${rowNumber} Month`),
      status: bounded(row.Status, 100, 'Schedule Approvals', rowNumber, 'Status', { required: true }),
      revision: integer(row.Revision, 'Schedule Approvals', rowNumber, 'Revision', { defaultValue: 0 }),
      changedByLegacyRef: bounded(row['Changed By'], 255, 'Schedule Approvals', rowNumber, 'Changed By'),
      changedAt: parseLegacyDate(row['Changed At'], `Schedule Approvals row ${rowNumber} Changed At`),
      changeType: bounded(row['Change Type'], 100, 'Schedule Approvals', rowNumber, 'Change Type'),
      approvedByLegacyRef: bounded(row['Approved By'], 255, 'Schedule Approvals', rowNumber, 'Approved By'),
      approvedAt: parseLegacyDate(row['Approved At'], `Schedule Approvals row ${rowNumber} Approved At`),
      approvalNote: bounded(row['Approval Note'], 2000, 'Schedule Approvals', rowNumber, 'Approval Note'),
      scheduleHash: bounded(row['Schedule Hash'], 255, 'Schedule Approvals', rowNumber, 'Schedule Hash')
    };
  });
  assertUnique(scheduleApprovals, (row) => `${row.month.toISOString()}|${row.revision}`, 'Schedule Approvals', 'month/revision');

  const scheduleApprovalEvents = source.scheduleApprovalLog.map((row, index) => {
    const rowNumber = index + 2;
    return {
      sourceFingerprint: fingerprint('schedule-approval-event', { ...row, __sourceRowNumber: rowNumber }),
      occurredAt: parseLegacyDate(row.Timestamp, `Schedule Approval Log row ${rowNumber} Timestamp`, { required: true }),
      action: bounded(row.Action, 100, 'Schedule Approval Log', rowNumber, 'Action', { required: true }),
      month: parseMonth(row.Month, `Schedule Approval Log row ${rowNumber} Month`),
      revision: integer(row.Revision, 'Schedule Approval Log', rowNumber, 'Revision', { defaultValue: 0 }),
      status: bounded(row.Status, 100, 'Schedule Approval Log', rowNumber, 'Status'),
      changeType: bounded(row['Change Type'], 100, 'Schedule Approval Log', rowNumber, 'Change Type'),
      performedByLegacyRef: bounded(row['Performed By'], 255, 'Schedule Approval Log', rowNumber, 'Performed By'),
      note: bounded(row.Note, 2000, 'Schedule Approval Log', rowNumber, 'Note')
    };
  });

  const rules = source.rules.map((row, index) => {
    const rowNumber = index + 2;
    return {
      ruleId: bounded(row['Rule ID'], 100, 'Rules', rowNumber, 'Rule ID', { required: true }),
      name: bounded(row['Rule Name'], 255, 'Rules', rowNumber, 'Rule Name', { required: true }),
      value: bounded(row.Value, 1000, 'Rules', rowNumber, 'Value', { required: true }),
      unit: bounded(row.Unit, 100, 'Rules', rowNumber, 'Unit'),
      enabled: boolean(row.Enabled, 'Rules', rowNumber, 'Enabled', { defaultValue: true })
    };
  });
  assertUnique(rules, (row) => normalizedKey(row.ruleId), 'Rules', 'rule ID');

  const indexedSettings = source.settings.map((row, index) => ({ row, rowNumber: index + 2 }));
  const excludedExternalSettings = indexedSettings.filter(({ row }) => /^https?:\/\//i.test(clean(row.Value)));
  const settings = indexedSettings.filter(({ row }) => !/^https?:\/\//i.test(clean(row.Value))).map(({ row, rowNumber }) => {
    return {
      key: bounded(row.Key, 150, 'Settings', rowNumber, 'Key', { required: true }),
      value: bounded(row.Value, 2000, 'Settings', rowNumber, 'Value', { required: true }),
      description: bounded(row.Description, 2000, 'Settings', rowNumber, 'Description')
    };
  });
  assertUnique(settings, (row) => normalizedKey(row.key), 'Settings', 'key');

  const userAuditEvents = source.userAudit.map((row, index) => {
    const rowNumber = index + 2;
    return {
      sourceFingerprint: fingerprint('user-audit-event', { ...row, __sourceRowNumber: rowNumber }),
      occurredAt: parseLegacyDate(row.Timestamp, `User Audit Log row ${rowNumber} Timestamp`, { required: true }),
      action: bounded(row.Action, 100, 'User Audit Log', rowNumber, 'Action', { required: true }),
      legacyUserId: bounded(row['User ID'], 100, 'User Audit Log', rowNumber, 'User ID'),
      emailSnapshot: bounded(row.Email, 255, 'User Audit Log', rowNumber, 'Email'),
      roleSnapshot: bounded(row.Role, 50, 'User Audit Log', rowNumber, 'Role'),
      departmentSnapshot: bounded(row.Department, 100, 'User Audit Log', rowNumber, 'Department'),
      reason: bounded(row.Reason, 2000, 'User Audit Log', rowNumber, 'Reason'),
      performedByLegacyRef: bounded(row['Performed By'], 255, 'User Audit Log', rowNumber, 'Performed By'),
      legacyEmployeeId: bounded(row['Employee ID'], 100, 'User Audit Log', rowNumber, 'Employee ID')
    };
  });

  const licenseAuditEvents = source.licenseAudit.map((row, index) => {
    const rowNumber = index + 2;
    return {
      sourceFingerprint: fingerprint('license-audit-event', { ...row, __sourceRowNumber: rowNumber }),
      occurredAt: parseLegacyDate(row.Timestamp, `License Audit Log row ${rowNumber} Timestamp`, { required: true }),
      action: bounded(row.Action, 100, 'License Audit Log', rowNumber, 'Action', { required: true }),
      legacyEmployeeId: bounded(row['Employee ID'], 100, 'License Audit Log', rowNumber, 'Employee ID'),
      legacyLicenseId: bounded(row['License ID'], 100, 'License Audit Log', rowNumber, 'License ID'),
      workDate: parseLegacyDate(row['Work Date'], `License Audit Log row ${rowNumber} Work Date`, { dateOnly: true }),
      shiftCode: bounded(row['Shift Code'], 50, 'License Audit Log', rowNumber, 'Shift Code'),
      licenseStatus: bounded(row['License Status'], 100, 'License Audit Log', rowNumber, 'License Status'),
      expiryDate: parseLegacyDate(row['Expiry Date'], `License Audit Log row ${rowNumber} Expiry Date`, { dateOnly: true }),
      reason: bounded(row.Reason, 2000, 'License Audit Log', rowNumber, 'Reason'),
      approvedByLegacyRef: bounded(row['Approved By'], 255, 'License Audit Log', rowNumber, 'Approved By')
    };
  });

  const quotaIssues = leaveQuotas.reduce((result, row) => {
    if (row.matchStatus.includes('UNMATCHED')) result.unmatched += 1;
    if (row.matchStatus.includes('DUPLICATE')) result.duplicate += 1;
    return result;
  }, { unmatched: 0, duplicate: 0 });

  return {
    employees,
    users,
    shiftTypes,
    shiftAssignments,
    employeeLicenses,
    leaveRequests,
    leaveQuotas,
    scheduleApprovals,
    scheduleApprovalEvents,
    rules,
    settings,
    userAuditEvents,
    licenseAuditEvents,
    summary: {
      employees: employees.length,
      users: users.length,
      usersRequiringPasswordReset: users.length,
      shiftTypes: shiftTypes.length,
      shiftAssignments: shiftAssignments.length,
      employeeLicenses: employeeLicenses.length,
      leaveRequests: leaveRequests.length,
      leaveQuotas: leaveQuotas.length,
      scheduleApprovals: scheduleApprovals.length,
      scheduleApprovalEvents: scheduleApprovalEvents.length,
      userAuditEvents: userAuditEvents.length,
      licenseAuditEvents: licenseAuditEvents.length,
      rules: rules.length,
      settings: settings.length,
      settingsExcludedExternalReferences: excludedExternalSettings.length,
      licenseDocumentReferencesPending: employeeLicenses.filter((row) => row.documentMigrationStatus === 'LEGACY_REFERENCE_PENDING').length,
      leaveAttachmentReferencesPending: leaveRequests.filter((row) => row.attachmentMigrationStatus === 'LEGACY_REFERENCE_PENDING').length,
      quotaUnmatched: quotaIssues.unmatched,
      quotaDuplicateRows: quotaIssues.duplicate,
      dashboardRowsIgnoredAsDerivedData: source.dashboard.length
    }
  };
}

module.exports = {
  buildMigrationPlan,
  parseLegacyDate,
  parseMonth,
  normalizedKey,
  fingerprint
};
