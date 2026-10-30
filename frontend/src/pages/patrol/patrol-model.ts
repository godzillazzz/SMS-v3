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
  rounds?: { config: { perDay: number; hours: number; startHour: number; timeZone: string }; byCheckpoint: Record<string, Record<string, number[]>> };
  scans: PatrolScan[];
  /** Scans grouped by 07:00–07:00 patrol day (includes after-midnight rounds). */
  patrolScans?: PatrolScan[];
};

export type PatrolProgress = {
  patrolDay: string;
  round: number;
  rounds: number;
  roundLabel: string;
  roundStart: string;
  roundEnd: string;
  department: string | null;
  departments: string[];
  checkpoints: Array<{ id: string; code: string; name: string; locationNote?: string | null; doneThisRound: boolean; lastScanAt: string | null; scannedByMe: boolean }>;
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

// ---- Patrol rounds -------------------------------------------------------
// Owner design (30 Oct 2026): a patrol day runs 07:00–07:00 Asia/Bangkok and is
// split into 8 rounds of 3 hours. A checkpoint is "done" for a round when it was
// scanned at least once inside that window; extra scans keep their photos but count once.
export const PATROL_ROUNDS = 8;
export const PATROL_ROUND_HOURS = 3;
export const PATROL_DAY_START_HOUR = 7;
const BANGKOK_OFFSET_MS = 7 * 3_600_000;
const HOUR_MS = 3_600_000;

export type PatrolRoundWindow = { round: number; label: string; start: string; end: string };
export type PatrolRoundTone = 'done' | 'current' | 'missed' | 'upcoming';
export type PatrolRoundCell = { round: number; tone: PatrolRoundTone; count: number; scans: PatrolScan[]; lastScanAt: string | null; lastEmployeeName: string | null };
export type PatrolRoundRow = { id: string; code: string; name: string; locationNote?: string | null; cells: PatrolRoundCell[]; done: number; due: number };
export type PatrolRoundBoard = {
  day: string;
  windows: PatrolRoundWindow[];
  rows: PatrolRoundRow[];
  rounds: Array<{ round: number; done: number; total: number }>;
  summary: { checkpoints: number; due: number; done: number; missed: number; percent: number; currentRound: number | null };
};

function pad(value: number) { return String(value).padStart(2, '0'); }

/** UTC instant of 07:00 Bangkok on the given patrol day. */
function patrolDayStartMs(day: string) {
  return Date.parse(`${day}T00:00:00.000Z`) + PATROL_DAY_START_HOUR * HOUR_MS - BANGKOK_OFFSET_MS;
}

export function patrolRoundWindows(day: string): PatrolRoundWindow[] {
  const start = patrolDayStartMs(day);
  return Array.from({ length: PATROL_ROUNDS }, (_, index) => {
    const fromHour = (PATROL_DAY_START_HOUR + index * PATROL_ROUND_HOURS) % 24;
    const toHour = (fromHour + PATROL_ROUND_HOURS) % 24;
    return {
      round: index + 1,
      label: `${pad(fromHour)}:00–${pad(toHour)}:00`,
      start: new Date(start + index * PATROL_ROUND_HOURS * HOUR_MS).toISOString(),
      end: new Date(start + (index + 1) * PATROL_ROUND_HOURS * HOUR_MS).toISOString()
    };
  });
}

/** Patrol day (07:00–07:00 Bangkok) that contains the instant. */
export function patrolDayOf(instant: Date): string {
  return new Date(instant.getTime() + BANGKOK_OFFSET_MS - PATROL_DAY_START_HOUR * HOUR_MS).toISOString().slice(0, 10);
}

export function patrolRoundOf(value: string | Date): { day: string; round: number } | null {
  const time = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(time)) return null;
  const day = patrolDayOf(new Date(time));
  const round = Math.floor((time - patrolDayStartMs(day)) / (PATROL_ROUND_HOURS * HOUR_MS)) + 1;
  return { day, round };
}

export function currentPatrolRound(now = new Date()) {
  const position = patrolRoundOf(now)!;
  const window = patrolRoundWindows(position.day)[position.round - 1];
  return { ...position, label: window.label, minutesLeft: Math.max(0, Math.ceil((Date.parse(window.end) - now.getTime()) / 60_000)) };
}

