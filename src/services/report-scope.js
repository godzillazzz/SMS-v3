'use strict';

const HttpError = require('../utils/http-error');

function departmentValues(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(source.map((item) => String(item || '').trim()).filter(Boolean))];
}

function departmentMatches(source, candidate) {
  const candidateValue = String(candidate || '').trim();
  if (!candidateValue) return false;
  return departmentValues(source).includes(candidateValue);
}

// Exact per-value tokens only (same rule as patrol progress): "AN1,AN2" never matches "AN10" by substring.
function scopedDepartmentValues(scope) {
  if (!scope?.department) return [];
  return departmentValues(scope.department);
}

function departmentWhere(scope) {
  const values = scopedDepartmentValues(scope);
  if (!values.length) throw new HttpError(403, 'Department report scope is required.');
  return values.length === 1 ? values[0] : { in: values };
}

// OWNER policy 2026-10-30 (and 18 Oct 2026 "MANAGER/SUPERVISOR are cross-department executives"): a
// department is only a place of work. ADMIN, MANAGER and SUPERVISOR all read every department and may
// optionally filter by one; an own department is not required. Any other role has no report scope.
const REPORT_SCOPE_ROLES = new Set(['ADMIN', 'MANAGER', 'SUPERVISOR']);

function resolveDepartmentScope(requestUser, requestedDepartment) {
  const role = String(requestUser?.role || '').toUpperCase();
  if (!REPORT_SCOPE_ROLES.has(role)) throw new HttpError(403, 'Department report scope is required.');
  const department = requestedDepartment ? String(requestedDepartment).trim() || null : null;
  return { department, departments: departmentValues(department), employeeId: null, label: department || 'ทุกหน่วยงาน', allowsDepartmentFilter: true };
}

module.exports = { departmentValues, departmentMatches, scopedDepartmentValues, departmentWhere, resolveDepartmentScope };
