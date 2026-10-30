import { describe, expect, it } from 'vitest';
import { PATROL_ROUNDS, buildDepartmentRoundSummaries, buildRoundBoard, patrolFetchRange, roundsByDay, currentPatrolRound, patrolDayOf, patrolRoundOf, patrolRoundWindows, type PatrolScan } from './patrol-model';

const scan = (id: string, checkpointId: string, scannedAt: string, employeeName = 'สมชาย'): PatrolScan => ({ id, checkpointId, checkpointDepartment: 'ANO', employeeId: 'e1', employeeName, scannedAt, workDate: scannedAt.slice(0, 10), photoUrl: `/p/${id}` });

describe('patrol rounds (8 rounds x 3 hours from 07:00 Asia/Bangkok)', () => {
  it('defines eight 3-hour windows for a patrol day that runs 07:00 to 07:00 next day', () => {
    const windows = patrolRoundWindows('2026-10-30');
    expect(PATROL_ROUNDS).toBe(8);
    expect(windows).toHaveLength(8);
    expect(windows[0]).toMatchObject({ round: 1, label: '07:00–10:00', start: '2026-10-30T00:00:00.000Z', end: '2026-10-30T03:00:00.000Z' });
    expect(windows[7]).toMatchObject({ round: 8, label: '04:00–07:00', start: '2026-10-30T21:00:00.000Z', end: '2026-10-31T00:00:00.000Z' });
  });

  it('maps a scan time to its patrol day and round, including after-midnight rounds', () => {
    expect(patrolRoundOf('2026-10-30T00:00:00.000Z')).toEqual({ day: '2026-10-30', round: 1 });
    expect(patrolRoundOf('2026-10-30T02:59:59.000Z')).toEqual({ day: '2026-10-30', round: 1 });
    expect(patrolRoundOf('2026-10-30T06:10:00.000Z')).toEqual({ day: '2026-10-30', round: 3 });
    // 02:30 Bangkok on 31 Oct belongs to round 7 of the 30 Oct patrol day
    expect(patrolRoundOf('2026-10-30T19:30:00.000Z')).toEqual({ day: '2026-10-30', round: 7 });
    expect(patrolDayOf(new Date('2026-10-30T23:59:00.000Z'))).toBe('2026-10-30');
    expect(patrolDayOf(new Date('2026-10-31T00:00:00.000Z'))).toBe('2026-10-31');
  });

  it('reports the current round and minutes remaining', () => {
    expect(currentPatrolRound(new Date('2026-10-30T06:42:00.000Z'))).toEqual({ day: '2026-10-30', round: 3, label: '13:00–16:00', minutesLeft: 138 });
  });

  it('builds a checkpoint x round board with done / current / missed / upcoming cells and counts each round once', () => {
    const board = buildRoundBoard({
      day: '2026-10-30',
      now: new Date('2026-10-30T06:42:00.000Z'),
      checkpoints: [{ id: 'c1', code: 'ANO-01', name: 'ประตู' }, { id: 'c2', code: 'ANO-02', name: 'ลานจอด' }],
      scans: [
        scan('s1', 'c1', '2026-10-30T00:30:00.000Z'),
        scan('s2', 'c1', '2026-10-30T01:00:00.000Z', 'สมหญิง'),
        scan('s3', 'c1', '2026-10-30T06:00:00.000Z'),
        scan('s4', 'c2', '2026-10-30T04:00:00.000Z'),
        scan('s5', 'c1', '2026-10-29T23:00:00.000Z')
      ]
    });
    expect(board.rows[0].cells.map((cell) => cell.tone)).toEqual(['done', 'missed', 'done', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(board.rows[0].cells[0]).toMatchObject({ count: 2, lastEmployeeName: 'สมหญิง' });
    expect(board.rows[1].cells.map((cell) => cell.tone)).toEqual(['missed', 'done', 'current', 'upcoming', 'upcoming', 'upcoming', 'upcoming', 'upcoming']);
    expect(board.rows[0].done).toBe(2);
    expect(board.rounds[0]).toMatchObject({ done: 1, total: 2 });
    expect(board.rounds[2]).toMatchObject({ done: 1, total: 2 });
    expect(board.summary).toEqual({ checkpoints: 2, due: 6, done: 3, missed: 2, percent: 50, currentRound: 3 });
  });

  it('treats every round of a past patrol day as due and none of a future day', () => {
    const past = buildRoundBoard({ day: '2026-10-29', now: new Date('2026-10-30T06:42:00.000Z'), checkpoints: [{ id: 'c1', code: 'A', name: 'A' }], scans: [] });
    expect(past.summary).toMatchObject({ due: 8, done: 0, missed: 8, percent: 0, currentRound: null });
    const future = buildRoundBoard({ day: '2026-10-31', now: new Date('2026-10-30T06:42:00.000Z'), checkpoints: [{ id: 'c1', code: 'A', name: 'A' }], scans: [] });
    expect(future.summary).toMatchObject({ due: 0, missed: 0, percent: 0 });
  });
});

describe('patrol round aggregates', () => {
  const checkpoints = [{ id: 'c1', code: 'ANO-01', name: 'ประตู', department: 'ANO' }, { id: 'c2', code: 'ANO-02', name: 'ลานจอด', department: 'ANO' }, { id: 'c3', code: 'WCS-01', name: 'คลัง', department: 'WCS' }];
  const now = new Date('2026-10-30T06:42:00.000Z');
  const scans = [scan('s1', 'c1', '2026-10-30T00:30:00.000Z'), scan('s2', 'c1', '2026-10-30T06:00:00.000Z'), scan('s3', 'c2', '2026-10-30T04:00:00.000Z')];

  it('fetches the calendar day after the last patrol day so after-midnight rounds are included', () => {
    expect(patrolFetchRange('2026-10-30', '2026-10-30')).toEqual({ from: '2026-10-30', to: '2026-10-31' });
  });

  it('summarises each department for the department list, worst first', () => {
    const rows = buildDepartmentRoundSummaries({ day: '2026-10-30', now, checkpoints, scans });
    expect(rows.map((row) => row.department)).toEqual(['WCS', 'ANO']);
    expect(rows[1]).toMatchObject({ department: 'ANO', checkpoints: 2, due: 6, done: 3, missed: 2, percent: 50, currentRound: 3, currentDone: 1, status: 'missed' });
    expect(rows[0]).toMatchObject({ department: 'WCS', checkpoints: 1, done: 0, missed: 2, status: 'missed' });
  });

  it('counts completed rounds per checkpoint per patrol day for range reports', () => {
    const table = roundsByDay({ dates: ['2026-10-29', '2026-10-30'], now, checkpoints: checkpoints.slice(0, 1), scans });
    expect(table.c1['2026-10-29']).toEqual({ done: 0, due: 8 });
    expect(table.c1['2026-10-30']).toEqual({ done: 2, due: 3 });
  });
});
