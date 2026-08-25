import { useEffect, useMemo, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import { printDocument } from '../../schedule-print';
import {
  attendanceCertifications,
  attendanceCertify,
  attendanceCorrect,
  attendanceDownloadXlsx,
  attendanceMonthPreview,
  attendanceOfficialReport,
  attendanceSupervisorDaily,
  attendanceUnlock,
  type AttendanceDailyData,
  type AttendanceMonthPreview,
  type AttendanceOfficialReport,
  type AttendanceSupervisorRow
} from './attendance-operations-client';

type Props = {
  token: string;
  role?: string;
  department?: string;
  readOnly?: boolean;
  online?: boolean;
};

function bangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function timeText(value: unknown) {
  if (!value) return '—';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'short', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(date);
}

function siteText(site: AttendanceSupervisorRow['expectedSite']) {
  if (!site) return '—';
  return [site.code, site.name].filter(Boolean).join(' · ') || '—';
}

function reportValue(row: Record<string, unknown>, key: string) {
  const value = row[key];
  if (Array.isArray(value)) return value.join(', ');
  return value == null || value === '' ? '—' : String(value);
}

const summaryKeys: Array<[string, string]> = [
  ['scheduledToday', 'ตามตารางวันนี้'], ['checkedIn', 'ลงเวลาเข้าแล้ว'], ['currentlyWorking', 'กำลังปฏิบัติงาน'],
  ['notCheckedInYet', 'ยังไม่ลงเวลา'], ['late', 'มาสาย'], ['earlyOut', 'ออกก่อนเวลา'], ['absent', 'ขาดงาน'],
  ['assistingOtherSite', 'ช่วย Site อื่น'], ['wrongShift', 'ผิดกะ'], ['timeAbnormal', 'เวลาผิดปกติ'], ['corrected', 'แก้ไขแล้ว']
];

export function AttendanceOperationsPanel({ token, role, department, readOnly = false, online = true }: Props) {
  const normalizedRole = String(role || '').toUpperCase();
  const authorized = normalizedRole === 'ADMIN' || normalizedRole === 'MANAGER';
  const isAdmin = normalizedRole === 'ADMIN';
  const [date, setDate] = useState(bangkokDate());
  const [month, setMonth] = useState(bangkokDate().slice(0, 7));
  const [daily, setDaily] = useState<AttendanceDailyData | null>(null);
  const [preview, setPreview] = useState<AttendanceMonthPreview | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [official, setOfficial] = useState<AttendanceOfficialReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [correctionRow, setCorrectionRow] = useState<AttendanceSupervisorRow | null>(null);
  const [correctionType, setCorrectionType] = useState<'CHECK_IN' | 'CHECK_OUT'>('CHECK_IN');
  const [correctionTime, setCorrectionTime] = useState('');
  const [correctionReason, setCorrectionReason] = useState('');
  const [unlockReason, setUnlockReason] = useState('');

  const disabled = readOnly || !online || busy;
  const currentCertification = useMemo(() => history.find((row) => String(row.status) === 'CERTIFIED') || null, [history]);

  const loadDaily = async () => {
    if (!authorized || !online) return;
    setBusy(true); setError(undefined);
    try {
      const result = await attendanceSupervisorDaily(token, { date, ...(normalizedRole === 'MANAGER' && department ? { department } : {}) });
      setDaily(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลด Attendance Dashboard ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const loadMonth = async () => {
    if (!isAdmin || !online) return;
    setBusy(true); setError(undefined);
    try {
      const [nextPreview, nextHistory] = await Promise.all([attendanceMonthPreview(token, month), attendanceCertifications(token, month)]);
      setPreview(nextPreview); setHistory(nextHistory); setOfficial(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'โหลด Monthly Attendance ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  useEffect(() => { if (authorized && online) void loadDaily(); }, [authorized, online, date]);
  useEffect(() => { if (isAdmin && online) void loadMonth(); }, [isAdmin, online, month]);

  const submitCorrection = async () => {
    if (!correctionRow || !correctionTime || correctionReason.trim().length < 5 || disabled) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await attendanceCorrect(token, correctionRow.assignmentId, {
        eventType: correctionType,
        correctedEffectiveEventAt: new Date(correctionTime).toISOString(),
        reason: correctionReason.trim()
      });
      setCorrectionRow(null); setCorrectionTime(''); setCorrectionReason('');
      setNotice('บันทึกการแก้ไขพร้อม Audit แล้ว');
      await loadDaily();
      if (isAdmin) await loadMonth();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'บันทึกการแก้ไขไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const certify = async () => {
    if (!isAdmin || disabled || (preview?.blockerCount || 0) > 0) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await attendanceCertify(token, month);
      setNotice(`รับรอง Attendance ${month} แล้ว`);
      await loadMonth();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'รับรองเดือนไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const unlock = async () => {
    if (!isAdmin || disabled || unlockReason.trim().length < 5) return;
    setBusy(true); setError(undefined); setNotice(undefined);
    try {
      await attendanceUnlock(token, month, unlockReason.trim());
      setUnlockReason(''); setNotice(`ปลดล็อก Attendance ${month} แล้ว`);
      await loadMonth();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'ปลดล็อกเดือนไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  const printOfficial = async () => {
    if (!isAdmin || disabled) return;
    setBusy(true); setError(undefined);
    try {
      const result = await attendanceOfficialReport(token, month);
      setOfficial(result);
      window.setTimeout(() => { void printDocument('.attendance-official-print', `Attendance ${month} Rev.${result.revision}`); }, 0);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'เปิดรายงาน PDF ไม่สำเร็จ'); }
    finally { setBusy(false); }
  };

  if (!authorized) return null;

  return <section className="attendance-operations-panel">
    <div className="section-title"><div><p className="eyebrow">SUPERVISOR · GOVERNANCE</p><h2>ควบคุมและตรวจสอบ Attendance</h2><p>{isAdmin ? 'Dashboard · Correction · Certification · Official Report' : `ขอบเขตแผนก ${department || 'ที่ได้รับอนุญาต'}`}</p></div></div>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {notice && <div className="settings-notice">{notice}</div>}

    <div className="attendance-ops-toolbar">
      <label>วันที่<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      <button className="btn-secondary" type="button" onClick={() => void loadDaily()} disabled={disabled}><SmsIcon name="refresh" size={16} />รีเฟรช</button>
    </div>

    {daily && <>
      <div className="attendance-summary-grid">{summaryKeys.map(([key, label]) => <article key={key}><span>{label}</span><strong>{daily.summary[key] ?? 0}</strong></article>)}</div>
      <div className="table-card"><div className="table-scroll"><table className="data-table attendance-ops-table"><thead><tr><th>พนักงาน</th><th>Site</th><th>กะ</th><th>เข้า</th><th>ออก</th><th>สถานะ</th><th>Flags</th><th>จัดการ</th></tr></thead><tbody>
        {daily.rows.length ? daily.rows.map((row) => <tr key={row.assignmentId}><td><strong>{row.employeeName}</strong><small className="cell-note">{row.employeeCode || '—'} · {row.department || '—'}</small></td><td>{siteText(row.actualSite || row.expectedSite)}</td><td>{row.shift?.code || '—'}</td><td>{timeText(row.checkInAt)}{row.originalCheckInAt && row.originalCheckInAt !== row.checkInAt && <small className="cell-note">เดิม {timeText(row.originalCheckInAt)}</small>}</td><td>{timeText(row.checkOutAt)}{row.originalCheckOutAt && row.originalCheckOutAt !== row.checkOutAt && <small className="cell-note">เดิม {timeText(row.originalCheckOutAt)}</small>}</td><td><span className="status-badge pending">{row.attendanceStatus}</span></td><td><small>{row.flags.join(', ') || '—'}</small></td><td><button type="button" className="btn-secondary" disabled={disabled} onClick={() => { setCorrectionRow(row); setCorrectionType(row.checkInAt ? 'CHECK_OUT' : 'CHECK_IN'); }}>แก้ไขเวลา</button></td></tr>) : <tr><td colSpan={8} className="no-rows">ไม่พบรายการ</td></tr>}
      </tbody></table></div></div>
    </>}

    {correctionRow && <div className="attendance-correction-card"><h3>แก้ไขเวลา · {correctionRow.employeeName}</h3><div className="attendance-ops-form"><label>ประเภท<select value={correctionType} onChange={(event) => setCorrectionType(event.target.value as 'CHECK_IN' | 'CHECK_OUT')}><option value="CHECK_IN">CHECK_IN</option><option value="CHECK_OUT">CHECK_OUT</option></select></label><label>เวลา<input type="datetime-local" value={correctionTime} onChange={(event) => setCorrectionTime(event.target.value)} /></label><label className="is-wide">เหตุผล<textarea value={correctionReason} onChange={(event) => setCorrectionReason(event.target.value)} placeholder="อย่างน้อย 5 ตัวอักษร" /></label></div><div className="attendance-ops-actions"><button type="button" className="btn-primary" disabled={disabled || !correctionTime || correctionReason.trim().length < 5} onClick={() => void submitCorrection()}>บันทึกพร้อม Audit</button><button type="button" className="btn-secondary" disabled={busy} onClick={() => setCorrectionRow(null)}>ยกเลิก</button></div></div>}

    {isAdmin && <section className="attendance-month-governance"><div className="attendance-ops-toolbar"><label>เดือน<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label><button className="btn-secondary" type="button" onClick={() => void loadMonth()} disabled={disabled}>ตรวจเดือน</button></div>
      {preview && <><div className="attendance-governance-state"><article><span>Blockers</span><strong>{preview.blockerCount}</strong></article><article><span>สถานะ Schedule</span><strong>{preview.scheduleApproval?.status || '—'}</strong></article><article><span>Certification</span><strong>{currentCertification ? `Rev.${String(currentCertification.revision)}` : 'ยังไม่รับรอง'}</strong></article></div>
        {preview.blockerCount > 0 && <div className="attendance-blockers"><strong>ต้องแก้ไขก่อนรับรอง</strong>{preview.blockers.slice(0, 20).map((blocker) => <div key={blocker.assignmentId}>{blocker.workDate} · {blocker.status} · {blocker.flags.join(', ')}</div>)}</div>}
        <div className="attendance-ops-actions"><button className="btn-primary" type="button" disabled={disabled || preview.blockerCount > 0 || Boolean(currentCertification)} onClick={() => void certify()}>รับรองและล็อกเดือน</button><button className="btn-secondary" type="button" disabled={disabled || !currentCertification} onClick={() => void printOfficial()}>PDF / พิมพ์รายงานทางการ</button><button className="btn-secondary" type="button" disabled={disabled || !currentCertification} onClick={() => void attendanceDownloadXlsx(token, month).catch((reason) => setError(reason instanceof Error ? reason.message : 'Export Excel ไม่สำเร็จ'))}>Excel</button></div>
        {currentCertification && <div className="attendance-unlock-row"><input value={unlockReason} onChange={(event) => setUnlockReason(event.target.value)} placeholder="เหตุผลปลดล็อก (อย่างน้อย 5 ตัวอักษร)" /><button type="button" className="btn-danger" disabled={disabled || unlockReason.trim().length < 5} onClick={() => void unlock()}>ปลดล็อกเพื่อแก้ไข</button></div>}
      </>}
    </section>}

    {official && <section className="print-only attendance-official-print"><h1>Security Management System — Official Attendance</h1><p>เดือน {official.month} · Revision {official.revision}</p><p>Certification ID: {official.certificationId}</p><p>Digest: {official.summaryDigest}</p><p>Certified: {timeText(official.certifiedAt)}</p><table><thead><tr><th>Date</th><th>Employee</th><th>Department</th><th>Expected Site</th><th>Actual Site</th><th>Shift</th><th>In</th><th>Out</th><th>Minutes</th><th>Status</th><th>Flags</th></tr></thead><tbody>{official.rows.map((row, index) => <tr key={`${reportValue(row, 'date')}-${index}`}><td>{reportValue(row, 'date')}</td><td>{reportValue(row, 'employeeCode')} · {reportValue(row, 'employeeName')}</td><td>{reportValue(row, 'department')}</td><td>{reportValue(row, 'expectedSite')}</td><td>{reportValue(row, 'actualSite')}</td><td>{reportValue(row, 'shift')}</td><td>{reportValue(row, 'checkInAt')}</td><td>{reportValue(row, 'checkOutAt')}</td><td>{reportValue(row, 'workedMinutes')}</td><td>{reportValue(row, 'status')}</td><td>{reportValue(row, 'flags')}</td></tr>)}</tbody></table><footer>Report ID: {official.certificationId} · Revision {official.revision} · No biometric images included</footer></section>}
  </section>;
}
