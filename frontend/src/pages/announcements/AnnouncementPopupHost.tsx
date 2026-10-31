import { useEffect, useState } from 'react';
import { announcementClient, type Announcement, type AnnouncementClient } from './announcement-client';
import { AnnouncementImage, AnnouncementMeta, AnnouncementModal } from './AnnouncementParts';
import { snoozePopup, visiblePopups } from './announcement-popup-model';

// Shown once after sign-in (web and PWA). Several announcements are paged inside one modal.
export function AnnouncementPopupHost({ token, userId, client = announcementClient, storage }: { token: string; userId: string; client?: AnnouncementClient; storage?: Pick<Storage, 'getItem' | 'setItem'> }) {
  const [queue, setQueue] = useState<Announcement[]>([]);
  const [index, setIndex] = useState(0);
  const store = storage ?? (typeof window !== 'undefined' ? window.localStorage : undefined);
  useEffect(() => {
    if (!client.popups) return undefined;
    let alive = true;
    client.popups(token).then((rows) => { if (alive) { setQueue(visiblePopups(rows, userId, store)); setIndex(0); } }).catch(() => undefined);
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, userId, client]);
  if (!queue.length) return null;
  const current = queue[Math.min(index, queue.length - 1)];
  const close = () => setQueue([]);
  const snooze = () => { queue.forEach((row) => snoozePopup(userId, row, store)); close(); };
  return <AnnouncementModal labelledBy="announcement-popup-title" onClose={close} className="is-popup">
    <p className="announcement-popup__kicker">ประกาศ{queue.length > 1 ? ` · ${index + 1} / ${queue.length}` : ''}</p>
    <h2 id="announcement-popup-title">{current.title}</h2>
    <AnnouncementMeta row={current} />
    <AnnouncementImage token={token} row={current} client={client} className="is-modal" />
    <p className="announcement-modal__body">{current.body}</p>
    {queue.length > 1 && <div className="announcement-popup__pager" aria-label="เลื่อนดูประกาศ">
      <button type="button" className="btn-neutral small-action" disabled={index === 0} onClick={() => setIndex((value) => Math.max(0, value - 1))}>‹ ก่อนหน้า</button>
      <button type="button" className="btn-neutral small-action" disabled={index >= queue.length - 1} onClick={() => setIndex((value) => Math.min(queue.length - 1, value + 1))}>ถัดไป ›</button>
    </div>}
    <footer className="announcement-modal__foot">
      <button type="button" className="btn-neutral small-action" onClick={snooze}>ไม่แสดงอีก 7 วัน</button>
      <button type="button" className="btn-primary compact" data-autofocus onClick={close}>ปิด</button>
    </footer>
  </AnnouncementModal>;
}
