import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../api';
import { PageHeader } from '../../components/layout';
import { SmsIcon } from '../../components/SmsIcon';
import { EditIconButton } from '../../components/EditIconButton';
import { useActionDialog } from '../../components/useActionDialog';
import { useAccessibleOverlay } from '../../components/useAccessibleOverlay';
import { createSecuritySiteQrDataUrl } from '../../components/security-site-qr';
import { printDocument } from '../../schedule-print';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { patrolApi } from './patrol-client';
import {
  PATROL_ROUNDS,
  bangkokToday,
  buildDepartmentRoundSummaries,
  buildRoundBoard,
  currentPatrolRound,
  patrolDayOf,
  patrolFetchRange,
  thaiDate,
  thaiTime,
  type PatrolCheckpoint,
  type PatrolDepartmentStatus,
  type PatrolReport,
  type PatrolRoundCell,
  type PatrolScan
} from './patrol-model';
import { PatrolCheckpointQrSheet, PatrolReportPrint, type PatrolPrintKind } from './PatrolPrint';
import './patrol.css';

type Tab = 'board' | 'checkpoints' | 'reports';
type CheckpointInput = { code: string; name: string; department: string; locationNote: string; sortOrder: number };

const STATUS_LABEL: Record<PatrolDepartmentStatus, string> = { complete: 'ครบทุกรอบ', progress: 'กำลังตรวจ', missed: 'มีรอบที่ขาดตรวจ', empty: 'ยังไม่มีจุดตรวจ' };

function addDays(date: string, days: number) { return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10); }

function Dialog({ title, busy, onClose, children }: { title: string; busy: boolean; onClose(): void; children: ReactNode }) {
  const ref = useAccessibleOverlay<HTMLDivElement>(true, onClose, { closeDisabled: busy, initialFocusSelector: 'input:not([disabled])' });
  return <div className="leave-type-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div ref={ref} className="leave-type-dialog patrol-dialog" role="dialog" aria-modal="true" aria-labelledby="patrol-dialog-title">
      <header><h3 id="patrol-dialog-title">{title}</h3><button type="button" className="leave-type-icon-button" aria-label="ปิด" disabled={busy} onClick={onClose}><SmsIcon name="close" size={16} /></button></header>
      {children}
    </div>
  </div>;
}

function CheckpointDialog({ department, initial, busy, error, onSubmit, onClose }: { department: string; initial?: PatrolCheckpoint; busy: boolean; error?: RequestErrorInput; onSubmit(input: CheckpointInput): void; onClose(): void }) {
  const [code, setCode] = useState(initial?.code || '');
  const [name, setName] = useState(initial?.name || '');
  const [locationNote, setLocationNote] = useState(initial?.locationNote || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const valid = code.trim() && name.trim();
  return <Dialog title={initial ? `แก้ไขจุดตรวจ ${initial.code}` : `เพิ่มจุดตรวจในจุดปฏิบัติงาน ${department}`} busy={busy} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit({ code: code.trim(), name: name.trim(), department, locationNote: locationNote.trim(), sortOrder: Number(sortOrder) || 0 }); }}>
      <div className="leave-type-dialog__fields">
        <label className="field-group"><span>จุดปฏิบัติงาน</span><input value={department} disabled readOnly /></label>
        <label className="field-group"><span>รหัสจุดตรวจ *</span><input value={code} disabled={Boolean(initial)} maxLength={50} placeholder="เช่น AN0-01" onChange={(event) => setCode(event.target.value.toUpperCase())} required />{!initial && <small>รหัสแก้ไม่ได้หลังสร้าง</small>}</label>
        <label className="field-group"><span>ชื่อจุดตรวจ *</span><input value={name} maxLength={150} placeholder="เช่น ประตูทางเข้าหลัก" onChange={(event) => setName(event.target.value)} required /></label>
        <label className="field-group"><span>ตำแหน่ง / คำอธิบาย</span><input value={locationNote} maxLength={500} placeholder="เช่น ด้านหลังอาคาร B" onChange={(event) => setLocationNote(event.target.value)} /></label>
        <label className="field-group"><span>ลำดับการเดินตรวจ</span><input type="number" min={0} max={100000} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
      </div>
      {error && <div className="settings-notice error" role="alert"><RequestErrorContent error={error} /></div>}
      <footer><button type="button" className="btn-neutral small-action" disabled={busy} onClick={onClose}>ยกเลิก</button><button type="submit" className="btn-primary compact" disabled={busy || !valid}>{busy ? 'กำลังบันทึก…' : 'บันทึก'}</button></footer>
    </form>
  </Dialog>;
}

