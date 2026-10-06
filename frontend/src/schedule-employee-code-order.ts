/** Numeric-aware schedule ordering, independent of legacy custom roster positions. */
const departmentCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
const employeeCodeCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

type ScheduleEmployeeOrderFields = { department?: unknown; employeeCode?: unknown; id?: unknown };

export type ScheduleEmployeeDepartmentGroup<T extends ScheduleEmployeeOrderFields> = {
  department: string;
  employees: T[];
};

export function sortScheduleEmployeesByDepartment<T extends ScheduleEmployeeOrderFields>(employees: readonly T[]): T[] {
  return [...employees].sort((left, right) => {
    const leftDepartment = String(left.department ?? '').trim();
    const rightDepartment = String(right.department ?? '').trim();
    if (leftDepartment && !rightDepartment) return -1;
    if (!leftDepartment && rightDepartment) return 1;

    const department = leftDepartment && rightDepartment
      ? departmentCollator.compare(leftDepartment, rightDepartment)
      : 0;
    if (department) return department;

    const code = employeeCodeCollator.compare(String(left.employeeCode ?? ''), String(right.employeeCode ?? ''));
    if (code) return code;
    return String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en');
  });
}

export function groupScheduleEmployeesByDepartment<T extends ScheduleEmployeeOrderFields>(employees: readonly T[]): ScheduleEmployeeDepartmentGroup<T>[] {
  const groups: ScheduleEmployeeDepartmentGroup<T>[] = [];
  for (const employee of sortScheduleEmployeesByDepartment(employees)) {
    const department = String(employee.department ?? '').trim();
    const currentGroup = groups[groups.length - 1];
    if (!currentGroup || departmentCollator.compare(currentGroup.department, department) !== 0) {
      groups.push({ department, employees: [employee] });
    } else {
      currentGroup.employees.push(employee);
    }
  }
  return groups;
}

/** Kept for call sites that intentionally sort without department grouping. */

export function sortScheduleEmployeesByCode<T extends { employeeCode?: unknown; id?: unknown }>(employees: readonly T[]): T[] {
  return [...employees].sort((left, right) => {
    const code = employeeCodeCollator.compare(String(left.employeeCode ?? ''), String(right.employeeCode ?? ''));
    if (code) return code;
    return String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en');
  });
}
