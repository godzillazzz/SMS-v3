import { afterEach, describe, expect, it, vi } from 'vitest';
import { POPUP_SNOOZE_MS, popupSnoozeKey, snoozePopup, visiblePopups } from './pages/announcements/announcement-popup-model';
import type { Announcement } from './pages/announcements/announcement-client';

const make = (over: Partial<Announcement>): Announcement => ({ id: 'x', title: 't', body: 'b', category: 'GENERAL', pinned: false, showPopup: true, expiresAt: null, expiresOn: null, expired: false, createdAt: '2026-10-30T00:00:00.000Z', updatedAt: '2026-10-30T00:00:00.000Z', ...over });

function memory() {
  const values = new Map<string, string>();
  return { values, getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
}

afterEach(() => { vi.useRealTimers(); });

describe('announcement pop-up filtering and 7-day snooze', () => {
  it('keeps only showPopup, non-expired rows; pinned first then newest', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T05:00:00Z'));
    const rows = [
      make({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }),
      make({ id: 'pin', pinned: true, createdAt: '2026-09-01T00:00:00Z' }),
      make({ id: 'new', createdAt: '2026-10-30T00:00:00Z' }),
      make({ id: 'off', showPopup: false }),
      make({ id: 'exp', expiresAt: '2026-10-31T04:59:59Z' }),
      make({ id: 'flag', expired: true })
    ];
    expect(visiblePopups(rows, 'u1', memory()).map((row) => row.id)).toEqual(['pin', 'new', 'old']);
  });

  it('key binds userId + announcementId + updatedAt', () => {
    expect(popupSnoozeKey('u1', make({ id: 'a1', updatedAt: '2026-10-30T01:02:03.000Z' }))).toBe('sms-v3-announcement-popup:u1:a1:2026-10-30T01:02:03.000Z');
  });

  it('hides for exactly 7 days per user, then shows again', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T05:00:00Z'));
    const storage = memory();
    const row = make({ id: 'a1' });
    snoozePopup('u1', row, storage);
    expect(visiblePopups([row], 'u1', storage)).toHaveLength(0);
    expect(visiblePopups([row], 'u2', storage)).toHaveLength(1);
    vi.setSystemTime(new Date(Date.parse('2026-10-31T05:00:00Z') + POPUP_SNOOZE_MS - 1));
    expect(visiblePopups([row], 'u1', storage)).toHaveLength(0);
    vi.setSystemTime(new Date(Date.parse('2026-10-31T05:00:00Z') + POPUP_SNOOZE_MS));
    expect(visiblePopups([row], 'u1', storage)).toHaveLength(1);
  });

  it('an ADMIN edit (new updatedAt) shows the pop-up again', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-31T05:00:00Z'));
    const storage = memory();
    snoozePopup('u1', make({ id: 'a1', updatedAt: '2026-10-30T00:00:00.000Z' }), storage);
    expect(visiblePopups([make({ id: 'a1', updatedAt: '2026-10-31T01:00:00.000Z' })], 'u1', storage)).toHaveLength(1);
  });

  it('corrupt or unavailable storage never hides announcements', () => {
    const storage = memory();
    const row = make({ id: 'a1' });
    storage.setItem(popupSnoozeKey('u1', row), 'not-a-number');
    expect(visiblePopups([row], 'u1', storage)).toHaveLength(1);
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(visiblePopups([row], 'u1', broken)).toHaveLength(1);
    expect(() => snoozePopup('u1', row, broken)).not.toThrow();
  });
});
