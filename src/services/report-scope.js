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

function resolveDepartmentScope(requestUser, requestedDepartment) {
  const role = String(requestUser?.role || '').toUpperCase();
  if (role === 'ADMIN') {
    const department = requestedDepartment ? String(requestedDepartment).trim() : null;
    return { department, departments: departmentValues(department), employeeId: null, label: department || 'ทุกหน่วยงาน', allowsDepartmentFilter: true };
  }
  if (!['MANAGER', 'SUPERVISOR'].includes(role) || !departmentValues(requestUser?.department).length) {
    throw new HttpError(403, 'Department report scope is required.');
  }
  if (requestedDepartment) {
    const requestedValues = departmentValues(requestedDepartment);
    const ownValues = departmentValues(requestUser.department);
    if (requestedValues.some((value) => !ownValues.includes(value))) throw new HttpError(403, 'Department report scope is not permitted.');
  }
  const department = String(requestUser.department).trim();
  return {
    department,
    departments: departmentValues(department),
    employeeId: null,
    label: department,
    allowsDepartmentFilter: false
  };
}

module.exports = { departmentValues, departmentMatches, scopedDepartmentValues, departmentWhere, resolveDepartmentScope };
