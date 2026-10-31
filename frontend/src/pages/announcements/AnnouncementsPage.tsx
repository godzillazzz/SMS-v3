import { useEffect, useMemo, useState } from 'react';
import { PageHeader } from '../../components/layout';
import { useActionDialog } from '../../components/useActionDialog';
import { formatRequestErrorMessage } from '../../request-error';
import {
  ANNOUNCEMENT_CATEGORIES, ANNOUNCEMENT_CATEGORY_LABELS, ANNOUNCEMENT_IMAGE_MAX_BYTES, ANNOUNCEMENT_IMAGE_TYPES,
  announcementClient, announcementDateLabel, type Announcement, type AnnouncementCategory, type AnnouncementClient, type AnnouncementInput
} from './announcement-client';
import { AnnouncementImage, AnnouncementMeta, AnnouncementModal } from './AnnouncementParts';
import './announcements.css';

type Filter = 'ALL' | AnnouncementCategory;
type Draft = AnnouncementInput & { id?: string; hasImage?: boolean; removeImage?: boolean };
const emptyDraft: Draft = { title: '', body: '', category: 'GENERAL', pinned: false, showPopup: false, expiresOn: null };

export function AnnouncementsPage({ token, role, client = announcementClient }: { token: string; role: string; client?: AnnouncementClient }) {
  const isAdmin = role === 'ADMIN';
  const [rows, setRows] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [viewing, setViewing] = useState<Announcement>();
  const [draft, setDraft] = useState<Draft>();
  const [refresh, setRefresh] = useState(0);
  const dialog = useActionDialog();

  useEffect(() => {
    let alive = true;
    setLoading(true); setError(undefined);
    client.list(token, { limit: 100, includeExpired: isAdmin })
      .then((data) => { if (alive) setRows(data); })
      .catch(() => { if (alive) { setRows([]); setError('โหลดประกาศไม่สำเร็จ กรุณาลองใหม่'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [token, client, isAdmin, refresh]);

  const visible = useMemo(() => rows.filter((row) => filter === 'ALL' || row.category === filter), [rows, filter]);

  const remove = async (row: Announcement) => {
    const ok = await dialog.confirm({ title: 'ลบประกาศ', message: `ลบประกาศ “${row.title}” ใช่หรือไม่? ผู้ใช้จะไม่เห็นประกาศนี้อีก`, confirmLabel: 'ลบประกาศ', cancelLabel: 'ยกเลิก', tone: 'danger' });
    if (!ok) return;
    try { await client.remove(token, row.id); setRefresh((value) => value + 1); }
    catch (reason) { setError(formatRequestErrorMessage(reason, 'ลบประกาศไม่สำเร็จ')); }
  };

  const tabs: Array<[Filter, string]> = [['ALL', 'ทั้งหมด'], ...ANNOUNCEMENT_CATEGORIES.map((value) => [value, ANNOUNCEMENT_CATEGORY_LABELS[value]] as [Filter, string])];

  return <section className="view-pane layout-page-surface announcements-page" aria-label="ประกาศ">
    <PageHeader kicker="หน้าหลัก / ประกาศ" title="ประกาศ" description="ข่าวสารและข้อมูลสำคัญสำหรับทีมปฏิบัติงาน" actions={isAdmin ? <button type="button" className="btn-primary compact" onClick={() => setDraft({ ...emptyDraft })}>+ เขียนประกาศ</button> : undefined} />
    <div className="announcement-tabs" role="tablist" aria-label="กรองหมวดประกาศ">
      {tabs.map(([value, label]) => <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-selected' : ''} onClick={() => setFilter(value)}>{label}</button>)}
    </div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {loading ? <div className="loading-row" role="status">กำลังโหลดประกาศ…</div>
      : !error && !visible.length ? <p className="announcement-empty">ไม่มีประกาศในหมวดนี้</p>
      : <div className="announcement-grid">
        {visible.map((row) => <article key={row.id} className={`announcement-card${row.expired ? ' is-expired' : ''}`}>
          <div className="announcement-tags"><span className="announcement-badge">{ANNOUNCEMENT_CATEGORY_LABELS[row.category]}</span>{row.pinned && <span className="announcement-badge is-pinned">ปักหมุด</span>}{row.showPopup && isAdmin && <span className="announcement-badge">แสดงป๊อปอัป</span>}{row.expired && <span className="announcement-badge is-expired">หมดอายุแล้ว</span>}</div>
          <AnnouncementImage token={token} row={row} client={client} className="is-card" />
          <h3>{row.title}</h3>
          <p className="announcement-body">{row.body}</p>
          <div className="announcement-card__meta">{announcementDateLabel(row.createdAt)}{row.expiresOn ? ` · หมดอายุ ${announcementDateLabel(row.expiresOn)}` : ''}</div>
          <div className="announcement-actions">
            <button type="button" onClick={() => setViewing(row)}>ดู</button>
            {isAdmin && <button type="button" onClick={() => setDraft({ id: row.id, title: row.title, body: row.body, category: row.category, pinned: row.pinned, showPopup: Boolean(row.showPopup), expiresOn: row.expiresOn, hasImage: row.hasImage })}>แก้ไข</button>}
            {isAdmin && <button type="button" className="is-danger" onClick={() => remove(row)}>ลบ</button>}
          </div>
        </article>)}
      </div>}
    {viewing && <AnnouncementModal labelledBy="announcement-view-title" onClose={() => setViewing(undefined)}>
      <h2 id="announcement-view-title">{viewing.title}</h2>
      <AnnouncementMeta row={viewing} />
      <AnnouncementImage token={token} row={viewing} client={client} className="is-modal" />
      <p className="announcement-modal__body">{viewing.body}</p>
      <footer className="announcement-modal__foot"><button type="button" className="btn-neutral small-action" data-autofocus onClick={() => setViewing(undefined)}>ปิด</button></footer>
    </AnnouncementModal>}
    {draft && isAdmin && <AnnouncementEditor token={token} client={client} draft={draft} onClose={() => setDraft(undefined)} onSaved={() => { setDraft(undefined); setRefresh((value) => value + 1); }} />}
    {dialog.dialog}
  </section>;
}

function AnnouncementEditor({ token, client, draft: initial, onClose, onSaved }: { token: string; client: AnnouncementClient; draft: Draft; onClose(): void; onSaved(): void }) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [file, setFile] = useState<File>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const pickFile = (next?: File) => {
    setError(undefined);
    if (!next) { setFile(undefined); return; }
    if (!ANNOUNCEMENT_IMAGE_TYPES.includes(next.type)) { setError('รองรับเฉพาะรูป JPEG, PNG หรือ WebP'); return; }
    if (next.size > ANNOUNCEMENT_IMAGE_MAX_BYTES) { setError('รูปต้องมีขนาดไม่เกิน 5 MB'); return; }
    setFile(next); set('removeImage', false);
  };
  const submit = async () => {
    if (!draft.title.trim() || !draft.body.trim()) { setError('กรุณากรอกหัวข้อและเนื้อหา'); return; }
    setBusy(true); setError(undefined);
    const payload: AnnouncementInput = { title: draft.title.trim(), body: draft.body.trim(), category: draft.category, pinned: draft.pinned, showPopup: Boolean(draft.showPopup), expiresOn: draft.expiresOn || null };
    try {
      const saved = draft.id ? await client.update(token, draft.id, payload) : await client.create(token, payload);
      const id = draft.id || saved?.id;
      if (id && file && client.uploadImage) await client.uploadImage(token, id, file);
      else if (id && draft.removeImage && client.removeImage) await client.removeImage(token, id);
      onSaved();
    } catch (reason) { setError(formatRequestErrorMessage(reason, 'บันทึกประกาศไม่สำเร็จ')); }
    finally { setBusy(false); }
  };
  return <AnnouncementModal labelledBy="announcement-editor-title" onClose={() => { if (!busy) onClose(); }} className="is-editor">
    <h2 id="announcement-editor-title">{draft.id ? 'แก้ไขประกาศ' : 'เขียนประกาศ'}</h2>
    <form className="announcement-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label>หัวข้อ<input name="title" data-autofocus maxLength={150} required value={draft.title} onChange={(event) => set('title', event.target.value)} /></label>
      <label>เนื้อหา<textarea name="body" rows={6} maxLength={5000} required value={draft.body} onChange={(event) => set('body', event.target.value)} /></label>
      <div className="announcement-form__row">
        <label>หมวด<select name="category" value={draft.category} onChange={(event) => set('category', event.target.value as AnnouncementCategory)}>{ANNOUNCEMENT_CATEGORIES.map((value) => <option key={value} value={value}>{ANNOUNCEMENT_CATEGORY_LABELS[value]}</option>)}</select></label>
        <label>วันหมดอายุ (ไม่บังคับ)<input type="date" name="expiresOn" value={draft.expiresOn || ''} onChange={(event) => set('expiresOn', event.target.value || null)} /></label>
      </div>
      <label>รูปประกอบ (ไม่บังคับ · JPEG/PNG/WebP ไม่เกิน 5 MB)<input type="file" name="image" accept={ANNOUNCEMENT_IMAGE_TYPES.join(',')} onChange={(event) => pickFile(event.target.files?.[0])} /></label>
      {draft.hasImage && !file && <label className="announcement-check"><input type="checkbox" checked={Boolean(draft.removeImage)} onChange={(event) => set('removeImage', event.target.checked)} /> ลบรูปเดิม</label>}
      <label className="announcement-check"><input type="checkbox" name="pinned" checked={draft.pinned} onChange={(event) => set('pinned', event.target.checked)} /> ปักหมุดประกาศ</label>
      <label className="announcement-check"><input type="checkbox" name="showPopup" checked={Boolean(draft.showPopup)} onChange={(event) => set('showPopup', event.target.checked)} /> แสดงเป็นป๊อปอัปหลังเข้าสู่ระบบ</label>
      <p className="announcement-hint">วันหมดอายุนับถึงสิ้นวัน (เวลาไทย) · ข้อความแสดงเป็นตัวอักษรล้วน</p>
      {error && <div className="settings-notice error" role="alert">{error}</div>}
      <footer className="announcement-modal__foot"><button type="button" className="btn-neutral small-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className="btn-primary compact" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกประกาศ'}</button></footer>
    </form>
  </AnnouncementModal>;
}
