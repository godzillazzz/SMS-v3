/** One employee-code ordering rule for the interactive roster and printed schedule.
 * Numeric collation sorts ST-2 before ST-10, independent of legacy custom roster positions.
 */
const employeeCodeCollator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

export function sortScheduleEmployeesByCode<T extends { employeeCode?: unknown; id?: unknown }>(employees: readonly T[]): T[] {
  return [...employees].sort((left, right) => {
    const code = employeeCodeCollator.compare(String(left.employeeCode ?? ''), String(right.employeeCode ?? ''));
    if (code) return code;
    return String(left.id ?? '').localeCompare(String(right.id ?? ''), 'en');
  });
}