import { useEffect, useMemo, useState } from 'react';
import { printDocument } from '../../schedule-print';
import { formatThaiDate, formatThaiDateTime, formatThaiMonth } from '../../thai-date-time';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import {
  downloadAttendanceOfficialWorkbook,
  loadAttendanceOfficialReport,
  saveBinaryDownload,
  type AttendanceOfficialReport,
  type AttendanceReportRow
} from './attendance-report-client';
import '../../styles/attendance-report.css';
import '../../styles/timesheet-print.css';

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  return formatThaiDate(date, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return formatThaiDateTime(date, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  });
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return formatThaiDateTime(date, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function durationText(minutes?: number | null) {
  if (minutes === null || minutes === undefined) return '-';
  const hours = Math.floor(Math.max(0, minutes) / 60);
  return `${hours}:${String(Math.max(0, minutes) % 60).padStart(2, '0')}`;
}

function abnormalReasonLabel(reason: string) {
  const labels: Record<string, string> = {
    MISSING_CHECK_OUT: 'ไม่ได้ลงเวลาออก',
    MAX_SHIFT_DURATION_EXCEEDED: 'เกินเวลากะสูงสุด',
    CHECK_OUT_BEFORE_CHECK_IN: 'ลำดับเวลาออกก่อนเวลาเข้า'
  };
  return labels[reason] || 'เวลาผิดปกติ';
}

function abnormalReasonText(reasons?: string[]) {
  return [...new Set((reasons || []).map(abnormalReasonLabel))].join(', ') || 'เวลาผิดปกติ';
}

function resultText(row: AttendanceReportRow) {
  const flags = new Set(row.flags || []);
  if (flags.has('LEAVE')) return 'ลา';
  if (flags.has('ABSENT')) return 'ขาดงาน';
  const labels: string[] = [];
  if (flags.has('OUTSIDE_ALL_SITES')) labels.push('อยู่นอกพื้นที่ Site');
  if (flags.has('WRONG_SHIFT')) labels.push('ผิดกะ');
  if (flags.has('DEVICE_MISMATCH')) labels.push('ใช้อุปกรณ์อื่น · ตรวจสอบ');
  if (row.workSiteContext === 'SUPPORT_SITE' || flags.has('ASSIST_OTHER_SITE')) labels.push(`ช่วยปฏิบัติงาน Site ${row.actualSite?.code || row.actualSite?.name || '-'}`);
  const punctuality = row.punctuality || (flags.has('LATE') ? 'LATE' : flags.has('ON_TIME') ? 'ON_TIME' : null);
  if (punctuality === 'LATE') labels.push('มาสาย');
  const checkout = row.checkoutCondition || (flags.has('MISSING_CHECK_OUT') ? 'MISSING_CHECK_OUT' : flags.has('EARLY_OUT') ? 'EARLY_LEAVE' : null);
  if (checkout === 'EARLY_LEAVE') labels.push('ออกก่อนเวลา');
  if (checkout === 'MISSING_CHECK_OUT' || flags.has('MISSING_CHECK_OUT')) labels.push('ไม่ได้ลงเวลาออก');
  if (row.abnormalTime || flags.has('TIME_ABNORMAL')) labels.push(abnormalReasonText(row.abnormalReasons));
  // Owner rule 2026-10-26: a normal day at the employee's own Site leaves หมายเหตุ blank.
  return [...new Set(labels)].join(' / ');
}

function monthEndDate(period: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return '';
  const year = Number(match[1]);
  const month = Number(match[2]);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(lastDay).padStart(2, '0')}`;
}

function normalizeThroughDate(period: string, throughDate?: string) {
  const end = monthEndDate(period);
  if (!end || !throughDate || !/^\d{4}-\d{2}-\d{2}$/.test(throughDate)) return end;
  const start = `${period}-01`;
  if (throughDate < start) return start;
  if (throughDate > end) return end;
  return throughDate;
}

function monthDayRows(rows: AttendanceReportRow[], period: string, throughDate?: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const cutoff = normalizeThroughDate(period, throughDate);
  const count = Number(cutoff.slice(8, 10));
  const byDate = new Map<string, AttendanceReportRow[]>();
  rows.filter((row) => row.workDate.startsWith(`${period}-`) && row.workDate <= cutoff).forEach((row) => {
    const list = byDate.get(row.workDate) || [];
    list.push(row);
    byDate.set(row.workDate, list);
  });
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = new Intl.DateTimeFormat('th-TH', { weekday: 'long', timeZone: 'UTC' }).format(date).replace(/^วัน/u, '');
    const dateText = `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year + 543}`;
    const dateLabel = `${weekday} ${dateText}`;
    const dateKey = `${period}-${String(day).padStart(2, '0')}`;
    const dayRows = [...(byDate.get(dateKey) || [])].sort((a, b) => String(a.scheduledStartAt || a.expectedStartAt || '').localeCompare(String(b.scheduledStartAt || b.expectedStartAt || '')));
    const notes = new Set<string>();
    if (!dayRows.length) notes.add('ไม่มีรายการที่รับรองใน Snapshot');
    for (const row of dayRows) {
      const flags = new Set(row.flags || []);
      if (flags.has('LEAVE')) notes.add('ลา (ประเภทไม่อยู่ใน Snapshot)');
      if (flags.has('ABSENT')) notes.add('ขาด');
      if (row.workSiteContext === 'SUPPORT_SITE' || flags.has('ASSIST_OTHER_SITE')) notes.add(`ช่วยปฏิบัติงาน Site ${row.actualSite?.code || row.actualSite?.name || '-'}`);
      if (flags.has('LATE')) notes.add('มาสาย');
      if (row.checkoutCondition === 'EARLY_LEAVE' || flags.has('EARLY_OUT')) notes.add('ออกก่อนเวลา');
      if (row.abnormalTime || flags.has('TIME_ABNORMAL') || flags.has('MISSING_CHECK_OUT')) notes.add(abnormalReasonText(row.abnormalReasons));
    }
    return {
      day,
      weekday,
      dateText,
      dateLabel,
      rows: dayRows,
      workedMinutes: dayRows.reduce((sum, row) => sum + (typeof row.workedMinutes === 'number' && Number.isFinite(row.workedMinutes) ? Math.max(0, row.workedMinutes) : 0), 0),
      hasWorkedDuration: dayRows.some((row) => typeof row.workedMinutes === 'number' && Number.isFinite(row.workedMinutes)),
      notes: [...notes]
    };
  });
}

function monthSummary(rows: AttendanceReportRow[], period: string) {
  const dailyRows = monthDayRows(rows, period);
  const workDays = new Set<string>();
  const leaveDays = new Set<string>();
  const absentDays = new Set<string>();
  const lateDays = new Set<string>();
  dailyRows.forEach((day) => {
    const has = (row: AttendanceReportRow, flag: string) => (row.flags || []).includes(flag);
    const hasWork = day.rows.some((row) => !has(row, 'LEAVE') && !has(row, 'ABSENT'));
    const allLeave = day.rows.length > 0 && day.rows.every((row) => has(row, 'LEAVE'));
    const allAbsent = day.rows.length > 0 && day.rows.every((row) => has(row, 'ABSENT'));
    if (hasWork) workDays.add(String(day.day));
    else if (allLeave) leaveDays.add(String(day.day));
    else if (allAbsent) absentDays.add(String(day.day));
    if (day.rows.some((row) => has(row, 'LATE'))) lateDays.add(String(day.day));
  });
  return {
    workDays: workDays.size,
    leaveDays: leaveDays.size,
    absentDays: absentDays.size,
    lateDays: lateDays.size,
    totalDays: dailyRows.length,
    unclassifiedDays: Math.max(0, dailyRows.length - workDays.size - leaveDays.size - absentDays.size),
    complete: rows.filter((row) => row.status === 'COMPLETE').length,
    abnormal: rows.filter((row) => (row.flags || []).some((flag) => ['TIME_ABNORMAL', 'MISSING_CHECK_OUT', 'MISSING_CHECK_IN'].includes(flag))).length
  };
}

function employeeSummary(rows: AttendanceReportRow[], period = '2026-08') {
  const has = (row: AttendanceReportRow, flag: string) => row.flags.includes(flag);
  return {
    scheduled: rows.length,
    late: rows.filter((row) => has(row, 'LATE')).length,
    earlyOut: rows.filter((row) => has(row, 'EARLY_OUT')).length,
    absent: rows.filter((row) => has(row, 'ABSENT')).length,
    leave: rows.filter((row) => has(row, 'LEAVE')).length,
    abnormal: rows.filter((row) => has(row, 'TIME_ABNORMAL') || has(row, 'MISSING_CHECK_OUT') || has(row, 'MISSING_CHECK_IN')).length,
    days: monthSummary(rows, period)
  };
}

function totalWorkedMinutes(rows: AttendanceReportRow[]) {
  if (!rows.some((row) => typeof row.workedMinutes === 'number' && Number.isFinite(row.workedMinutes))) return null;
  return rows.reduce((sum, row) => sum + (typeof row.workedMinutes === 'number' && Number.isFinite(row.workedMinutes) ? Math.max(0, row.workedMinutes) : 0), 0);
}

function dayTimes(rows: AttendanceReportRow[], direction: 'checkIn' | 'checkOut') {
  if (!rows.length) return ['—'];
  return rows.map((row) => formatTime(direction === 'checkIn'
    ? row.effectiveCheckInAt || row.checkInAt
    : row.effectiveCheckOutAt || row.checkOutAt));
}

function groupByEmployee(rows: AttendanceReportRow[]) {
  const grouped = new Map<string, AttendanceReportRow[]>();
  rows.forEach((row) => {
    const list = grouped.get(row.employeeId) || [];
    list.push(row);
    grouped.set(row.employeeId, list);
  });
  return [...grouped.values()]
    .map((rowsForEmployee) => [...rowsForEmployee].sort((a, b) => a.workDate.localeCompare(b.workDate)))
    .sort((a, b) => (a[0]?.employeeCode || '').localeCompare(b[0]?.employeeCode || '', 'th'));
}

export function AttendanceOfficialReportPanel({ token, month, role, enabled, initialEmployeeId }: { token: string; month: string; role: string; enabled: boolean; initialEmployeeId?: string }) {
  const [report, setReport] = useState<AttendanceOfficialReport>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [throughDate, setThroughDate] = useState(monthEndDate(month));
  const [printedAt, setPrintedAt] = useState('');
  const employeePages = useMemo(() => groupByEmployee(report?.rows || []), [report]);
  const departments = useMemo(() => [...new Set((report?.rows || []).map((row) => row.department).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b, 'th')), [report]);
  const visibleEmployeePages = useMemo(() => selectedDepartment
    ? employeePages.filter((rows) => rows[0]?.department === selectedDepartment)
    : employeePages, [employeePages, selectedDepartment]);
  const selectedPage = visibleEmployeePages.find((rows) => rows[0]?.employeeId === selectedEmployeeId) || visibleEmployeePages[0];
  const pagesToPrint = selectedPage ? [selectedPage] : [];

  useEffect(() => {
    setReport(undefined);
    setError(undefined);
    setSelectedDepartment('');
    setSelectedEmployeeId('');
    setThroughDate(monthEndDate(month));
    setPrintedAt('');
  }, [token, month]);

  useEffect(() => {
    if (report && initialEmployeeId && employeePages.some((rows) => rows[0]?.employeeId === initialEmployeeId)) setSelectedEmployeeId(initialEmployeeId);
  }, [employeePages, report, initialEmployeeId]);

  useEffect(() => {
    if (!enabled || report || loading || error) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    loadAttendanceOfficialReport(token, month)
      .then((value) => { if (active) setReport(value); })
      .catch((reason) => { if (active) setError(toRequestErrorState(reason, 'ไม่สามารถโหลดรายงานลงเวลาที่รับรองแล้วได้')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [enabled, error, loading, month, report, token]);

  const exportExcel = async () => {
    setDownloading(true);
    setError(undefined);
    try {
      saveBinaryDownload(await downloadAttendanceOfficialWorkbook(token, month));
    } catch (reason) {
      setError(toRequestErrorState(reason, 'ไม่สามารถส่งออก Excel ได้'));
    } finally {
      setDownloading(false);
    }
  };

  const exportPdf = async () => {
    if (!report || !pagesToPrint.length) return;
    setPrintedAt(new Date().toISOString());
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await printDocument('.attendance-official-report-print', `SMS-Timesheet-${report.period}-R${report.revision}.pdf`, { orientation: 'portrait', margin: '0' });
  };

  return <>
    <article className="report-center-export-card attendance-report-export-card">
      <div className="report-center-export-icon">ATT</div>
      <div>
        <h3>รายงานลงเวลาประจำเดือนที่รับรองแล้ว</h3>
        <p>ใช้ Certified Snapshot เท่านั้น พิมพ์พนักงาน 1 คน ตั้งแต่วันที่ 1 ถึงวันที่เลือกภายในเดือนเดียวกัน</p><small>การพิมพ์เป็นแบบอ่านอย่างเดียว และไม่บันทึกหรือเปลี่ยนสถานะการลงเวลา</small>
        <small>{report ? `Report ID: ${report.reportId} · Revision ${report.revision}` : `Period: ${month}`}</small>
      </div>
      <div className="attendance-report-export-actions">
        <button type="button" className="btn-primary" disabled={!report || loading || !pagesToPrint.length} onClick={() => void exportPdf()}>พิมพ์รายบุคคล</button>
        {role === 'ADMIN' && <button type="button" className="btn-neutral" disabled={!report || loading || downloading} onClick={() => void exportExcel()}>{downloading ? 'กำลังสร้าง…' : 'ส่งออก Excel'}</button>}
      </div>
    </article>
    {report && <div className="attendance-report-controls" aria-label="ตัวเลือกการพิมพ์ใบลงเวลา">
      <label><span>ข้อมูลถึงวันที่</span><input type="date" aria-label="ข้อมูลถึงวันที่" min={`${month}-01`} max={monthEndDate(month)} value={throughDate} onChange={(event) => setThroughDate(normalizeThroughDate(month, event.target.value))} /></label>
      {role === 'ADMIN'
        ? <label><span>จุดปฏิบัติงาน</span><select aria-label="เลือกจุดปฏิบัติงานสำหรับพิมพ์" value={selectedDepartment} onChange={(event) => { setSelectedDepartment(event.target.value); setSelectedEmployeeId(''); }}><option value="">ทุกจุดปฏิบัติงาน</option>{departments.map((department) => <option value={department} key={department}>{department}</option>)}</select></label>
        : <p className="attendance-report-scope">จุดปฏิบัติงานที่ได้รับอนุญาต: <strong>{report.scope?.department || departments[0] || 'ไม่พบขอบเขตจุดปฏิบัติงาน'}</strong></p>}
      <label><span>พนักงาน</span><select aria-label="เลือกพนักงานสำหรับพิมพ์" value={selectedPage?.[0]?.employeeId || ''} onChange={(event) => setSelectedEmployeeId(event.target.value)} disabled={!visibleEmployeePages.length}>{visibleEmployeePages.map((rows) => <option value={rows[0].employeeId} key={rows[0].employeeId}>{rows[0].employeeCode || '—'} · {rows[0].employeeName}</option>)}</select></label>
    </div>}
    {loading && <div className="report-center-state" role="status">กำลังโหลด Certified Attendance Snapshot…</div>}
    {error && <div className="report-center-state report-center-state--error" role="alert"><strong>รายงานลงเวลายังไม่พร้อม</strong><RequestErrorContent error={error} /></div>}
    {!loading && !error && !report && enabled && <div className="report-center-state"><strong>ยังไม่มีรายงานที่รับรองแล้ว</strong><span>ต้อง Certify เดือนนี้ก่อนจึงจะส่งออกรายงานทางการได้</span></div>}
    {report && <AttendanceOfficialReportPrint report={report} employeePages={pagesToPrint} throughDate={throughDate} printedAt={printedAt} />}
  </>;
}

const DASH = '–';

type TimesheetDay = ReturnType<typeof monthDayRows>[number];

function isWeekend(day: TimesheetDay) {
  return day.weekday === 'เสาร์' || day.weekday === 'อาทิตย์';
}

const hasFlag = (row: AttendanceReportRow, flag: string) => (row.flags || []).includes(flag);
const isOffsite = (row: AttendanceReportRow) => row.workSiteContext === 'SUPPORT_SITE' || hasFlag(row, 'ASSIST_OTHER_SITE') || hasFlag(row, 'OUTSIDE_ALL_SITES');
const isEarly = (row: AttendanceReportRow) => row.checkoutCondition === 'EARLY_LEAVE' || hasFlag(row, 'EARLY_OUT');

function timesheetDayStatus(day: TimesheetDay): { label: string; tone: 'unknown' | 'normal' | 'warn' | 'leave' | 'absent' | 'review' } {
  if (!day.rows.length) return { label: 'ไม่มีข้อมูล', tone: 'unknown' };
  const working = day.rows.filter((row) => !hasFlag(row, 'LEAVE') && !hasFlag(row, 'ABSENT'));
  const leave = day.rows.some((row) => hasFlag(row, 'LEAVE'));
  const absent = day.rows.some((row) => hasFlag(row, 'ABSENT'));
  if ((leave || absent) && (working.length > 0 || (leave && absent))) {
    const workStatus = working.length ? timesheetDayStatus({ ...day, rows: working }).label : '';
    return { label: [workStatus, leave && 'ลา', absent && 'ขาดงาน'].filter(Boolean).join(' · '), tone: 'review' };
  }
  if (!working.length) return leave ? { label: 'ลา', tone: 'leave' } : { label: 'ขาดงาน', tone: 'absent' };
  if (working.some((row) => !((row.effectiveCheckInAt || row.checkInAt) && (row.effectiveCheckOutAt || row.checkOutAt)) || hasFlag(row, 'MISSING_CHECK_IN') || hasFlag(row, 'MISSING_CHECK_OUT') || hasFlag(row, 'WRONG_SHIFT') || hasFlag(row, 'DEVICE_MISMATCH') || hasFlag(row, 'OUTSIDE_ALL_SITES') || row.abnormalTime || hasFlag(row, 'TIME_ABNORMAL'))) return { label: 'ตรวจสอบ', tone: 'review' };
  if (working.some((row) => row.punctuality === 'LATE' || hasFlag(row, 'LATE'))) return { label: 'มาสาย', tone: 'warn' };
  if (working.some(isEarly)) return { label: 'ออกก่อน', tone: 'warn' };
  return { label: 'ปกติ', tone: 'normal' };
}

function timesheetSummary(rows: AttendanceReportRow[], period: string, throughDate?: string) {
  const cutoff = normalizeThroughDate(period, throughDate);
  const eligibleRows = rows.filter((row) => row.workDate.startsWith(`${period}-`) && row.workDate <= cutoff);
  const days = monthDayRows(eligibleRows, period, cutoff).filter((day) => day.rows.length);
  const count = (predicate: (day: TimesheetDay) => boolean) => days.filter(predicate).length;
  const working = (day: TimesheetDay) => day.rows.filter((row) => !hasFlag(row, 'LEAVE') && !hasFlag(row, 'ABSENT'));
  return {
    scheduledDays: count((day) => working(day).length > 0),
    presentDays: count((day) => working(day).some((row) => Boolean(row.effectiveCheckInAt || row.checkInAt))),
    lateDays: count((day) => working(day).some((row) => row.punctuality === 'LATE' || hasFlag(row, 'LATE'))),
    earlyDays: count((day) => working(day).some(isEarly)),
    leaveDays: count((day) => day.rows.some((row) => hasFlag(row, 'LEAVE'))),
    noRecordDays: count((day) => day.rows.some((row) => hasFlag(row, 'ABSENT'))),
    offsiteDays: count((day) => working(day).some(isOffsite)),
    totalMinutes: totalWorkedMinutes(eligibleRows)
  };
}

function timesheetNotes(day: TimesheetDay) {
  return day.rows.length ? [...new Set(day.rows.map(resultText).filter(Boolean))].join(' · ') : day.notes.join(' · ');
}

export function AttendanceOfficialReportPrint({ report, employeePages, throughDate, printedAt }: { report: AttendanceOfficialReport; employeePages?: AttendanceReportRow[][]; throughDate?: string; printedAt?: string }) {
  const printPages = (employeePages || groupByEmployee(report.rows)).slice(0, 1);
  return <section className="print-only attendance-official-report-print" aria-label="Official Attendance Report">
    {printPages.map((rows, pageIndex) => {
      const first = rows[0];
      const cutoff = normalizeThroughDate(report.period, throughDate);
      const eligibleRows = rows.filter((row) => row.workDate.startsWith(`${report.period}-`) && row.workDate <= cutoff);
      const days = monthDayRows(eligibleRows, report.period, cutoff);
      const summary = timesheetSummary(eligibleRows, report.period, cutoff);
      const sites = [...new Set(eligibleRows.map((row) => (row.assignedSite || row.expectedSite)?.name || (row.assignedSite || row.expectedSite)?.code).filter(Boolean))];
      const schedules = [...new Set(eligibleRows.map((row) => {
        const start = row.scheduledStartAt || row.expectedStartAt;
        const end = row.scheduledEndAt || row.expectedEndAt;
        return start && end ? `${formatTime(start)}–${formatTime(end)}` : '';
      }).filter(Boolean))];
      const printDate = printedAt || report.generatedAt;
      const boxes: [string, string][] = [
        ['วันทำงาน', `${summary.scheduledDays}`], ['มาทำงาน', `${summary.presentDays}`], ['มาสาย', `${summary.lateDays}`], ['ออกก่อนเวลา', `${summary.earlyDays}`],
        ['ลางาน', `${summary.leaveDays}`], ['ไม่มีบันทึก', `${summary.noRecordDays}`], ['นอกสถานที่', `${summary.offsiteDays}`],
        ['ชั่วโมงรวม', summary.totalMinutes === null ? DASH : durationText(summary.totalMinutes)]
      ];
      return <article className="attendance-report-page attendance-timesheet-page timesheet-sheet" key={first?.employeeId || pageIndex}>
        <header className="timesheet-header">
          <div className="timesheet-brand"><img src="/brand/sms-logo-horizontal.webp" alt="SMS Security Management System" /></div>
          <div className="timesheet-title"><h1>ใบลงเวลาทำงาน</h1><p>Monthly Timesheet</p><small>ข้อมูลตั้งแต่วันที่ 1–{Number(cutoff.slice(8, 10))} {formatThaiMonth(report.period)}</small></div>
          <dl className="timesheet-docmeta">
            <div><dt>รายงาน</dt><dd>{report.reportId}</dd></div>
            <div><dt>ประจำเดือน</dt><dd>{formatThaiMonth(report.period)}</dd></div>
            <div><dt>พิมพ์เมื่อ</dt><dd>{formatDateTime(printDate)}</dd></div>
          </dl>
        </header>
        <section className="timesheet-employee" aria-label="ข้อมูลพนักงาน">
          <div><span>ชื่อ-สกุล</span><strong>{first?.employeeName || DASH}</strong></div>
          <div><span>รหัสพนักงาน</span><strong>{first?.employeeCode || DASH}</strong></div>
          <div><span>ตำแหน่ง</span><strong>{DASH}</strong></div>
          <div><span>จุดปฏิบัติงาน</span><strong>{first?.department || DASH}</strong></div>
          <div><span>สถานที่ปฏิบัติงาน (Site)</span><strong>{sites.length ? sites.join(', ') : DASH}</strong></div>
          <div className="timesheet-employee--wide"><span>เวลาทำงาน</span><strong>{schedules.length ? schedules.join(', ') : DASH}</strong></div>
        </section>
        <section className="timesheet-summary" aria-label="สรุปรายเดือน">
          {boxes.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </section>
        <table className="timesheet-table">
          <thead><tr><th>วันที่</th><th>วัน</th><th>เข้างาน</th><th>ออกงาน</th><th>ชั่วโมง</th><th>สถานะ</th><th>สถานที่</th><th>หมายเหตุ</th></tr></thead>
          <tbody>{days.map((day) => {
            const status = timesheetDayStatus(day);
            const shaded = isWeekend(day);
            const times = (direction: 'checkIn' | 'checkOut') => day.rows.length ? dayTimes(day.rows, direction).map((time) => time === '-' ? DASH : time).join(' / ') : DASH;
            return <tr className={`timesheet-day${shaded ? ' timesheet-day--weekend' : ''}${status.tone === 'absent' ? ' timesheet-day--absent' : ''}`} key={day.day}>
              <td>{day.dateText}</td>
              <td>{day.weekday}</td>
              <td>{times('checkIn')}</td>
              <td>{times('checkOut')}</td>
              <td>{day.hasWorkedDuration ? durationText(day.workedMinutes) : DASH}</td>
              <td className={`timesheet-status--${status.tone}`}>{status.label}</td>
              <td>{[...new Set(day.rows.map((row) => (row.actualSite || row.assignedSite || row.expectedSite)?.name || (row.actualSite || row.assignedSite || row.expectedSite)?.code).filter(Boolean))].join(', ') || DASH}</td>
              <td>{timesheetNotes(day)}</td>
            </tr>;
          })}</tbody>
        </table>
        <footer className="timesheet-signatures" aria-label="ช่องลงนาม">
          {['พนักงาน', 'หัวหน้างาน', 'ฝ่ายบุคคล'].map((label) => <div key={label}><span className="timesheet-signature-line">ลงชื่อ <i /></span><span>{label === 'พนักงาน' ? `( ${first?.employeeName || '........................................'} )` : '( ........................................ )'}</span><strong>{label}</strong><span>วันที่ ____/____/______</span></div>)}
        </footer>
        <div className="timesheet-auditline">{report.reportId} · Revision {report.revision} · Certified {formatDateTime(report.certifiedAt)} · SHA-256 {report.summaryDigest} · หน้า {pageIndex + 1}/{printPages.length}</div>
      </article>;
    })}
  </section>;
}

export const attendanceReportPresentation = { formatDate, formatDateTime, formatTime, durationText, resultText, employeeSummary, groupByEmployee, monthDayRows, monthSummary, dayTimes, totalWorkedMinutes, timesheetSummary, timesheetDayStatus, timesheetNotes, isWeekend };
