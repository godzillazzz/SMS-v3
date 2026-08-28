import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { SmsIcon } from '../../components/SmsIcon';
import '../../styles/approval-center.css';

type ApprovalUrgency = 'NEW' | 'DUE_SOON' | 'OVERDUE';
type ApprovalType = 'EMPLOYEE_MASTER_CHANGE' | 'EMPLOYEE_REFERENCE_PHOTO';
type ApprovalItem = {
  id: string;
  requestId: string;
  type: ApprovalType;
  title: string;
  status: string;
  submittedAt: string;
  ageHours: number;
  urgency: ApprovalUrgency;
  revision?: number;
  changedFields?: string[];
  employee?: { id?: string; employeeCode?: string; firstName?: string; lastName?: string; displayName?: string; department?: string; jobTitle?: string } | null;
  requestedBy?: { id?: string | null; displayName?: string | null; role?: string | null };
  photo?: { fileName?: string; mimeType?: string; fileSize?: number; imageWidth?: number; imageHeight?: number };
};
type Summary = { total: number; employeeMasterChanges: number; referencePhotos: number; dueSoon24h: number; overdue48h: number; truncated?: boolean };
type Props = { token: string; refreshKey?: number; onChanged(): void; onOpenEmployeeChange(requestId: string): void };

const typeLabel: Record<ApprovalType, string> = {
  EMPLOYEE_MASTER_CHANGE: 'แก้ไขข้อมูลพนักงาน',
  EMPLOYEE_REFERENCE_PHOTO: 'รูปอ้างอิงพนักงาน'
};
const urgencyLabel: Record<ApprovalUrgency, string> = { NEW: 'ใหม่', DUE_SOON: 'ครบ 24 ชม.', OVERDUE: 'เกิน 48 ชม.' };
const changedFieldLabels: Record<string, string> = { employeeCode: 'รหัสพนักงาน', firstName: 'ชื่อ', lastName: 'นามสกุล', department: 'หน่วยงาน', jobTitle: 'ตำแหน่ง', isActive: 'สถานะการทำงาน' };
const fmt = (value: string) => new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(new Date(value));
const employeeName = (item?: ApprovalItem) => item?.employee?.displayName || [item?.employee?.firstName, item?.employee?.lastName].filter(Boolean).join(' ') || 'ไม่พบชื่อพนักงาน';
const bytes = (value?: number) => !value ? '—' : value < 1024 * 1024 ? Math.max(1, Math.round(value / 1024)) + ' KB' : (value / 1024 / 1024).toFixed(1) + ' MB';

