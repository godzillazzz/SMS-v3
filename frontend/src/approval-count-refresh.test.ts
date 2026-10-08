import { describe, expect, it, vi } from 'vitest';
import { createApprovalCountRefresh } from './approval-count-refresh';

const zeroSummary = {
  total: 0,
  byType: {
    EMPLOYEE_MASTER_CHANGE: 0,
    EMPLOYEE_REFERENCE_PHOTO: 0,
    LICENSE_DOCUMENT: 0,
    SCHEDULE_APPROVAL: 0,
    ATTENDANCE_DEVICE_REQUEST: 0,
    ATTENDANCE_ADJUSTMENT_REQUEST: 0,
    REGISTRATION_REQUEST: 0,
    USER_ACCESS: 0,
    LEAVE_REQUEST: 0
  }
};

describe('approval count refresh guard', () => {
  it('does not fetch while the document is hidden', () => {
    const read = vi.fn().mockResolvedValue({ summary: zeroSummary });
    const onUpdate = vi.fn();
    const refresh = createApprovalCountRefresh({ read, canRefresh: () => false, onUpdate });

    refresh.refresh();

    expect(read).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('coalesces multiple overlapping triggers into one fresh read', async () => {
    const resolvers: Array<(value: { summary: typeof zeroSummary }) => void> = [];
    const read = vi.fn(() => new Promise<{ summary: typeof zeroSummary }>((resolve) => { resolvers.push(resolve); }));
    const onUpdate = vi.fn();
    const refresh = createApprovalCountRefresh({ read, canRefresh: () => true, onUpdate });
    refresh.refresh();
    refresh.refresh();
    refresh.refresh();
    expect(read).toHaveBeenCalledTimes(1);
    resolvers[0]({ summary: zeroSummary });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(onUpdate).not.toHaveBeenCalled();
    resolvers[1]({ summary: zeroSummary });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledTimes(1));
    expect(onUpdate).toHaveBeenCalledWith({ total: 0, byType: zeroSummary.byType });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('discards an in-flight pre-action result and runs one fresh read after a refresh trigger', async () => {
    const staleSummary = { ...zeroSummary, total: 1, byType: { ...zeroSummary.byType, LEAVE_REQUEST: 1 } };
    const resolvers: Array<(value: { summary: typeof zeroSummary | typeof staleSummary }) => void> = [];
    const read = vi.fn(() => new Promise<{ summary: typeof zeroSummary | typeof staleSummary }>((resolve) => { resolvers.push(resolve); }));
    const onUpdate = vi.fn();
    const refresh = createApprovalCountRefresh({ read, canRefresh: () => true, onUpdate });

    refresh.refresh();
    refresh.refresh();
    resolvers[0]({ summary: staleSummary });
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(onUpdate).not.toHaveBeenCalled();

    resolvers[1]({ summary: zeroSummary });
    await vi.waitFor(() => expect(onUpdate).toHaveBeenCalledWith({ total: 0, byType: zeroSummary.byType }));
    expect(onUpdate).toHaveBeenCalledTimes(1);
  });

  it('ignores an old response after the owning session is disposed', async () => {
    let resolveRead!: (value: { summary: typeof zeroSummary }) => void;
    const read = vi.fn(() => new Promise<{ summary: typeof zeroSummary }>((resolve) => { resolveRead = resolve; }));
    const onUpdate = vi.fn();
    const refresh = createApprovalCountRefresh({ read, canRefresh: () => true, onUpdate });

    refresh.refresh();
    refresh.dispose();
    resolveRead({ summary: zeroSummary });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('clears counts when the request fails rather than confirming zero', async () => {
    const onUpdate = vi.fn();
    const refresh = createApprovalCountRefresh({ read: () => Promise.reject(new Error('offline')), canRefresh: () => true, onUpdate });

    refresh.refresh();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith(null);
  });
});
