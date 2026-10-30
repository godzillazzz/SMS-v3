import { flushSync } from 'react-dom';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageHeader, SectionCard } from '../../components/layout';
import { SmsIcon } from '../../components/SmsIcon';
import { useActionDialog } from '../../components/useActionDialog';
import { createSecuritySiteQrDataUrl } from '../../components/security-site-qr';
import { printDocument } from '../../schedule-print';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { patrolApi } from './patrol-client';
import { bangkokToday, coverageCellTone, formatPatrolPercent, summarizeByDepartment, thaiDate, thaiTime, type PatrolCheckpoint, type PatrolReport } from './patrol-model';
import { PatrolCheckpointQrSheet, PatrolReportPrint, type PatrolPrintKind } from './PatrolPrint';
import './patrol.css';

type Tab = 'board' | 'checkpoints' | 'reports';

function monthStart(today: string) { return `${today.slice(0, 8)}01`; }
function addDays(date: string, days: number) { return new Date(new Date(`${date}T00:00:00.000Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10); }

function CheckpointForm({ initial, departments, onSubmit, onCancel, busy }: { initial?: PatrolCheckpoint; departments: string[]; onSubmit: (input: { code: string; name: string; department: string; locationNote: string; sortOrder: number }) => void; onCancel: () => void; busy: boolean }) {
  const [code, setCode] = useState(initial?.code || '');
  const [name, setName] = useState(initial?.name || '');
  const [department, setDepartment] = useState(initial?.department || '');
  const [locationNote, setLocationNote] = useState(initial?.locationNote || '');
  const [sortOrder, setSortOrder] = useState(String(initial?.sortOrder ?? 0));
  const valid = code.trim() && name.trim() && department.trim();
  return <form className="patrol-form" onSubmit={(event) => { event.preventDefault(); if (valid) onSubmit({ code: code.trim(), name: name.trim(), department: department.trim(), locationNote: locationNote.trim(), sortOrder: Number(sortOrder) || 0 }); }}>
    <div className="patrol-form__grid">
      <label className="patrol-field"><span>รหัสจุด *</span><input value={code} disabled={Boolean(initial)} maxLength={50} onChange={(event) => setCode(event.target.value)} placeholder="เช่น ANO-01" required /></label>
      <label className="patrol-field"><span>ชื่อจุดตรวจ *</span><input value={name} maxLength={150} onChange={(event) => setName(event.target.value)} placeholder="เช่น ประตูทางเข้าหลัก" required /></label>
      <label className="patrol-field"><span>แผนก *</span><input list="patrol-department-options" value={department} maxLength={100} onChange={(event) => setDepartment(event.target.value)} placeholder="เลือกหรือพิมพ์แผนก" required /><datalist id="patrol-department-options">{departments.map((item) => <option key={item} value={item} />)}</datalist></label>
      <label className="patrol-field"><span>ลำดับ</span><input type="number" min={0} value={sortOrder} onChange={(event) => setSortOrder(event.target.value)} /></label>
      <label className="patrol-field patrol-field--wide"><span>ตำแหน่ง / คำอธิบาย</span><input value={locationNote} maxLength={500} onChange={(event) => setLocationNote(event.target.value)} placeholder="เช่น ด้านหลังอาคาร B ชั้น 1" /></label>
    </div>
    <div className="patrol-form__actions">
      <button type="button" className="btn-neutral" onClick={onCancel} disabled={busy}>ยกเลิก</button>
      <button type="submit" className="btn-primary" disabled={!valid || busy}>{busy ? 'กำลังบันทึก…' : initial ? 'บันทึกการแก้ไข' : 'สร้างจุดตรวจ'}</button>
    </div>
  </form>;
}

export function PatrolCenterPage({ token, role }: { token: string; role: string }) {
  const actionDialog = useActionDialog();
  const isAdmin = role === 'ADMIN';
  const today = bangkokToday();
  const [tab, setTab] = useState<Tab>('board');
  const [boardFrom, setBoardFrom] = useState(addDays(today, -6));
  const [boardTo, setBoardTo] = useState(today);
  const [department, setDepartment] = useState('');
  const [board, setBoard] = useState<PatrolReport>();
  const [boardLoading, setBoardLoading] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [checkpoints, setCheckpoints] = useState<PatrolCheckpoint[]>([]);
  const [editing, setEditing] = useState<PatrolCheckpoint | 'new'>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [reportFrom, setReportFrom] = useState(today);
  const [reportTo, setReportTo] = useState(today);
  const [reportDepartment, setReportDepartment] = useState('');
  const [printJob, setPrintJob] = useState<{ kind: PatrolPrintKind; report: PatrolReport }>();
  const [qrSheet, setQrSheet] = useState<Array<PatrolCheckpoint & { dataUrl: string }>>([]);

  const loadBoard = useCallback(async () => {
    setBoardLoading(true); setError(undefined);
    try { setBoard(await patrolApi.report(token, { from: boardFrom, to: boardTo, department: department || undefined })); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถโหลดสถานะการตรวจได้')); }
    finally { setBoardLoading(false); }
  }, [token, boardFrom, boardTo, department]);

  const loadCheckpoints = useCallback(async () => {
    try { setCheckpoints(await patrolApi.checkpoints(token, isAdmin)); }
    catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถโหลดจุดตรวจได้')); }
  }, [token, isAdmin]);

  useEffect(() => { if (tab === 'board') void loadBoard(); }, [tab, loadBoard]);
  useEffect(() => { void loadCheckpoints(); }, [loadCheckpoints]);

  const departments = useMemo(() => [...new Set(checkpoints.map((item) => item.department))].sort((a, b) => a.localeCompare(b, 'th')), [checkpoints]);
  const departmentSummary = useMemo(() => summarizeByDepartment(board?.coverage.departments || []), [board]);

  const saveCheckpoint = async (input: { code: string; name: string; department: string; locationNote: string; sortOrder: number }) => {
    setBusy(true); setError(undefined);
    try {
      if (editing === 'new') await patrolApi.createCheckpoint(token, input);
      else if (editing) await patrolApi.updateCheckpoint(token, editing.id, { name: input.name, department: input.department, locationNote: input.locationNote || null, sortOrder: input.sortOrder });
      setEditing(undefined); setNotice(editing === 'new' ? `สร้างจุดตรวจ ${input.code.toUpperCase()} แล้ว` : 'บันทึกจุดตรวจแล้ว');
      await loadCheckpoints();
    } catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถบันทึกจุดตรวจได้')); }
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

  const printReport = async (kind: PatrolPrintKind) => {
    const from = kind === 'daily' ? reportTo : reportFrom;
    const to = reportTo;
    if (kind === 'department' && !reportDepartment) { setNotice('กรุณาเลือกแผนกสำหรับรายงานรายแผนก'); return; }
    setBusy(true); setError(undefined);
    try {
      const report = await patrolApi.report(token, { from, to, department: kind === 'all' ? undefined : reportDepartment || undefined });
      flushSync(() => setPrintJob({ kind, report }));
      const label = kind === 'daily' ? 'รายงานการตรวจประจำวัน' : kind === 'department' ? `รายงานการตรวจ-${reportDepartment}` : 'รายงานการตรวจทุกแผนก';
      await printDocument('.patrol-report-print', `${label}-${from}${from === to ? '' : `_${to}`}.pdf`, { orientation: kind === 'daily' ? 'portrait' : 'landscape', margin: '10mm' });
    } catch (reason) { setError(toRequestErrorState(reason, 'ไม่สามารถพิมพ์รายงานการตรวจได้')); }
    finally { setPrintJob(undefined); setBusy(false); }
  };

  const tabs: Array<[Tab, string, string]> = [['board', 'สถานะการตรวจ', 'calendar'], ...(isAdmin ? [['checkpoints', 'จุดตรวจและ QR', 'qr'] as [Tab, string, string]] : []), ['reports', 'พิมพ์รายงาน', 'report']];

  return <section className="patrol-center view-pane layout-page-surface" aria-label="ศูนย์ตรวจจุด">
    <PageHeader kicker="ตรวจจุด (Patrol)" title="ศูนย์ตรวจจุด" description="ติดตามว่าแผนกไหน จุดไหน สแกนตรวจแล้วหรือยัง จัดการ QR จุดตรวจ และพิมพ์รายงาน" />

    <div className="patrol-tabs" role="tablist" aria-label="เมนูศูนย์ตรวจจุด">
      {tabs.map(([id, label, icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}><SmsIcon name={icon as 'calendar'} size={17} />{label}</button>)}
    </div>

    {error && <div className="patrol-alert" role="alert"><SmsIcon name="shield" size={18} /><div><RequestErrorContent error={error} /></div></div>}
    {notice && <div className="patrol-notice" role="status"><SmsIcon name="check" size={18} /><span>{notice}</span><button type="button" onClick={() => setNotice(undefined)} aria-label="ปิดข้อความ"><SmsIcon name="close" size={16} /></button></div>}

    {tab === 'board' && <>
      <SectionCard kicker="ตัวกรอง" title="ช่วงวันที่" description="เลือกช่วงวันที่และแผนกที่ต้องการติดตาม" className="patrol-filter-card">
        <div className="patrol-filters">
          <label className="patrol-field"><span>ตั้งแต่</span><input type="date" value={boardFrom} max={boardTo} onChange={(event) => setBoardFrom(event.target.value)} /></label>
          <label className="patrol-field"><span>ถึง</span><input type="date" value={boardTo} min={boardFrom} onChange={(event) => setBoardTo(event.target.value)} /></label>
          <label className="patrol-field"><span>แผนก</span><select value={department} onChange={(event) => setDepartment(event.target.value)}><option value="">ทุกแผนก</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          <div className="patrol-quick">
            <button type="button" className="btn-neutral" onClick={() => { setBoardFrom(today); setBoardTo(today); }}>วันนี้</button>
            <button type="button" className="btn-neutral" onClick={() => { setBoardFrom(addDays(today, -6)); setBoardTo(today); }}>7 วัน</button>
            <button type="button" className="btn-neutral" onClick={() => { setBoardFrom(monthStart(today)); setBoardTo(today); }}>เดือนนี้</button>
          </div>
        </div>
      </SectionCard>

      <div className="patrol-kpis" aria-label="สรุป">
        <div className="patrol-kpi"><span>จุดตรวจ</span><strong>{board?.coverage.summary.checkpoints ?? '—'}</strong></div>
        <div className="patrol-kpi patrol-kpi--done"><span>ตรวจแล้ว (จุด-วัน)</span><strong>{board?.coverage.summary.scanned ?? '—'}</strong></div>
        <div className="patrol-kpi patrol-kpi--pending"><span>ยังไม่ตรวจ</span><strong>{board?.coverage.summary.pending ?? '—'}</strong></div>
        <div className="patrol-kpi"><span>ครอบคลุม</span><strong>{board ? formatPatrolPercent(board.coverage.summary.percent) : '—'}</strong><i style={{ width: `${board?.coverage.summary.percent ?? 0}%` }} aria-hidden="true" /></div>
      </div>

      {departmentSummary.length > 0 && <div className="patrol-dept-strip" aria-label="สรุปรายแผนก">
        {departmentSummary.map((item) => <button type="button" key={item.department} className={`patrol-dept-pill ${department === item.department ? 'active' : ''}`} onClick={() => setDepartment(department === item.department ? '' : item.department)}>
          <strong>{item.department}</strong><span>{item.scanned}/{item.total}</span><em className={item.percent === 100 ? 'is-full' : item.percent === 0 ? 'is-zero' : ''}>{item.percent}%</em>
        </button>)}
      </div>}

      <SectionCard kicker="ตารางสถานะ" title="จุดตรวจ × วันที่" description="แต่ละช่อง = จุดตรวจ 1 จุดใน 1 วัน" className="patrol-board-card">
        <div className="patrol-legend" aria-label="คำอธิบายสัญลักษณ์"><span><i className="patrol-cell--done">✓</i>ตรวจแล้ว (ตัวเลข = จำนวนครั้ง)</span><span><i className="patrol-cell--pending">●</i>รอตรวจวันนี้</span><span><i className="patrol-cell--missed">✕</i>ไม่ได้ตรวจ</span></div>
        {boardLoading ? <div className="patrol-empty">กำลังโหลด…</div>
          : !board || board.coverage.departments.length === 0 ? <div className="patrol-empty"><SmsIcon name="location" size={28} /><p>ยังไม่มีจุดตรวจ{isAdmin ? ' — เริ่มต้นที่แท็บ “จุดตรวจและ QR”' : ''}</p></div>
          : <div className="patrol-board-scroll">
            <table className="patrol-board">
              <thead><tr>
                <th scope="col" className="patrol-board__sticky">จุดตรวจ</th>
                {board.coverage.dates.map((day) => <th scope="col" key={day} className={day === today ? 'is-today' : ''}><span>{thaiDate(day, { weekday: 'short' })}</span><b>{Number(day.slice(8))}</b></th>)}
                <th scope="col">รวม</th>
              </tr></thead>
              {board.coverage.departments.map((group) => <tbody key={group.department}>
                <tr className="patrol-board__group"><th scope="rowgroup" colSpan={board.coverage.dates.length + 2}><span>{group.department}</span><small>{group.scanned}/{group.total} · {group.total ? Math.round(group.scanned / group.total * 100) : 0}%</small></th></tr>
                {group.checkpoints.map((item) => <tr key={item.id}>
                  <th scope="row" className="patrol-board__sticky"><strong>{item.code}</strong><small>{item.name}</small></th>
                  {board.coverage.dates.map((day) => {
                    const cell = item.days[day];
                    const tone = coverageCellTone(cell, day, today);
                    const title = cell?.count ? `${item.code} ${thaiDate(day)} · ${cell.count} ครั้ง · ล่าสุด ${thaiTime(cell.lastScanAt)} น. โดย ${cell.lastEmployeeName || '-'}` : `${item.code} ${thaiDate(day)} · ยังไม่ตรวจ`;
                    return <td key={day} className={`patrol-cell patrol-cell--${tone}`} title={title} aria-label={title}>{tone === 'done' ? <span>{cell.count > 1 ? cell.count : '✓'}</span> : tone === 'pending' ? <span>●</span> : tone === 'missed' ? <span>✕</span> : <span />}</td>;
                  })}
                  <td className="patrol-board__total">{item.scannedDays}/{board.coverage.dates.length}</td>
                </tr>)}
              </tbody>)}
            </table>
          </div>}
      </SectionCard>
    </>}

    {tab === 'checkpoints' && isAdmin && <SectionCard kicker="จัดการ" title="จุดตรวจและ QR" description="สร้างจุดตรวจของแต่ละแผนก แล้วพิมพ์ป้าย QR ไปติดที่จุดจริง" actions={<div className="patrol-actions">
      <button type="button" className="btn-neutral" disabled={busy || !checkpoints.some((item) => item.isActive)} onClick={() => void printQr(checkpoints)}><SmsIcon name="qr" size={17} />พิมพ์ QR ทั้งหมด</button>
      <button type="button" className="btn-primary" disabled={busy} onClick={() => setEditing('new')}><SmsIcon name="plus" size={17} />เพิ่มจุดตรวจ</button>
    </div>}>
      {editing && <CheckpointForm key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing} departments={departments} busy={busy} onSubmit={(input) => void saveCheckpoint(input)} onCancel={() => setEditing(undefined)} />}
      {checkpoints.length === 0 ? <div className="patrol-empty"><SmsIcon name="qr" size={28} /><p>ยังไม่มีจุดตรวจ กด “เพิ่มจุดตรวจ” เพื่อเริ่มต้น</p></div> : departments.map((dept) => <div className="patrol-cp-group" key={dept}>
        <header><h3>{dept}</h3><span>{checkpoints.filter((item) => item.department === dept && item.isActive).length} จุดที่ใช้งาน</span><button type="button" className="btn-neutral btn-compact" disabled={busy} onClick={() => void printQr(checkpoints.filter((item) => item.department === dept))}>พิมพ์ QR แผนกนี้</button></header>
        <ul className="patrol-cp-list">
          {checkpoints.filter((item) => item.department === dept).map((item) => <li key={item.id} className={item.isActive ? '' : 'is-inactive'}>
            <div className="patrol-cp-list__id"><strong>{item.code}</strong><span className={`patrol-status ${item.isActive ? 'patrol-status--on' : 'patrol-status--off'}`}>{item.isActive ? 'ใช้งาน' : 'ปิดใช้งาน'}</span></div>
            <div className="patrol-cp-list__body"><b>{item.name}</b>{item.locationNote && <small>{item.locationNote}</small>}<small>QR v{item.qrVersion}</small></div>
            <div className="patrol-cp-list__actions">
              <button type="button" className="btn-neutral btn-compact" disabled={busy || !item.isActive} onClick={() => void printQr([item])} title="พิมพ์ QR">QR</button>
              <button type="button" className="btn-neutral btn-compact" disabled={busy} onClick={() => setEditing(item)}>แก้ไข</button>
              <button type="button" className="btn-neutral btn-compact" disabled={busy || !item.isActive} onClick={() => void rotate(item)}>ออก QR ใหม่</button>
              <button type="button" className={`btn-compact ${item.isActive ? 'btn-danger-soft' : 'btn-neutral'}`} disabled={busy} onClick={() => void toggleActive(item)}>{item.isActive ? 'ปิดใช้งาน' : 'เปิดใช้งาน'}</button>
            </div>
          </li>)}
        </ul>
      </div>)}
    </SectionCard>}

    {tab === 'reports' && <SectionCard kicker="รายงาน" title="พิมพ์รายงานการตรวจ" description="ทุกรายงานใช้หัวกระดาษมาตรฐานของระบบ">
      <div className="patrol-filters">
        <label className="patrol-field"><span>ตั้งแต่</span><input type="date" value={reportFrom} max={reportTo} onChange={(event) => setReportFrom(event.target.value)} /></label>
        <label className="patrol-field"><span>ถึง</span><input type="date" value={reportTo} min={reportFrom} onChange={(event) => setReportTo(event.target.value)} /></label>
        <label className="patrol-field"><span>แผนก</span><select value={reportDepartment} onChange={(event) => setReportDepartment(event.target.value)}><option value="">ทุกแผนก</option>{departments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      </div>
      <div className="patrol-report-grid">
        {([
          ['daily', 'รายงานการตรวจประจำวัน', `วันที่ ${thaiDate(reportTo)} ${reportDepartment ? `· แผนก ${reportDepartment}` : '· ทุกแผนก'} — รายการสแกนเรียงตามเวลา คล้ายรายงานการลงเวลาประจำวัน`, 'clock', 'PDF · A4 แนวตั้ง'],
          ['department', 'รายงานการตรวจรายแผนก', reportDepartment ? `แผนก ${reportDepartment} · ${thaiDate(reportFrom)} – ${thaiDate(reportTo)}` : 'เลือกแผนกด้านบนก่อน', 'employees', 'PDF · A4 แนวนอน'],
          ['all', 'รายงานการตรวจทั้งหมดทุกแผนก', `${thaiDate(reportFrom)} – ${thaiDate(reportTo)} · สรุปแยกแผนกพร้อมตารางสถานะ`, 'report', 'PDF · A4 แนวนอน']
        ] as Array<[PatrolPrintKind, string, string, string, string]>).map(([kind, title, description, icon, format]) => <article className={`patrol-report-card patrol-report-card--${kind}`} key={kind}>
          <div className="patrol-report-card__icon" aria-hidden="true"><SmsIcon name={icon as 'report'} size={22} /></div>
          <div className="patrol-report-card__body"><h3>{title}</h3><p>{description}</p><small>{format}</small></div>
          <button type="button" className="btn-primary" disabled={busy || (kind === 'department' && !reportDepartment)} onClick={() => void printReport(kind)}>{busy ? 'กำลังเตรียม…' : 'พิมพ์'}</button>
        </article>)}
      </div>
    </SectionCard>}

    {printJob && <PatrolReportPrint kind={printJob.kind} report={printJob.report} today={today} />}
    {qrSheet.length > 0 && <PatrolCheckpointQrSheet items={qrSheet} />}
    {actionDialog.dialog}
  </section>;
}
