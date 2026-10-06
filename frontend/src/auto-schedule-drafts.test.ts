import { describe, expect, it } from 'vitest';
import { addAutoSchedulePreviewDrafts, summarizeAutoSchedulePreview } from './auto-schedule-drafts';

describe('whole-month auto-schedule drafts', () => {
  it('preserves current drafts and persisted assignments, adding only empty slots', () => {
    const currentDrafts = {
      'worker-1_2026-07-01': { action: 'update', remark: 'owner edit 1' },
      'worker-1_2026-07-02': { action: 'delete', remark: 'owner edit 2' },
      'worker-1_2026-07-03': { action: 'create', remark: 'owner edit 3' }
    };
    const rows = [
      { employeeId: 'worker-1', date: '2026-07-01', code: 'N' },
      { employeeId: 'worker-1', date: '2026-07-02', code: 'D' },
      { employeeId: 'worker-1', date: '2026-07-03', code: 'OFF' },
      { employeeId: 'worker-2', date: '2026-07-01', code: 'D', locked: true, preserved: true, existingShiftId: 'existing-shift' },
      { employeeId: 'worker-2', date: '2026-07-02', code: 'N' }
    ];

    const nextDrafts = addAutoSchedulePreviewDrafts(currentDrafts, rows, (row) => ({
      action: 'create',
      shiftCode: String(row.code)
    }));

    expect(nextDrafts).toEqual({
      ...currentDrafts,
      'worker-2_2026-07-02': { action: 'create', shiftCode: 'N' }
    });
    expect(summarizeAutoSchedulePreview(rows, currentDrafts)).toEqual({ generated: 1, preservedExisting: 4 });
  });

  it('does not return an apply candidate for a slot with a persisted ID or lock marker', () => {
    const currentDrafts = {};
    const rows = [
      { employeeId: 'worker-1', date: '2026-07-01', existingShiftId: 'shift-id' },
      { employeeId: 'worker-1', date: '2026-07-02', locked: true },
      { employeeId: 'worker-1', date: '2026-07-03', preserved: true }
    ];

    const nextDrafts = addAutoSchedulePreviewDrafts(currentDrafts, rows, () => ({ action: 'create' }));

    expect(nextDrafts).toEqual({});
    expect(summarizeAutoSchedulePreview(rows, currentDrafts)).toEqual({ generated: 0, preservedExisting: 3 });
  });
});
