import type { Announcement } from './announcement-client';

export const POPUP_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'sms-v3-announcement-popup';
type Store = Pick<Storage, 'getItem' | 'setItem'>;

// Key includes updatedAt so an ADMIN edit makes the pop-up appear again.
export function popupSnoozeKey(userId: string, row: Pick<Announcement, 'id' | 'updatedAt' | 'createdAt'>) {
  return `${PREFIX}:${userId}:${row.id}:${row.updatedAt || row.createdAt}`;
}

function snoozedUntil(userId: string, row: Announcement, storage?: Store) {
  try {
    const value = Number(storage?.getItem(popupSnoozeKey(userId, row)));
    return Number.isFinite(value) ? value : 0;
  } catch { return 0; }
}

export function snoozePopup(userId: string, row: Announcement, storage?: Store, now = Date.now()) {
  try { storage?.setItem(popupSnoozeKey(userId, row), String(now + POPUP_SNOOZE_MS)); } catch { /* best effort */ }
}

export function visiblePopups(rows: Announcement[], userId: string, storage?: Store, now = Date.now()) {
  return rows
    .filter((row) => row.showPopup && !row.expired && !(row.expiresAt && Date.parse(row.expiresAt) <= now))
    .filter((row) => snoozedUntil(userId, row, storage) <= now)
    .sort((a, b) => Number(b.pinned) - Number(a.pinned) || Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
