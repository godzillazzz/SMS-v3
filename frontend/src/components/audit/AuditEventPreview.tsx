import { useEffect, useRef } from 'react';
import { acquireDocumentScrollLock } from '../../document-scroll-lock';
import type { AuditEvent } from './audit-types';
import { actionLabel, entityLabel, formatAuditTime, moduleLabel, safe, safeMetadataEntries } from './audit-utils';

type Props = { event?: AuditEvent; onClose(): void };

export function AuditEventPreview({ event, onClose }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!event) return;
    const previous = document.activeElement as HTMLElement | null;
    const releaseScrollLock = acquireDocumentScrollLock();
    closeRef.current?.focus();
    const handler = (keyboardEvent: KeyboardEvent) => {
      if (keyboardEvent.key === 'Escape') { onClose(); return; }
      if (keyboardEvent.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')).filter((node) => !node.hasAttribute('disabled'));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (keyboardEvent.shiftKey && document.activeElement === first) { keyboardEvent.preventDefault(); last.focus(); }
      else if (!keyboardEvent.shiftKey && document.activeElement === last) { keyboardEvent.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
      releaseScrollLock();
      previous?.focus();
    };
  }, [event, onClose]);

  if (!event) return null;
  const metadata = safeMetadataEntries(event.metadata);
  return <div className="audit-preview-backdrop" role="presentation" onMouseDown={(mouseEvent) => { if (mouseEvent.target === mouseEvent.currentTarget) onClose(); }}><aside ref={panelRef} className="audit-preview-panel" role="dialog" aria-modal="true" aria-labelledby="audit-preview-title"><header><div><p>READ-ONLY AUDIT EVENT</p><h2 id="audit-preview-title">รายละเอียดเหตุการณ์</h2></div><button ref={closeRef} type="button" className="audit-preview-close" aria-label="ปิดรายละเอียดเหตุการณ์" onClick={onClose}>×</button></header><p className="audit-preview-note">ข้อมูลนี้แสดงแบบอ่านอย่างเดียว โดยซ่อนข้อมูลที่อ่อนไหว</p><dl><div><dt>วันและเวลา</dt><dd>{formatAuditTime(event.createdAt)}</dd></div><div><dt>ผู้ดำเนินการ</dt><dd>{safe(event.actor?.displayName, 'Unknown / Deleted User')}</dd></div><div><dt>บทบาท</dt><dd>{safe(event.actor?.role, 'ไม่ระบุบทบาท')}</dd></div><div><dt>Module</dt><dd>{moduleLabel(event.module)}</dd></div><div><dt>การดำเนินการ</dt><dd>{actionLabel(event.action)}</dd></div><div><dt>ข้อมูลเป้าหมาย</dt><dd>{entityLabel(event.entityType)} · {safe(event.entityId)}</dd></div></dl>{metadata.length > 0 && <section className="audit-metadata" aria-label="รายละเอียดเพิ่มเติมที่ปลอดภัย"><h3>รายละเอียดเพิ่มเติม</h3><dl>{metadata.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl></section>}<footer><button type="button" className="btn-neutral small-action" onClick={onClose}>ปิด</button></footer></aside></div>;
}
