import { useEffect, useState } from 'react';
import { announcementClient, announcementDateLabel, ANNOUNCEMENT_CATEGORY_LABELS, type Announcement, type AnnouncementClient } from './announcement-client';
import { AnnouncementImage, AnnouncementModal } from './AnnouncementParts';
import './announcements.css';

// Compact "ประกาศล่าสุด" card used on the web dashboard and the PWA employee home.
export function AnnouncementHomeCard({ token, limit = 3, client = announcementClient, onOpenAll, className = '' }: { token: string; limit?: number; client?: AnnouncementClient; onOpenAll?(): void; className?: string }) {
  const [rows, setRows] = useState<Announcement[]>();
  const [failed, setFailed] = useState(false);
  const [viewing, setViewing] = useState<Announcement>();
  useEffect(() => {
    let alive = true;
    client.list(token, { limit }).then((data) => { if (alive) setRows(data.slice(0, limit)); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [token, limit, client]);
  return <section className={`announcement-home-card ${className}`} aria-labelledby="announcement-home-title">
    <header className="announcement-home-card__head"><h2 id="announcement-home-title">ประกาศล่าสุด</h2>{onOpenAll && <button type="button" className="announcement-home-card__all" onClick={onOpenAll}>ดูทั้งหมด →</button>}</header>
    {failed ? <p className="announcement-empty" >โหลดประกาศไม่สำเร็จ</p>
      : !rows ? <p className="announcement-empty" >กำลังโหลดประกาศ…</p>
      : !rows.length ? <p className="announcement-empty">ยังไม่มีประกาศ</p>
      : <div className="announcement-home-list">{rows.map((row) => <button type="button" key={row.id} className="announcement-home-row" onClick={() => setViewing(row)}>
        <span><strong>{row.title}</strong><small>{ANNOUNCEMENT_CATEGORY_LABELS[row.category]} · {announcementDateLabel(row.createdAt)}</small></span>
        {row.pinned && <span className="announcement-badge is-pinned">ปักหมุด</span>}
      </button>)}</div>}
    {viewing && <AnnouncementModal labelledBy="announcement-home-view-title" onClose={() => setViewing(undefined)}>
      <h2 id="announcement-home-view-title">{viewing.title}</h2>
      <span className="announcement-meta">{ANNOUNCEMENT_CATEGORY_LABELS[viewing.category]} · {announcementDateLabel(viewing.createdAt)}</span>
      <AnnouncementImage token={token} row={viewing} client={client} className="is-modal" />
      <p className="announcement-modal__body">{viewing.body}</p>
      <footer className="announcement-modal__foot"><button type="button" className="btn-neutral small-action" data-autofocus onClick={() => setViewing(undefined)}>ปิด</button></footer>
    </AnnouncementModal>}
  </section>;
}
