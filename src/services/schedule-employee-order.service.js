'use strict';

const departmentCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const employeeCodeCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

function compareScheduleDepartmentNames(left, right) {
  const leftDepartment = String(left ?? '').trim();
  const rightDepartment = String(right ?? '').trim();
  if (leftDepartment && !rightDepartment) return -1;
  if (!leftDepartment && rightDepartment) return 1;
  return departmentCollator.compare(leftDepartment, rightDepartment);
}

function compareScheduleEmployeesByDepartment(left, right) {
  const department = compareScheduleDepartmentNames(left.department, right.department);
  if (department) return department;

  const code = employeeCodeCollator.compare(String(left.employeeCode ?? ''), String(right.employeeCode ?? ''));
  if (code) return code;
  return String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en');
}

module.exports = { compareScheduleDepartmentNames, compareScheduleEmployeesByDepartment };