export function ApprovalCenterPage({ token, refreshKey = 0, onChanged, onOpenEmployeeChange }: Props) {
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, employeeMasterChanges: 0, referencePhotos: 0, dueSoon24h: 0, overdue48h: 0 });
  const [selectedId, setSelectedId] = useState('');
  const [filter, setFilter] = useState<'ALL' | ApprovalType>('ALL');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [notice, setNotice] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [photoLoading, setPhotoLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const load = async () => {
    setLoading(true);
    setError(undefined);
    try {
      const result = await api.approvalCenter(token);
      const next = Array.isArray(result?.data) ? result.data as ApprovalItem[] : [];
      setItems(next);
      setSummary({ total: Number(result?.summary?.total || 0), employeeMasterChanges: Number(result?.summary?.employeeMasterChanges || 0), referencePhotos: Number(result?.summary?.referencePhotos || 0), dueSoon24h: Number(result?.summary?.dueSoon24h || 0), overdue48h: Number(result?.summary?.overdue48h || 0), truncated: Boolean(result?.summary?.truncated) });
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id || '');
    } catch (cause) {
      setError(toRequestErrorState(cause, 'ไม่สามารถโหลดศูนย์คำขออนุมัติได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [token, refreshKey]);

  const visible = useMemo(() => filter === 'ALL' ? items : items.filter((item) => item.type === filter), [items, filter]);
  const selected = visible.find((item) => item.id === selectedId) || visible[0];

  useEffect(() => {
    setPhotoUrl('');
    setPhotoLoading(false);
    setRejectReason('');
    if (!selected || selected.type !== 'EMPLOYEE_REFERENCE_PHOTO') return;
    let active = true;
    setPhotoLoading(true);
    setError(undefined);
    api.viewEmployeeReferencePhoto(token, selected.requestId)
      .then((result) => {
        if (!active) return;
        const url = String(result?.data?.url || '');
        setPhotoUrl(url);
        if (!url) setError('ไม่สามารถเปิดรูปอ้างอิงที่รออนุมัติได้ กรุณารีเฟรชและตรวจสอบก่อนอนุมัติ');
      })
      .catch((cause) => {
        if (!active) return;
        setPhotoUrl('');
        setError(toRequestErrorState(cause, 'ไม่สามารถเปิดรูปอ้างอิงที่รออนุมัติได้ กรุณารีเฟรชและตรวจสอบก่อนอนุมัติ'));
      })
      .finally(() => { if (active) setPhotoLoading(false); });
    return () => { active = false; };
  }, [selected?.requestId, selected?.type, token]);

  const completePhotoAction = async (action: 'approve' | 'reject') => {
    if (!selected || selected.type !== 'EMPLOYEE_REFERENCE_PHOTO') return;
    if (action === 'reject' && rejectReason.trim().length < 3) { setError('กรุณาระบุเหตุผลที่ไม่อนุมัติอย่างน้อย 3 ตัวอักษร'); return; }
    setBusy(true); setError(undefined); setNotice('');
    try {
      if (action === 'approve') await api.approveEmployeeReferencePhoto(token, selected.requestId);
      else await api.rejectEmployeeReferencePhoto(token, selected.requestId, rejectReason.trim());
      setNotice(action === 'approve' ? 'อนุมัติรูปอ้างอิงและเปิดใช้งานแล้ว' : 'ไม่อนุมัติรูปอ้างอิงแล้ว');
      await load();
      onChanged();
    } catch (cause) {
      setError(toRequestErrorState(cause, 'ดำเนินการกับคำขอรูปอ้างอิงไม่สำเร็จ'));
    } finally {
      setBusy(false);
    }
  };

  return <section className="approval-center-page data-surface-page" aria-label="Approval Center">
    <header className="approval-center-header">
      <div><p className="eyebrow">ADMIN WORK QUEUE</p><h1>ศูนย์คำขออนุมัติ</h1><p>รวมคำขอแก้ไขข้อมูลและรูปพนักงานที่รอการตัดสินใจไว้ในจุดเดียว</p></div>
      <button type="button" className="btn-neutral small-action" disabled={loading} onClick={() => void load()}><SmsIcon name="refresh" size={16} />รีเฟรช</button>
    </header>

    {error && <div className="approval-center-alert approval-center-alert--error"><RequestErrorContent error={error} /></div>}
    {notice && <div className="approval-center-alert approval-center-alert--success">{notice}</div>}

    <div className="approval-center-metrics">
      <article><span>รออนุมัติทั้งหมด</span><strong>{summary.total}</strong><small>รายการ</small></article>
      <article><span>แก้ไขข้อมูล</span><strong>{summary.employeeMasterChanges}</strong><small>Employee Master</small></article>
      <article><span>รูปพนักงาน</span><strong>{summary.referencePhotos}</strong><small>Reference Photo</small></article>
      <article className={summary.overdue48h > 0 ? 'is-overdue' : ''}><span>เกิน 48 ชั่วโมง</span><strong>{summary.overdue48h}</strong><small>{summary.dueSoon24h} รายการครบ 24 ชม.</small></article>
    </div>

    <div className="approval-center-filter" role="group" aria-label="ตัวกรองประเภทคำขอ">
      <button type="button" className={filter === 'ALL' ? 'active' : ''} onClick={() => setFilter('ALL')}>ทั้งหมด</button>
      <button type="button" className={filter === 'EMPLOYEE_MASTER_CHANGE' ? 'active' : ''} onClick={() => setFilter('EMPLOYEE_MASTER_CHANGE')}>แก้ไขข้อมูล</button>
      <button type="button" className={filter === 'EMPLOYEE_REFERENCE_PHOTO' ? 'active' : ''} onClick={() => setFilter('EMPLOYEE_REFERENCE_PHOTO')}>รูปพนักงาน</button>
    </div>

    <div className="approval-center-layout">
      <aside className="approval-center-queue" aria-label="รายการรออนุมัติ">
        <div className="approval-center-queue__title"><strong>รอตรวจสอบ</strong><span>{visible.length} รายการ</span></div>
        {loading ? <div className="approval-center-empty">กำลังโหลดคำขอ…</div> : visible.length ? visible.map((item) =>
          <button type="button" key={item.id} className={selected?.id === item.id ? 'is-selected' : ''} onClick={() => setSelectedId(item.id)}>
            <div><strong>{employeeName(item)}</strong><span className={'approval-urgency approval-urgency--' + item.urgency.toLowerCase()}>{urgencyLabel[item.urgency]}</span></div>
            <span>{typeLabel[item.type]} · {item.employee?.employeeCode || '—'}</span>
            <small>โดย {item.requestedBy?.displayName || 'Manager'} · {fmt(item.submittedAt)}</small>
          </button>
        ) : <div className="approval-center-empty"><SmsIcon name="check" size={28} /><strong>ไม่มีคำขอค้างอนุมัติ</strong><span>รายการใหม่จากหัวหน้างานจะแสดงที่นี่อัตโนมัติ</span></div>}
      </aside>

      <section className="approval-center-detail" aria-live="polite">
        {selected ? <>
          <header><div><p>{typeLabel[selected.type]}</p><h2>{employeeName(selected)}</h2><span>{selected.employee?.employeeCode || '—'} · {selected.employee?.department || 'ไม่ระบุหน่วยงาน'}</span></div><span className={'approval-urgency approval-urgency--' + selected.urgency.toLowerCase()}>{urgencyLabel[selected.urgency]}</span></header>
          <dl className="approval-center-meta">
            <div><dt>ผู้ส่งคำขอ</dt><dd>{selected.requestedBy?.displayName || 'Manager'} ({selected.requestedBy?.role || 'MANAGER'})</dd></div>
            <div><dt>ส่งเมื่อ</dt><dd>{fmt(selected.submittedAt)}</dd></div>
            <div><dt>เวลาที่รอ</dt><dd>{selected.ageHours < 1 ? 'ไม่ถึง 1 ชั่วโมง' : selected.ageHours + ' ชั่วโมง'}</dd></div>
          </dl>

          {selected.type === 'EMPLOYEE_MASTER_CHANGE' ? <div className="approval-center-master">
            <h3>ข้อมูลที่ขอแก้ไข</h3>
            <div className="approval-center-fields">{(selected.changedFields || []).map((field) => <span key={field}>{changedFieldLabels[field] || field}</span>)}</div>
            <p>Revision {selected.revision || 1} · เปิดรายละเอียดเพื่อดู BEFORE → AFTER และผลกระทบก่อนตัดสินใจ</p>
            <button type="button" className="btn-primary compact" onClick={() => onOpenEmployeeChange(selected.requestId)}>เปิดคำขอและพิจารณา</button>
          </div> : <div className="approval-center-photo-review">
            <h3>รูปที่เสนอ</h3>
            <div className="approval-center-photo-frame">{photoUrl ? <img src={photoUrl} alt={'รูปที่รออนุมัติของ ' + employeeName(selected)} /> : <div><SmsIcon name="eye" size={28} /><span>{photoLoading ? 'กำลังเปิดรูป Private Evidence…' : 'ยังไม่สามารถเปิดรูปเพื่อพิจารณาได้'}</span></div>}</div>
            <div className="approval-center-photo-meta"><span>{selected.photo?.fileName || 'รูปอ้างอิง'}</span><span>{selected.photo?.imageWidth || '—'}×{selected.photo?.imageHeight || '—'} · {bytes(selected.photo?.fileSize)}</span></div>
            <div className="approval-center-photo-actions">
              <button type="button" className="btn-primary compact" disabled={busy || photoLoading || !photoUrl} onClick={() => void completePhotoAction('approve')}><SmsIcon name="check" size={16} />อนุมัติและเปิดใช้</button>
              <label><span>เหตุผลที่ไม่อนุมัติ</span><textarea rows={3} maxLength={1000} value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder="ระบุอย่างน้อย 3 ตัวอักษร" /></label>
              <button type="button" className="btn-danger-outline" disabled={busy || rejectReason.trim().length < 3} onClick={() => void completePhotoAction('reject')}>ไม่อนุมัติ</button>
            </div>
          </div>}
        </> : <div className="approval-center-empty approval-center-empty--detail"><SmsIcon name="bell" size={30} /><strong>เลือกคำขอเพื่อดูรายละเอียด</strong></div>}
      </section>
    </div>
    {summary.truncated && <p className="approval-center-footnote">มีคำขอมากกว่า 100 รายการ กรุณาดำเนินการรายการเก่าก่อนเพื่อให้คิวล่าสุดแสดงครบ</p>}
  </section>;
}