function DepartmentDialog({ known, busy, onSubmit, onClose }: { known: string[]; busy: boolean; onSubmit(name: string): void; onClose(): void }) {
  const [name, setName] = useState('');
  return <Dialog title="เลือกจุดปฏิบัติงาน" busy={busy} onClose={onClose}>
    <form onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSubmit(name.trim()); }}>
      <div className="leave-type-dialog__fields">
        <label className="field-group"><span>ชื่อจุดปฏิบัติงาน *</span><input list="patrol-department-master" value={name} maxLength={100} placeholder="เลือกจากทะเบียนจุดปฏิบัติงาน" onChange={(event) => setName(event.target.value)} required />
          <datalist id="patrol-department-master">{known.map((item) => <option key={item} value={item} />)}</datalist>
          <small>จุดปฏิบัติงานจะแสดงในรายการเมื่อสร้างจุดตรวจจุดแรก</small></label>
      </div>
      <footer><button type="button" className="btn-neutral small-action" onClick={onClose}>ยกเลิก</button><button type="submit" className="btn-primary compact" disabled={!name.trim()}>ถัดไป</button></footer>
    </form>
  </Dialog>;
}

function PhotoDialog({ token, cell, title, onClose }: { token: string; cell: PatrolRoundCell; title: string; onClose(): void }) {
  const [urls, setUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    let alive = true;
    const created: string[] = [];
    void Promise.all(cell.scans.map(async (scan) => {
      try { const url = await patrolApi.photoObjectUrl(token, scan.photoUrl); created.push(url); if (alive) setUrls((current) => ({ ...current, [scan.id]: url })); } catch { /* shown as unavailable */ }
    }));
    return () => { alive = false; created.forEach((url) => URL.revokeObjectURL(url)); };
  }, [token, cell]);
  return <Dialog title={title} busy={false} onClose={onClose}>
    <div className="patrol-photo-list">
      {cell.scans.map((scan: PatrolScan) => <figure key={scan.id}>
        {urls[scan.id] ? <img src={urls[scan.id]} alt={`รูปจุดตรวจ ${thaiTime(scan.scannedAt)} น.`} /> : <div className="patrol-photo-list__placeholder">กำลังโหลดรูป…</div>}
        <figcaption><strong>{thaiTime(scan.scannedAt)} น.</strong> · {scan.employeeName || '—'}{scan.note ? ` · ${scan.note}` : ''}</figcaption>
      </figure>)}
    </div>
  </Dialog>;
}

