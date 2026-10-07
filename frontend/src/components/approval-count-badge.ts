export function approvalCountValue(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const count = typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(count) && count >= 0 ? count : null;
}

export function approvalBadgeText(count: number | null | undefined): string | undefined {
  if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) return undefined;
  return count > 99 ? '99+' : String(count);
}

export function approvalNotificationLabel(count: number | null | undefined): string {
  return typeof count === 'number' && Number.isFinite(count)
    ? `คำขออนุมัติ ${count} รายการ`
    : 'เปิดศูนย์อนุมัติ';
}
