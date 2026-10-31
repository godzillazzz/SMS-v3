import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from '../../components/SmsIcon';
import { useAccessibleOverlay } from '../../components/useAccessibleOverlay';
import { ANNOUNCEMENT_CATEGORY_LABELS, announcementDateLabel, type Announcement, type AnnouncementClient } from './announcement-client';
import './announcements.css';

// Authenticated image: fetched with the session token and shown via an object URL (never a public link).
export function AnnouncementImage({ token, row, client, className = '' }: { token: string; row: Announcement; client: AnnouncementClient; className?: string }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!row.imageUrl || !client.imageObjectUrl) return undefined;
    let alive = true; let created: string | undefined;
    setFailed(false);
    client.imageObjectUrl(token, row.imageUrl).then((value) => { created = value; if (alive) setUrl(value); else URL.revokeObjectURL(value); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (created) URL.revokeObjectURL(created); };
  }, [token, row.imageUrl, client]);
  if (!row.imageUrl) return null;
  return <figure className={`announcement-image ${className}`}>
    {url ? <img src={url} alt={`รูปประกอบประกาศ ${row.title}`} loading="lazy" /> : <span className="announcement-image__placeholder" role="status">{failed ? 'เปิดรูปไม่สำเร็จ' : 'กำลังโหลดรูป…'}</span>}
  </figure>;
}

export function AnnouncementMeta({ row }: { row: Announcement }) {
  return <span className="announcement-meta">{ANNOUNCEMENT_CATEGORY_LABELS[row.category] || row.category} · {announcementDateLabel(row.createdAt)}{row.expiresOn ? ` · หมดอายุ ${announcementDateLabel(row.expiresOn)}` : ''}</span>;
}

export function AnnouncementModal({ labelledBy, onClose, children, className = '' }: { labelledBy: string; onClose(): void; children: ReactNode; className?: string }) {
  const ref = useAccessibleOverlay<HTMLDivElement>(true, onClose, { initialFocusSelector: '[data-autofocus]' });
  return createPortal(<div className="announcement-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={ref} className={`announcement-modal ${className}`} role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
      <button type="button" className="announcement-modal__x" aria-label="ปิด" onClick={onClose}><SmsIcon name="close" size={18} /></button>
      {children}
    </div>
  </div>, document.body);
}
