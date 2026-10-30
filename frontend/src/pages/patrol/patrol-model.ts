export const PATROL_QR_PREFIX = 'SMSPATROL1:';

export type PatrolCheckpoint = {
  id: string;
  code: string;
  name: string;
  department: string;
  locationNote?: string | null;
  sortOrder?: number;
  isActive: boolean;
  qrVersion: number;
  qrRotatedAt?: string | null;
  qrPayload?: string;
};

export type PatrolScan = {
  id: string;
  checkpointId: string;
  checkpointCode?: string | null;
  checkpointName?: string | null;
  checkpointDepartment: string;
  employeeId: string;
  employeeCode?: string | null;
  employeeName?: string | null;
  employeeDepartment?: string | null;
  scannedAt: string;
  workDate: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
  note?: string | null;
  photoUrl: string;
  replayed?: boolean;
};

export type PatrolCoverageCell = { count: number; lastScanAt?: string | null; lastEmployeeName?: string | null; lastEmployeeCode?: string | null };
export type PatrolCoverageCheckpoint = { id: string; code: string; name: string; locationNote?: string | null; days: Record<string, PatrolCoverageCell>; scannedDays: number };
export type PatrolCoverageDepartment = { department: string; checkpoints: PatrolCoverageCheckpoint[]; total: number; scanned: number };
export type PatrolReport = {
  from: string;
  to: string;
  department?: string | null;
  generatedAt: string;
  coverage: { dates: string[]; departments: PatrolCoverageDepartment[]; summary: { checkpoints: number; scanned: number; pending: number; scans: number; percent: number } };
  scans: PatrolScan[];
};

export function parsePatrolQr(value: string): string | null {
  const raw = String(value || '').trim();
  if (!raw.startsWith(PATROL_QR_PREFIX)) return null;
  return /^[A-Za-z0-9_-]{20,64}$/.test(raw.slice(PATROL_QR_PREFIX.length)) ? raw : null;
}

export function patrolDatesBetween(from: string, to: string): string[] {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];
  const dates: string[] = [];
  for (let time = start.getTime(); time <= end.getTime(); time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
}

export type PatrolCellTone = 'done' | 'missed' | 'pending' | 'future';

export function coverageCellTone(cell: Pick<PatrolCoverageCell, 'count'> | undefined, date: string, today: string): PatrolCellTone {
  if (cell && cell.count > 0) return 'done';
  if (date > today) return 'future';
  if (date === today) return 'pending';
  return 'missed';
}

export function formatPatrolPercent(value: number): string {
  return `${Math.round(Number.isFinite(value) ? value : 0)}%`;
}

export function summarizeByDepartment(departments: Array<Pick<PatrolCoverageDepartment, 'department' | 'total' | 'scanned'>>) {
  return departments.map((item) => ({
    department: item.department,
    total: item.total,
    scanned: item.scanned,
    pending: Math.max(0, item.total - item.scanned),
    percent: item.total ? Math.round((item.scanned / item.total) * 100) : 0
  }));
}

export function bangkokToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function thaiDate(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH-u-ca-buddhist', { timeZone: 'UTC', ...options }).format(date);
}

export function thaiTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
}