export function PatrolCenterPage({ token, role }: { token: string; role: string }) {
  const actionDialog = useActionDialog();
  const isAdmin = role === 'ADMIN';
  const today = bangkokToday();
  const [now, setNow] = useState(() => new Date());
  const [tab, setTab] = useState<Tab>('board');
  const [day, setDay] = useState(() => patrolDayOf(new Date()));
  const [openDepartment, setOpenDepartment] = useState<string>();
  const [manageDepartment, setManageDepartment] = useState<string>();
  const [report, setReport] = useState<PatrolReport>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [dialogError, setDialogError] = useState<RequestErrorInput>();
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [masterDepartments, setMasterDepartments] = useState<string[]>([]);
  const [pendingDepartments, setPendingDepartments] = useState<string[]>([]);
  const [editing, setEditing] = useState<{ department: string; item?: PatrolCheckpoint }>();
  const [departmentDialog, setDepartmentDialog] = useState(false);
  const [photoCell, setPhotoCell] = useState<{ cell: PatrolRoundCell; title: string }>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reportFrom, setReportFrom] = useState(today);
  const [reportTo, setReportTo] = useState(today);
  const [reportDepartment, setReportDepartment] = useState('');
  const [printJob, setPrintJob] = useState<{ kind: PatrolPrintKind; report: PatrolReport }>();
  const [qrSheet, setQrSheet] = useState<Array<PatrolCheckpoint & { dataUrl: string }>>([]);

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);

  const loadBoard = useCallback(async () => {
    setLoading(true); setError(undefined);
    try { setReport(await patrolApi.report(token, { ...patrolFetchRange(day, day) })); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถโหลดสถานะการตรวจได้')); }
    finally { setLoading(false); }
  }, [token, day]);

  const loadCheckpoints = useCallback(async () => {
    try { setCheckpoints(await patrolApi.checkpoints(token, isAdmin)); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถโหลดจุดตรวจได้')); }
  }, [token, isAdmin]);

  useEffect(() => { if (tab === 'board') void loadBoard(); }, [tab, loadBoard]);
  useEffect(() => { void loadCheckpoints(); }, [loadCheckpoints]);
  useEffect(() => {
    if (!isAdmin) return;
    api.personnelMasters(token, true).then((result) => {
      const rows = (result as { data?: { departments?: Array<{ name: string }> } })?.data?.departments || [];
      setMasterDepartments(rows.map((row) => row.name).filter(Boolean));
    }).catch(() => undefined);
  }, [token, isAdmin]);

  const departments = useMemo(() => [...new Set([...checkpoints.map((item) => item.department), ...pendingDepartments])].sort((a, b) => a.localeCompare(b, 'th')), [checkpoints, pendingDepartments]);
  const activeCheckpoints = useMemo(() => checkpoints.filter((item) => item.isActive), [checkpoints]);
  const scans = useMemo(() => report?.patrolScans || report?.scans || [], [report]);
  const summaries = useMemo(() => buildDepartmentRoundSummaries({ day, now, checkpoints: activeCheckpoints, scans }), [day, now, activeCheckpoints, scans]);
  const totals = useMemo(() => summaries.reduce((sum, row) => ({ due: sum.due + row.due, done: sum.done + row.done, missed: sum.missed + row.missed, departments: sum.departments + (row.status === 'complete' ? 0 : 1) }), { due: 0, done: 0, missed: 0, departments: 0 }), [summaries]);
  const current = currentPatrolRound(now);
  const departmentBoard = useMemo(() => openDepartment ? buildRoundBoard({ day, now, checkpoints: activeCheckpoints.filter((item) => item.department === openDepartment), scans }) : undefined, [openDepartment, day, now, activeCheckpoints, scans]);

  const saveCheckpoint = async (input: CheckpointInput) => {
    setBusy(true); setDialogError(undefined);
    try {
      if (editing?.item) await patrolApi.updateCheckpoint(token, editing.item.id, { name: input.name, locationNote: input.locationNote || null, sortOrder: input.sortOrder });
      else await patrolApi.createCheckpoint(token, input);
      setNotice(editing?.item ? `บันทึกจุดตรวจ ${editing.item.code} แล้ว` : `สร้างจุดตรวจ ${input.code.toUpperCase()} ในจุดปฏิบัติงาน ${input.department} แล้ว`);
      setEditing(undefined);
      await loadCheckpoints();
    } catch (reason) { setDialogError(toRequestErrorState(reason, 'ไม่สามารถบันทึกจุดตรวจได้')); }
    finally { setBusy(false); }
  };

  const toggleActive = async (item: PatrolCheckpoint) => {
    const confirmed = await actionDialog.confirm(item.isActive
      ? { title: `ปิดใช้งานจุด ${item.code}`, message: 'QR ของจุดนี้จะสแกนไม่ได้จนกว่าจะเปิดใช้งานอีกครั้ง ประวัติการตรวจเดิมยังอยู่ครบ', confirmLabel: 'ปิดใช้งาน', tone: 'warning' }
      : { title: `เปิดใช้งานจุด ${item.code}`, message: 'QR เดิมของจุดนี้จะกลับมาสแกนได้', confirmLabel: 'เปิดใช้งาน', tone: 'primary' });
    if (!confirmed) return;
    setBusy(true);
    try { await patrolApi.updateCheckpoint(token, item.id, { isActive: !item.isActive }); await loadCheckpoints(); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถเปลี่ยนสถานะจุดตรวจได้')); }
    finally { setBusy(false); }
  };

  const rotate = async (item: PatrolCheckpoint) => {
    const confirmed = await actionDialog.confirm({ title: `ออก QR ใหม่ให้จุด ${item.code}`, message: 'ป้าย QR เดิมจะใช้ไม่ได้ทันที ต้องพิมพ์ป้ายใหม่ไปติดแทนที่จุดตรวจ', confirmLabel: 'ออก QR ใหม่', tone: 'danger' });
    if (!confirmed) return;
    setBusy(true);
    try { await patrolApi.rotateQr(token, item.id); await loadCheckpoints(); setNotice(`ออก QR ใหม่ให้ ${item.code} แล้ว กรุณาพิมพ์ป้ายใหม่`); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถออก QR ใหม่ได้')); }
    finally { setBusy(false); }
  };

  const printQr = async (items: PatrolCheckpoint[]) => {
    const printable = items.filter((item) => item.isActive && item.qrPayload);
    if (!printable.length) { setNotice('ไม่มีจุดตรวจที่เปิดใช้งานสำหรับพิมพ์ QR'); return; }
    setBusy(true); setError(undefined);
    try {
      const sheet = await Promise.all(printable.map(async (item) => ({ ...item, dataUrl: await createSecuritySiteQrDataUrl(item.qrPayload!, 512) })));
      flushSync(() => setQrSheet(sheet));
      await printDocument('.patrol-qr-sheet', `QR-จุดตรวจ-${today}.pdf`, { orientation: 'portrait', margin: '10mm' });
    } catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถพิมพ์ QR ได้')); }
    finally { setQrSheet([]); setBusy(false); }
  };

  const printReport = async (kind: PatrolPrintKind, options: { from?: string; to?: string; department?: string } = {}) => {
    const to = options.to || reportTo;
    const from = kind === 'daily' ? to : options.from || reportFrom;
    const dept = options.department ?? reportDepartment;
    if (kind === 'department' && !dept) { setNotice('กรุณาเลือกจุดปฏิบัติงานสำหรับรายงานรายจุดปฏิบัติงาน'); return; }
    setBusy(true); setError(undefined);
    try {
      const fetched = await patrolApi.report(token, { ...patrolFetchRange(from, to), department: kind === 'all' ? undefined : dept || undefined });
      const printable = { ...fetched, from, to };
      flushSync(() => setPrintJob({ kind, report: printable }));
      const label = kind === 'daily' ? 'รายงานการตรวจประจำวัน' : kind === 'department' ? `รายงานการตรวจ-${dept}` : 'รายงานการตรวจทุกจุดปฏิบัติงาน';
      await printDocument('.patrol-report-print', `${label}-${from}${from === to ? '' : `_${to}`}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถพิมพ์รายงานการตรวจได้')); }
    finally { setPrintJob(undefined); setBusy(false); }
  };

  const tabs: Array<[Tab, string, 'calendar' | 'qr' | 'report']> = [['board', 'สถานะการตรวจ', 'calendar'], ...(isAdmin ? [['checkpoints', 'จุดตรวจและ QR', 'qr'] as [Tab, string, 'qr']] : []), ['reports', 'พิมพ์รายงาน', 'report']];
  const selectTab = (next: Tab) => { setTab(next); setOpenDepartment(undefined); setManageDepartment(undefined); };

  const cellTitle = (code: string, cell: PatrolRoundCell, label: string) => cell.tone === 'done'
    ? `${code} รอบ ${cell.round} (${label}) · ตรวจแล้ว ${cell.count} ครั้ง · ล่าสุด ${thaiTime(cell.lastScanAt)} น. โดย ${cell.lastEmployeeName || '—'}`
    : `${code} รอบ ${cell.round} (${label}) · ${cell.tone === 'missed' ? 'ไม่ได้ตรวจ' : cell.tone === 'current' ? 'อยู่ในรอบ ยังไม่ตรวจ' : 'ยังไม่ถึงรอบ'}`;

  const dayPicker = <div className="patrol-day-picker">
    <button type="button" className="btn-neutral small-action" aria-label="วันก่อนหน้า" onClick={() => setDay((value) => addDays(value, -1))}>‹</button>
    <label className="patrol-field"><span className="sr-only">วันที่ตรวจ</span><input type="date" value={day} max={patrolDayOf(now)} onChange={(event) => event.target.value && setDay(event.target.value)} /></label>
    <button type="button" className="btn-neutral small-action" aria-label="วันถัดไป" disabled={day >= patrolDayOf(now)} onClick={() => setDay((value) => addDays(value, 1))}>›</button>
    {day !== patrolDayOf(now) && <button type="button" className="btn-neutral small-action" onClick={() => setDay(patrolDayOf(now))}>วันนี้</button>}
    <button type="button" className="btn-neutral small-action" aria-label="รีเฟรช" disabled={loading} onClick={() => void loadBoard()}><SmsIcon name="refresh" size={16} /></button>
  </div>;

  return <section className="patrol-center view-pane layout-page-surface" aria-label="ศูนย์ตรวจจุด">
    <PageHeader kicker="ตรวจจุด (Patrol)" title="ศูนย์ตรวจจุด" description="ติดตามการตรวจจุดของทุกจุดปฏิบัติงาน วันละ 8 รอบ รอบละ 3 ชั่วโมง จัดการ QR จุดตรวจ และพิมพ์รายงาน" />

    <div className="patrol-tabs" role="tablist" aria-label="เมนูศูนย์ตรวจจุด">
      {tabs.map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => selectTab(id)}><SmsIcon name={icon} size={17} />{label}</button>)}
    </div>

    {error && <div className="patrol-alert" role="alert"><SmsIcon name="shield" size={18} /><div><RequestErrorContent error={error} /></div></div>}
    {notice && <div className="patrol-notice" role="status"><SmsIcon name="check" size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice(undefined)} aria-label="ปิดข้อความ"><SmsIcon name="close" size={16} /></button></div>}

    {tab === 'board' && !openDepartment && <section className="line-settings-card patrol-master-card" aria-labelledby="patrol-board-title">
      <header className="patrol-master-head">
        <div>
          <h2 id="patrol-board-title">สถานะการตรวจรายจุดปฏิบัติงาน</h2>
          <p>วันที่ {thaiDate(day, { day: 'numeric', month: 'long', year: 'numeric' })} (07:00 – 07:00 น.){day === current.day ? ` · ตอนนี้รอบที่ ${current.round}/${PATROL_ROUNDS} (${current.label} น.)` : ''}</p>
        </div>
        <div className="patrol-master-head__actions">{dayPicker}</div>
      </header>

      <div className="patrol-kpis" aria-label="สรุปทุกจุดปฏิบัติงาน">
        <div className="patrol-kpi"><span>ตรวจครบแล้ว</span><strong>{totals.done}<small>/{totals.due} รอบ-จุด</small></strong></div>
        <div className="patrol-kpi patrol-kpi--pending"><span>ขาดตรวจ</span><strong>{totals.missed}<small> รอบ-จุด</small></strong></div>
        <div className="patrol-kpi"><span>จุดปฏิบัติงานที่ยังไม่ครบ</span><strong>{totals.departments}<small>/{summaries.length}</small></strong></div>
        <div className="patrol-kpi patrol-kpi--done"><span>ความครบถ้วน</span><strong>{totals.due ? Math.round((totals.done / totals.due) * 100) : 0}%</strong><i style={{ width: `${totals.due ? Math.round((totals.done / totals.due) * 100) : 0}%` }} aria-hidden="true" /></div>
      </div>

      {loading ? <div className="patrol-empty">กำลังโหลด…</div> : summaries.length === 0 ? <div className="patrol-empty"><SmsIcon name="location" size={28} /><p>ยังไม่มีจุดตรวจ{isAdmin ? ' — เริ่มต้นที่แท็บ “จุดตรวจและ QR”' : ''}</p></div>
        : <div className="data-table-scroll"><table className="data-surface-table patrol-dept-table" aria-label="สถานะการตรวจรายจุดปฏิบัติงาน">
          <thead><tr><th scope="col">จุดปฏิบัติงาน</th><th scope="col">จุดตรวจ</th><th scope="col">รอบปัจจุบัน</th><th scope="col">ความครบถ้วนวันนี้</th><th scope="col">ขาดตรวจ</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">เปิด</span></th></tr></thead>
          <tbody>{summaries.map((row) => <tr key={row.department} className="patrol-dept-row" onClick={() => setOpenDepartment(row.department)}>
            <td><button type="button" className="patrol-dept-name" onClick={(event) => { event.stopPropagation(); setOpenDepartment(row.department); }}>{row.department}</button></td>
            <td className="tabular">{row.checkpoints} จุด</td>
            <td className="tabular">{row.currentRound ? <span>รอบ {row.currentRound} · <b>{row.currentDone}/{row.checkpoints}</b></span> : '—'}</td>
            <td><div className="patrol-meter"><i style={{ width: `${row.percent}%` }} className={`is-${row.status}`} /></div><small className="tabular">{row.done}/{row.due} · {row.percent}%</small></td>
            <td className={`tabular ${row.missed ? 'patrol-text-bad' : ''}`}>{row.missed}</td>
            <td><span className={`patrol-badge patrol-badge--${row.status}`}>{STATUS_LABEL[row.status]}</span></td>
            <td className="patrol-dept-chevron" aria-hidden="true">›</td>
          </tr>)}</tbody>
        </table></div>}
    </section>}

    {tab === 'board' && openDepartment && departmentBoard && <section className="line-settings-card patrol-master-card" aria-labelledby="patrol-dept-title">
      <header className="patrol-master-head">
        <div>
          <button type="button" className="patrol-back" onClick={() => setOpenDepartment(undefined)}>‹ ทุกจุดปฏิบัติงาน</button>
          <h2 id="patrol-dept-title">จุดปฏิบัติงาน {openDepartment}</h2>
          <p><span>{thaiDate(day, { day: 'numeric', month: 'long', year: 'numeric' })}</span> · <span>ตรวจแล้ว {departmentBoard.summary.done}/{departmentBoard.summary.due} รอบ-จุด</span> · <span>ขาด {departmentBoard.summary.missed}</span></p>
        </div>
        <div className="patrol-master-head__actions">{dayPicker}<button type="button" className="btn-primary" disabled={busy} onClick={() => void printReport('department', { from: day, to: day, department: openDepartment })}><SmsIcon name="report" size={16} />พิมพ์รายงานจุดปฏิบัติงานนี้</button></div>
      </header>
      <div className="patrol-legend" aria-label="คำอธิบายสัญลักษณ์"><span><i className="patrol-cell--done">✓</i>ตรวจแล้ว (เวลาที่สแกน)</span><span><i className="patrol-cell--pending">●</i>อยู่ในรอบ ยังไม่ตรวจ</span><span><i className="patrol-cell--missed">✕</i>ไม่ได้ตรวจ</span><span><i className="patrol-cell--future" />ยังไม่ถึงรอบ</span></div>
      {departmentBoard.rows.length === 0 ? <div className="patrol-empty"><p>จุดปฏิบัติงานนี้ยังไม่มีจุดตรวจที่เปิดใช้งาน</p></div> : <>
        <div className="patrol-board-scroll patrol-round-desktop">
          <table className="patrol-board patrol-round-board">
            <thead><tr><th scope="col" className="patrol-board__sticky">จุดตรวจ</th>{departmentBoard.windows.map((window) => <th scope="col" key={window.round} className={departmentBoard.summary.currentRound === window.round ? 'is-today' : ''}><b>รอบ {window.round}</b><span>{window.label}</span></th>)}<th scope="col">รวม</th></tr></thead>
            <tbody>{departmentBoard.rows.map((row) => <tr key={row.id}>
              <th scope="row" className="patrol-board__sticky"><strong>{row.code}</strong><small>{row.name}</small></th>
              {row.cells.map((cell) => {
                const label = departmentBoard.windows[cell.round - 1].label;
                const title = cellTitle(row.code, cell, label);
                return <td key={cell.round} className={`patrol-cell patrol-cell--${cell.tone === 'current' ? 'pending' : cell.tone === 'upcoming' ? 'future' : cell.tone}`}>
                  {cell.tone === 'done' ? <button type="button" className="patrol-round-hit" title={title} aria-label={title} onClick={() => setPhotoCell({ cell, title: `${row.code} ${row.name} · รอบ ${cell.round} (${label} น.)` })}>{thaiTime(cell.lastScanAt)}{cell.count > 1 && <sup>×{cell.count}</sup>}</button>
                    : <span title={title} aria-label={title}>{cell.tone === 'missed' ? '✕' : cell.tone === 'current' ? '●' : ''}</span>}
                </td>;
              })}
              <td className="patrol-board__total">{row.done}/{row.due || 0}</td>
            </tr>)}</tbody>
            <tfoot><tr><th scope="row" className="patrol-board__sticky">ตรวจแล้วในรอบ</th>{departmentBoard.rounds.map((round) => <td key={round.round} className="patrol-board__total">{round.done}/{round.total}</td>)}<td className="patrol-board__total">{departmentBoard.summary.percent}%</td></tr></tfoot>
          </table>
        </div>
        <ul className="patrol-round-mobile" aria-label="สถานะรายจุด">{departmentBoard.rows.map((row) => <li key={row.id}>
          <header><strong>{row.code}</strong><span>{row.name}</span><em>{row.done}/{row.due}</em></header>
          <ol>{row.cells.map((cell) => {
            const label = departmentBoard.windows[cell.round - 1].label;
            const title = cellTitle(row.code, cell, label);
            return <li key={cell.round} className={`is-${cell.tone}`}>{cell.tone === 'done'
              ? <button type="button" aria-label={title} onClick={() => setPhotoCell({ cell, title: `${row.code} · รอบ ${cell.round} (${label} น.)` })}><b>{cell.round}</b><small>{thaiTime(cell.lastScanAt)}</small></button>
              : <span aria-label={title}><b>{cell.round}</b><small>{cell.tone === 'missed' ? 'ขาด' : cell.tone === 'current' ? 'รอบนี้' : label.slice(0, 5)}</small></span>}</li>;
          })}</ol>
        </li>)}</ul>
      </>}
    </section>}

    {tab === 'checkpoints' && isAdmin && !manageDepartment && <section className="line-settings-card patrol-master-card" aria-labelledby="patrol-cp-title">
      <header className="patrol-master-head">
        <div><h2 id="patrol-cp-title">จุดตรวจและ QR</h2><p>เลือกจุดปฏิบัติงาน แล้วสร้างจุดตรวจและพิมพ์ป้าย QR ของจุดปฏิบัติงานนั้น</p></div>
        <div className="patrol-master-head__actions">
          <button type="button" className="btn-neutral" disabled={busy || !checkpoints.some((item) => item.isActive)} onClick={() => void printQr(checkpoints)}><SmsIcon name="qr" size={16} />พิมพ์ QR ทั้งหมด</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => setDepartmentDialog(true)}><SmsIcon name="plus" size={16} />เพิ่มจุดปฏิบัติงาน</button>
        </div>
      </header>
      {departments.length === 0 ? <div className="patrol-empty"><SmsIcon name="qr" size={28} /><p>ยังไม่มีจุดตรวจ กด “เพิ่มจุดปฏิบัติงาน” เพื่อเริ่มต้น</p></div>
        : <div className="data-table-scroll"><table className="data-surface-table patrol-dept-table" aria-label="จุดปฏิบัติงานที่มีจุดตรวจ">
          <thead><tr><th scope="col">จุดปฏิบัติงาน</th><th scope="col">จุดที่ใช้งาน</th><th scope="col">ปิดใช้งาน</th><th scope="col">จัดการ</th></tr></thead>
          <tbody>{departments.map((dept) => {
            const items = checkpoints.filter((item) => item.department === dept);
            const active = items.filter((item) => item.isActive);
            return <tr key={dept} className="patrol-dept-row" onClick={() => setManageDepartment(dept)}>
              <td><button type="button" className="patrol-dept-name" onClick={(event) => { event.stopPropagation(); setManageDepartment(dept); }}>{dept}</button></td>
              <td className="tabular">{active.length} จุด</td>
              <td className="tabular">{items.length - active.length}</td>
              <td><div className="leave-type-row-actions" onClick={(event) => event.stopPropagation()}>
                <button type="button" className="btn-neutral small-action" disabled={busy || active.length === 0} onClick={() => void printQr(items)}><SmsIcon name="qr" size={16} />พิมพ์ QR</button>
                <span className="patrol-dept-chevron" aria-hidden="true">›</span>
              </div></td>
            </tr>;
          })}</tbody>
        </table></div>}
    </section>}

    {tab === 'checkpoints' && isAdmin && manageDepartment && <section className="line-settings-card patrol-master-card" aria-labelledby="patrol-cpd-title">
      <header className="patrol-master-head">
        <div>
          <button type="button" className="patrol-back" onClick={() => setManageDepartment(undefined)}>‹ ทุกจุดปฏิบัติงาน</button>
          <h2 id="patrol-cpd-title">จุดตรวจของจุดปฏิบัติงาน {manageDepartment}</h2>
          <p>เรียงตามลำดับการเดินตรวจ · QR ของแต่ละจุดใช้สแกนได้เฉพาะจุดนั้น</p>
        </div>
        <div className="patrol-master-head__actions">
          <button type="button" className="btn-neutral" disabled={busy || !checkpoints.some((item) => item.department === manageDepartment && item.isActive)} onClick={() => void printQr(checkpoints.filter((item) => item.department === manageDepartment))}><SmsIcon name="qr" size={16} />พิมพ์ QR จุดปฏิบัติงานนี้</button>
          <button type="button" className="btn-primary" disabled={busy} onClick={() => { setDialogError(undefined); setEditing({ department: manageDepartment }); }}><SmsIcon name="plus" size={16} />เพิ่มจุดตรวจ</button>
        </div>
      </header>
      {(() => {
        const items = checkpoints.filter((item) => item.department === manageDepartment);
        if (!items.length) return <div className="patrol-empty"><SmsIcon name="location" size={28} /><p>ยังไม่มีจุดตรวจในจุดปฏิบัติงานนี้ กด “เพิ่มจุดตรวจ”</p></div>;
        return <div className="data-table-scroll"><table className="data-surface-table patrol-cp-table" aria-label={`จุดตรวจของจุดปฏิบัติงาน ${manageDepartment}`}>
          <thead><tr><th scope="col">ลำดับ</th><th scope="col">รหัส</th><th scope="col">ชื่อจุดตรวจ</th><th scope="col">ตำแหน่ง</th><th scope="col">QR</th><th scope="col">สถานะ</th><th scope="col"><span className="sr-only">จัดการ</span></th></tr></thead>
          <tbody>{items.map((item) => <tr key={item.id} className={item.isActive ? '' : 'is-inactive'}>
            <td className="tabular">{item.sortOrder ?? 0}</td>
            <td className="leave-type-code">{item.code}</td>
            <td><strong>{item.name}</strong></td>
            <td className="patrol-muted">{item.locationNote || '—'}</td>
            <td className="tabular">v{item.qrVersion}</td>
            <td><span className={`leave-type-status ${item.isActive ? 'is-active' : 'is-inactive'}`}>{item.isActive ? 'เปิดใช้งาน' : 'ปิดใช้งาน'}</span></td>
            <td><div className="leave-type-row-actions">
              <button type="button" className="leave-type-icon-button" disabled={busy || !item.isActive} aria-label={`พิมพ์ QR ${item.code}`} title="พิมพ์ QR" onClick={() => void printQr([item])}><SmsIcon name="qr" size={16} /></button>
              <EditIconButton label={`แก้ไข ${item.code}`} disabled={busy} onClick={() => { setDialogError(undefined); setEditing({ department: item.department, item }); }} />
              <button type="button" className="leave-type-icon-button" disabled={busy || !item.isActive} aria-label={`ออก QR ใหม่ ${item.code}`} title="ออก QR ใหม่" onClick={() => void rotate(item)}><SmsIcon name="refresh" size={16} /></button>
              <button type="button" className={`leave-type-icon-button ${item.isActive ? 'is-danger' : 'is-success'}`} disabled={busy} aria-label={`${item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} ${item.code}`} title={item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'} onClick={() => void toggleActive(item)}><SmsIcon name={item.isActive ? 'pause' : 'check'} size={16} /></button>
            </div></td>
          </tr>)}</tbody>
        </table></div>;
      })()}
    </section>}

    {tab === 'reports' && <PatrolReportPanel departments={departments} busy={busy} from={reportFrom} to={reportTo} department={reportDepartment} onFrom={setReportFrom} onTo={setReportTo} onDepartment={setReportDepartment} onPrint={(kind) => void printReport(kind)} />}

    {editing && <CheckpointDialog key={editing.item?.id || `new-${editing.department}`} department={editing.department} initial={editing.item} busy={busy} error={dialogError} onSubmit={(input) => void saveCheckpoint(input)} onClose={() => setEditing(undefined)} />}
    {departmentDialog && <DepartmentDialog known={masterDepartments.filter((item) => !departments.includes(item))} busy={busy} onClose={() => setDepartmentDialog(false)} onSubmit={(name) => { setDepartmentDialog(false); setPendingDepartments((current) => current.includes(name) ? current : [...current, name]); setManageDepartment(name); setDialogError(undefined); setEditing({ department: name }); }} />}
    {photoCell && <PhotoDialog token={token} cell={photoCell.cell} title={photoCell.title} onClose={() => setPhotoCell(undefined)} />}
    {printJob && <PatrolReportPrint kind={printJob.kind} report={printJob.report} today={today} now={now} />}
    {qrSheet.length > 0 && <PatrolCheckpointQrSheet items={qrSheet} />}
    {actionDialog.dialog}
  </section>;
}

/** Shared print panel: used in the Patrol Center and in Report Center → ส่งออกและพิมพ์. */
export function PatrolReportPanel({ departments, busy, from, to, department, onFrom, onTo, onDepartment, onPrint }: { departments: string[]; busy: boolean; from: string; to: string; department: string; onFrom(value: string): void; onTo(value: string): void; onDepartment(value: string): void; onPrint(kind: PatrolPrintKind): void }) {
  const cards: Array<[PatrolPrintKind, string, string, 'clock' | 'employees' | 'report', string]> = [
    ['daily', 'รายงานการตรวจประจำวัน', `วันที่ ${thaiDate(to)} ${department ? `· จุดปฏิบัติงาน ${department}` : '· ทุกจุดปฏิบัติงาน'} — ตาราง 8 รอบของทุกจุด และรายการสแกนเรียงตามเวลา`, 'clock', 'PDF · A4 แนวนอน'],
    ['department', 'รายงานการตรวจรายจุดปฏิบัติงาน', department ? `จุดปฏิบัติงาน ${department} · ${thaiDate(from)} – ${thaiDate(to)}` : 'เลือกจุดปฏิบัติงานด้านบนก่อน', 'employees', 'PDF · A4 แนวนอน'],
    ['all', 'รายงานการตรวจทั้งหมดทุกจุดปฏิบัติงาน', `${thaiDate(from)} – ${thaiDate(to)} · สรุปจำนวนรอบที่ตรวจครบ แยกจุดปฏิบัติงาน`, 'report', 'PDF · A4 แนวนอน']
  ];
  return <section className="line-settings-card patrol-master-card" aria-labelledby="patrol-report-title">
    <header className="patrol-master-head"><div><h2 id="patrol-report-title">พิมพ์รายงานการตรวจ</h2><p>ทุกรายงานใช้หัวกระดาษมาตรฐานของระบบ · นับรอบตามวันตรวจ 07:00 – 07:00 น.</p></div></header>
    <div className="patrol-filters">
      <label className="patrol-field"><span>ตั้งแต่</span><input type="date" value={from} max={to} onChange={(event) => onFrom(event.target.value)} /></label>
      <label className="patrol-field"><span>ถึง</span><input type="date" value={to} min={from} onChange={(event) => onTo(event.target.value)} /></label>
      <label className="patrol-field"><span>จุดปฏิบัติงาน</span><select value={department} onChange={(event) => onDepartment(event.target.value)}><option value="">ทุกจุดปฏิบัติงาน</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
    </div>
    <div className="patrol-report-grid">
      {cards.map(([kind, title, description, icon, format]) => <article className={`patrol-report-card patrol-report-card--${kind}`} key={kind}>
        <div className="patrol-report-card__icon" aria-hidden="true"><SmsIcon name={icon} size={22} /></div>
        <div className="patrol-report-card__body"><h3>{title}</h3><p>{description}</p><small>{format}</small></div>
        <button type="button" className="btn-primary" disabled={busy || (kind === 'department' && !department)} onClick={() => onPrint(kind)}>{busy ? 'กำลังเตรียม…' : 'พิมพ์'}</button>
      </article>)}
    </div>
  </section>;
}
