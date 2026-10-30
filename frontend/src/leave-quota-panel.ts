type Summary = Record<string, unknown>;
const record = (value: unknown): Summary => value && typeof value === 'object' ? value as Summary : {};
const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export function leaveQuotaRows(summary: Summary) {
  return ([['ลาป่วย', 'sickLeave'], ['ลากิจ', 'personalLeave'], ['ลาพักร้อน', 'vacationLeave']] as const).map(([label, key]) => {
    const entitlement = number(record(summary.entitlement)[key]);
    const used = number(record(summary.used)[key]);
    const remaining = number(record(summary.remaining)[key]);
    const percent = entitlement !== null && entitlement > 0 && remaining !== null ? Math.max(0, Math.min(100, remaining / entitlement * 100)) : null;
    return { label, entitlement, used, remaining, percent };
  });
}
