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
  if (row.workSiteContext === 'SUPPORT_SITE' || flags.has('ASSIST_OTHER_SITE')) labels.push(`ช่วยปฏิบัติงาน ณ ${row.actualSite?.name || row.actualSite?.code || '-'}`);
  const punctuality = row.punctuality || (flags.has('LATE') ? 'LATE' : flags.has('ON_TIME') ? 'ON_TIME' : null);
  if (punctuality === 'LATE') labels.push('มาสาย');
  else if (punctuality === 'ON_TIME') labels.push('ตรงเวลา');
  const checkout = row.checkoutCondition || (flags.has('MISSING_CHECK_OUT') ? 'MISSING_CHECK_OUT' : flags.has('EARLY_OUT') ? 'EARLY_LEAVE' : null);
  if (checkout === 'EARLY_LEAVE') labels.push('ออกก่อนเวลา');
  if (checkout === 'MISSING_CHECK_OUT' || flags.has('MISSING_CHECK_OUT')) labels.push('ไม่ได้ลงเวลาออก');
  if (row.abnormalTime || flags.has('TIME_ABNORMAL')) labels.push(abnormalReasonText(row.abnormalReasons));
  if (labels.length) return [...new Set(labels)].join(' / ');
  return row.status || '-';
}

function monthDayRows(rows: AttendanceReportRow[], period: string) {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) return [];
  const year = Number(match[1]);
  const month = Number(match[2]);
  const count = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const byDate = new Map<string, AttendanceReportRow[]>();
  rows.forEach((row) => {
    const list = byDate.get(row.workDate) || [];
    list.push(row);
    byDate.set(row.workDate, list);
  });
  return Array.from({ length: count }, (_, index) => {
    const day = index + 1;
    const date = new Date(Date.UTC(year, month - 1, day));
    const weekday = new Intl.DateTimeFormat('th-TH', { weekday: 'short', timeZone: 'UTC' }).format(date);
    const dateLabel = `${weekday} ${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year + 543}`;
    const dateKey = `${period}-${String(day).padStart(2, '0')}`;
    const dayRows = [...(byDate.get(dateKey) || [])].sort((a, b) => String(a.scheduledStartAt || a.expectedStartAt || '').localeCompare(String(b.scheduledStartAt || b.expectedStartAt || '')));
    const notes = new Set<string>();
    if (!dayRows.length) notes.add('ไม่มีรายการที่รับรองใน Snapshot');
    for (const row of dayRows) {
      const flags = new Set(row.flags || []);
      if (flags.has('LEAVE')) notes.add('ลา (ประเภทไม่อยู่ใน Snapshot)');
      if (flags.has('ABSENT')) notes.add('ขาด');
      if (flags.has('LATE')) notes.add('มาสาย');
      if (row.checkoutCondition === 'EARLY_LEAVE' || flags.has('EARLY_OUT')) notes.add('ออกก่อนเวลา');
      if (row.abnormalTime || flags.has('TIME_ABNORMAL') || flags.has('MISSING_CHECK_OUT')) notes.add(abnormalReasonText(row.abnormalReasons));
    }
    return {
      day,
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

function shiftCell(row?: AttendanceReportRow) {
  if (!row) return '—';
  const shiftName = row.shift?.code || row.shift?.name || 'กะ';
  const checkIn = formatTime(row.effectiveCheckInAt || row.checkInAt);
  const checkOut = formatTime(row.effectiveCheckOutAt || row.checkOutAt);
  return `${shiftName} ${checkIn}–${checkOut}`;
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

export function AttendanceOfficialReportPanel({ token, month, role, enabled }: { token: string; month: string; role: string; enabled: boolean }) {
  const [report, setReport] = useState<AttendanceOfficialReport>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const [printMode, setPrintMode] = useState<'employee' | 'department'>('employee');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [printedAt, setPrintedAt] = useState('');
  const employeePages = useMemo(() => groupByEmployee(report?.rows || []), [report]);
  const departments = useMemo(() => [...new Set((report?.rows || []).map((row) => row.department).filter((value): value is string => Boolean(value?.trim())))].sort((a, b) => a.localeCompare(b, 'th')), [report]);
  const visibleEmployeePages = useMemo(() => selectedDepartment
    ? employeePages.filter((rows) => rows[0]?.department === selectedDepartment)
    : employeePages, [employeePages, selectedDepartment]);
  const selectedPage = visibleEmployeePages.find((rows) => rows[0]?.employeeId === selectedEmployeeId) || visibleEmployeePages[0];
  const pagesToPrint = printMode === 'department' ? visibleEmployeePages : selectedPage ? [selectedPage] : [];

  useEffect(() => {
    setReport(undefined);
    setError(undefined);
    setSelectedDepartment('');
    setSelectedEmployeeId('');
    setPrintMode('employee');
    setPrintedAt('');
  }, [token, month]);

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
        <p>ใช้ Certified Snapshot เท่านั้น รายงานพิมพ์ 1 คนต่อหน้า; วันหยุด ตำแหน่ง และประเภทลาที่ไม่มีใน Snapshot จะแสดงว่าไม่มีข้อมูล</p>
        <small>{report ? `Report ID: ${report.reportId} · Revision ${report.revision}` : `Period: ${month}`}</small>
      </div>
      <div className="attendance-report-export-actions">
        <button type="button" className="btn-primary" disabled={!report || loading || !pagesToPrint.length} onClick={() => void exportPdf()}>{printMode === 'employee' ? 'พิมพ์รายบุคคล' : 'พิมพ์ทั้งหน่วยงาน'}</button>
        {role === 'ADMIN' && <button type="button" className="btn-neutral" disabled={!report || loading || downloading} onClick={() => void exportExcel()}>{downloading ? 'กำลังสร้าง…' : 'ส่งออก Excel'}</button>}
      </div>
    </article>
    {report && <div className="attendance-report-controls" aria-label="ตัวเลือกการพิมพ์ใบลงเวลา">
      <fieldset>
        <legend>ขอบเขตการพิมพ์</legend>
        <label><input type="radio" name="attendance-report-print-mode" value="employee" checked={printMode === 'employee'} onChange={() => setPrintMode('employee')} /> รายบุคคล</label>
        <label><input type="radio" name="attendance-report-print-mode" value="department" checked={printMode === 'department'} onChange={() => setPrintMode('department')} /> ทั้งหน่วยงาน · 1 คนต่อหน้า</label>
      </fieldset>
      {role === 'ADMIN'
        ? <label><span>แผนก</span><select aria-label="เลือกแผนกสำหรับพิมพ์" value={selectedDepartment} onChange={(event) => { setSelectedDepartment(event.target.value); setSelectedEmployeeId(''); }}><option value="">ทุกแผนก</option>{departments.map((department) => <option value={department} key={department}>{department}</option>)}</select></label>
        : <p className="attendance-report-scope">แผนกที่ได้รับอนุญาต: <strong>{report.scope?.department || departments[0] || 'ไม่พบขอบเขตแผนก'}</strong></p>}
      {printMode === 'employee' && <label><span>พนักงาน</span><select aria-label="เลือกพนักงานสำหรับพิมพ์" value={selectedPage?.[0]?.employeeId || ''} onChange={(event) => setSelectedEmployeeId(event.target.value)} disabled={!visibleEmployeePages.length}>{visibleEmployeePages.map((rows) => <option value={rows[0].employeeId} key={rows[0].employeeId}>{rows[0].employeeCode || '—'} · {rows[0].employeeName}</option>)}</select></label>}
    </div>}
    {loading && <div className="report-center-state" role="status">กำลังโหลด Certified Attendance Snapshot…</div>}
    {error && <div className="report-center-state report-center-state--error" role="alert"><strong>รายงานลงเวลายังไม่พร้อม</strong><RequestErrorContent error={error} /></div>}
    {!loading && !error && !report && enabled && <div className="report-center-state"><strong>ยังไม่มีรายงานที่รับรองแล้ว</strong><span>ต้อง Certify เดือนนี้ก่อนจึงจะส่งออกรายงานทางการได้</span></div>}
    {report && <AttendanceOfficialReportPrint report={report} employeePages={pagesToPrint} printedAt={printedAt} />}
  </>;
}

export function AttendanceOfficialReportPrint({ report, employeePages = groupByEmployee(report.rows), printedAt }: { report: AttendanceOfficialReport; employeePages?: AttendanceReportRow[][]; printedAt?: string }) {
  return <section className="print-only attendance-official-report-print" aria-label="Official Attendance Report">
    {employeePages.map((rows, pageIndex) => {
      const first = rows[0];
      const days = monthDayRows(rows, report.period);
      const summary = employeeSummary(rows, report.period);
      const sites = [...new Set(rows.map((row) => (row.assignedSite || row.expectedSite)?.name || (row.assignedSite || row.expectedSite)?.code).filter((value): value is string => Boolean(value)))];
      const schedules = [...new Set(rows.map((row) => {
        const start = row.scheduledStartAt || row.expectedStartAt;
        const end = row.scheduledEndAt || row.expectedEndAt;
        return start && end ? `${formatTime(start)}–${formatTime(end)}` : '';
      }).filter(Boolean))];
      const printDate = printedAt || report.generatedAt;
      const totalMinutes = totalWorkedMinutes(rows);
      return <article className="attendance-report-page attendance-timesheet-page" key={first?.employeeId || pageIndex}>
        <header className="attendance-report-print-header">
          <div className="attendance-report-brand"><img src="/brand/sms-logo-horizontal.webp" alt="SMS Security Management System" /><span>Security Management System</span></div>
          <div className="attendance-report-title"><h1>ใบลงเวลา</h1><span>พิมพ์เมื่อ {formatDateTime(printDate)}</span></div>
        </header>
        <div className="attendance-report-month-band"><strong>ประจำเดือน {formatThaiMonth(report.period)}</strong><span>ตั้งแต่วันที่ 1 ถึงวันที่ {days.length} · พ.ศ. {Number(report.period.slice(0, 4)) + 543}</span></div>
        <section className="attendance-report-employee-meta" aria-label="ข้อมูลพนักงานจาก Certified Snapshot">
          <div><span>รหัสพนักงาน</span><strong>{first?.employeeCode || '—'}</strong></div>
          <div><span>ชื่อ-นามสกุล</span><strong>{first?.employeeName || '—'}</strong></div>
          <div><span>แผนก</span><strong>{first?.department || '—'}</strong></div>
          <div><span>สถานที่ปฏิบัติงาน (Site)</span><strong>{sites.length ? sites.join(', ') : '—'}</strong></div>
          <div><span>ตำแหน่ง / ฝ่าย</span><strong>ไม่มีข้อมูลใน Snapshot</strong></div>
          <div><span>วันหยุดประจำสัปดาห์</span><strong>ไม่มีข้อมูลใน Snapshot</strong></div>
          <div><span>เวลาตามกะ</span><strong>{schedules.length ? schedules.join(', ') : 'ไม่มีข้อมูลใน Snapshot'}</strong></div>
          <div><span>หัวหน้า / ผู้ควบคุม</span><strong>ไม่มีข้อมูลใน Snapshot</strong></div>
        </section>
        <table className="attendance-report-table">
          <thead><tr><th>วันที่</th><th>กะงาน (1) · เวลาเข้า/ออก</th><th>กะงาน (2) · เวลาเข้า/ออก</th><th>ชั่วโมง</th><th>หมายเหตุ</th></tr></thead>
          <tbody>{days.map((day) => <tr className={day.rows.length ? undefined : 'attendance-report-day--no-source'} key={day.day}>
            <td>{day.dateLabel}</td>
            <td>{shiftCell(day.rows[0])}</td>
            <td>{shiftCell(day.rows[1])}{day.rows.length > 2 ? <small className="attendance-report-extra-shifts">+ อีก {day.rows.length - 2} กะ</small> : null}</td>
            <td>{day.hasWorkedDuration ? durationText(day.workedMinutes) : '—'}</td>
            <td>{day.notes.join(' · ')}</td>
          </tr>)}</tbody>
        </table>
        <div className="attendance-report-total-hours">ชั่วโมงปฏิบัติงานรวมทั้งเดือน <strong>{durationText(totalMinutes)}</strong></div>
        <section className="attendance-report-summary" aria-label="สรุปรายเดือน">
          <div><span>วันทำงานตามรายการ</span><strong>{summary.days.workDays}</strong></div>
          <div><span>วันหยุด / นักขัตฤกษ์</span><strong>ไม่อยู่ใน Snapshot</strong></div>
          <div><span>ลา</span><strong>{summary.days.leaveDays} วัน · ไม่แยกประเภท</strong></div>
          <div><span>ขาด</span><strong>{summary.days.absentDays} วัน</strong></div>
          <div><span>มาสาย</span><strong>{summary.days.lateDays} วัน</strong></div>
          <div><span>ไม่ระบุจาก Snapshot</span><strong>{summary.days.unclassifiedDays} วัน</strong></div>
          <div><span>รวมวันในเดือน</span><strong>{summary.days.totalDays} วัน</strong></div>
        </section>
        <footer className="attendance-report-signatures" aria-label="ช่องลงนาม">
          {['พนักงาน', 'หัวหน้าหน่วยงาน (ผู้ตรวจสอบ)', 'ผู้จัดการแผนก', 'ฝ่ายบุคคล'].map((label) => <div key={label}><span>ลงชื่อ</span><i /><strong>{label}</strong></div>)}
        </footer>
        <div className="attendance-report-auditline">{report.reportId} · Revision {report.revision} · Certified {formatDateTime(report.certifiedAt)} · SHA-256 {report.summaryDigest}</div>
        <div className="attendance-report-page-number">หน้า {pageIndex + 1} / {employeePages.length}</div>
      </article>;
    })}
  </section>;
}

export const attendanceReportPresentation = { formatDate, formatDateTime, formatTime, durationText, resultText, employeeSummary, groupByEmployee, monthDayRows, monthSummary, shiftCell, totalWorkedMinutes };
