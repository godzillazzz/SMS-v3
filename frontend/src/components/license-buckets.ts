/* License status buckets for the filter chips (UI Redesign 06 / W-08). Client-side over the rows already loaded;
   thresholds 0-30 and 31-90 days follow the W-08 wireframe. No new API. */
export type LicenseBucket = 'ALL' | 'EXP_30' | 'EXP_90' | 'EXPIRED' | 'DOC_PENDING' | 'DOC_RETURNED';

export const LICENSE_BUCKETS: Array<{ value: LicenseBucket; label: string }> = [
  { value: 'ALL', label: 'ทั้งหมด' },
  { value: 'EXP_30', label: 'ใกล้หมดอายุ 0–30 วัน' },
  { value: 'EXP_90', label: '31–90 วัน' },
  { value: 'EXPIRED', label: 'หมดอายุ' },
  { value: 'DOC_PENDING', label: 'รอตรวจเอกสาร' },
  { value: 'DOC_RETURNED', label: 'ส่งกลับแก้ไข' }
];

type Row = { expiryDate?: unknown; status?: unknown; documentSummary?: unknown };

export function licenseBuckets(row: Row, now = new Date()): Set<LicenseBucket> {
  const buckets = new Set<LicenseBucket>(['ALL']);
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiry = /^\d{4}-\d{2}-\d{2}/.exec(String(row.expiryDate || ''))?.[0];
  const status = String(row.status || '').toUpperCase();
  if (status === 'EXPIRED') buckets.add('EXPIRED');
  if (expiry) {
    const days = Math.round((Date.parse(`${expiry}T00:00:00Z`) - today) / 86_400_000);
    if (days < 0) buckets.add('EXPIRED');
    else if (days <= 30) buckets.add('EXP_30');
    else if (days <= 90) buckets.add('EXP_90');
  }
  const state = String((row.documentSummary as { state?: unknown } | undefined)?.state || '').toUpperCase();
  if (state === 'PENDING' || state === 'CURRENT_WITH_PENDING') buckets.add('DOC_PENDING');
  if (state === 'RETURNED_FOR_CORRECTION' || state === 'CURRENT_WITH_RETURNED') buckets.add('DOC_RETURNED');
  return buckets;
}

export function countLicenseBuckets(rows: Row[], now = new Date()): Record<LicenseBucket, number> {
  const counts = { ALL: 0, EXP_30: 0, EXP_90: 0, EXPIRED: 0, DOC_PENDING: 0, DOC_RETURNED: 0 } as Record<LicenseBucket, number>;
  for (const row of rows) for (const bucket of licenseBuckets(row, now)) counts[bucket] += 1;
  return counts;
}