export function buildRoundBoard({ day, now = new Date(), checkpoints, scans }: { day: string; now?: Date; checkpoints: Array<{ id: string; code: string; name: string; locationNote?: string | null }>; scans: PatrolScan[] }): PatrolRoundBoard {
  const windows = patrolRoundWindows(day);
  const nowMs = now.getTime();
  const toneFor = (window: PatrolRoundWindow, count: number): PatrolRoundTone => {
    if (count > 0) return 'done';
    if (nowMs >= Date.parse(window.end)) return 'missed';
    if (nowMs >= Date.parse(window.start)) return 'current';
    return 'upcoming';
  };
  const byKey = new Map<string, PatrolScan[]>();
  for (const item of scans) {
    const position = patrolRoundOf(item.scannedAt);
    if (!position || position.day !== day) continue;
    const key = `${item.checkpointId}:${position.round}`;
    byKey.set(key, [...(byKey.get(key) || []), item]);
  }
  const rows = checkpoints.map((checkpoint) => {
    const cells = windows.map((window) => {
      const list = (byKey.get(`${checkpoint.id}:${window.round}`) || []).slice().sort((a, b) => a.scannedAt.localeCompare(b.scannedAt));
      const last = list[list.length - 1];
      return { round: window.round, tone: toneFor(window, list.length), count: list.length, scans: list, lastScanAt: last?.scannedAt || null, lastEmployeeName: last?.employeeName || null };
    });
    return { ...checkpoint, cells, done: cells.filter((cell) => cell.tone === 'done').length, due: cells.filter((cell) => cell.tone === 'done' || cell.tone === 'missed' || cell.tone === 'current').length };
  });
  const rounds = windows.map((window, index) => ({ round: window.round, done: rows.filter((row) => row.cells[index].tone === 'done').length, total: rows.length }));
  const due = rows.reduce((total, row) => total + row.due, 0);
  const done = rows.reduce((total, row) => total + row.done, 0);
  const missed = rows.reduce((total, row) => total + row.cells.filter((cell) => cell.tone === 'missed').length, 0);
  const position = patrolRoundOf(now);
  return {
    day,
    windows,
    rows,
    rounds,
    summary: { checkpoints: rows.length, due, done, missed, percent: due ? Math.round((done / due) * 100) : 0, currentRound: position && position.day === day ? position.round : null }
  };
}

export function patrolFetchRange(from: string, to: string) {
  const next = new Date(Date.parse(`${to}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);
  return { from, to: next };
}

export type PatrolDepartmentStatus = 'complete' | 'progress' | 'missed' | 'empty';
export type PatrolDepartmentRoundSummary = PatrolRoundBoard['summary'] & { department: string; currentDone: number; status: PatrolDepartmentStatus };

export function buildDepartmentRoundSummaries({ day, now = new Date(), checkpoints, scans }: { day: string; now?: Date; checkpoints: Array<{ id: string; code: string; name: string; department: string }>; scans: PatrolScan[] }): PatrolDepartmentRoundSummary[] {
  const departments = [...new Set(checkpoints.map((item) => item.department))];
  const rank: Record<PatrolDepartmentStatus, number> = { missed: 0, progress: 1, empty: 2, complete: 3 };
  return departments.map((department) => {
    const board = buildRoundBoard({ day, now, checkpoints: checkpoints.filter((item) => item.department === department), scans });
    const current = board.summary.currentRound ? board.rounds[board.summary.currentRound - 1].done : 0;
    const status: PatrolDepartmentStatus = board.summary.checkpoints === 0 ? 'empty'
      : board.summary.missed > 0 ? 'missed'
        : board.summary.due > 0 && board.summary.done >= board.summary.due ? 'complete'
          : 'progress';
    return { department, ...board.summary, currentDone: current, status };
  }).sort((a, b) => rank[a.status] - rank[b.status] || a.percent - b.percent || a.department.localeCompare(b.department, 'th'));
}

export function roundsByDay({ dates, now = new Date(), checkpoints, scans }: { dates: string[]; now?: Date; checkpoints: Array<{ id: string; code: string; name: string }>; scans: PatrolScan[] }) {
  const table: Record<string, Record<string, { done: number; due: number }>> = {};
  for (const day of dates) {
    const board = buildRoundBoard({ day, now, checkpoints, scans });
    for (const row of board.rows) (table[row.id] ||= {})[day] = { done: row.done, due: row.due };
  }
  return table;
}
