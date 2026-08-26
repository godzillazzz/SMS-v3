import { useEffect, useMemo, useState } from 'react';
import { printDocument } from '../../schedule-print';
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
  return new Intl.DateTimeFormat('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(date);
}

function formatDateTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function formatTime(value?: string | null) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function durationText(minutes?: number | null) {
  if (minutes === null || minutes === undefined) return '-';
  const hours = Math.floor(Math.max(0, minutes) / 60);
  return `${hours}:${String(Math.max(0, minutes) % 60).padStart(2, '0')}`;
}

function resultText(row: AttendanceReportRow) {
  const flags = new Set(row.flags || []);
  if (flags.has('LEAVE')) return 'ลา';
  if (flags.has('ABSENT')) return 'ขาดงาน';
  if (flags.has('MISSING_CHECK_OUT')) return 'เวลาผิดปกติ / ไม่มีเวลาออก';
  if (flags.has('TIME_ABNORMAL')) return 'เวลาผิดปกติ';
  if (flags.has('OUTSIDE_ALL_SITES')) return 'อยู่นอกพื้นที่ Site';
  if (flags.has('WRONG_SHIFT')) return 'ผิดกะ';
  if (flags.has('ASSIST_OTHER_SITE')) return `ช่วยปฏิบัติงาน ณ ${row.actualSite?.name || row.actualSite?.code || '-'}`;
  if (flags.has('EARLY_OUT') && flags.has('LATE')) return 'มาสาย / ออกก่อนเวลา';
  if (flags.has('EARLY_OUT')) return 'ออกก่อนเวลา';
  if (flags.has('LATE')) return 'มาสาย';
  if (flags.has('ON_TIME')) return 'ปกติ';
  return row.status || '-';
}

function employeeSummary(rows: AttendanceReportRow[]) {
  const has = (row: AttendanceReportRow, flag: string) => row.flags.includes(flag);
  return {
    scheduled: rows.length,
    complete: rows.filter((row) => row.status === 'COMPLETE').length,
    late: rows.filter((row) => has(row, 'LATE')).length,
    earlyOut: rows.filter((row) => has(row, 'EARLY_OUT')).length,
    absent: rows.filter((row) => has(row, 'ABSENT')).length,
    leave: rows.filter((row) => has(row, 'LEAVE')).length,
    abnormal: rows.filter((row) => has(row, 'TIME_ABNORMAL') || has(row, 'MISSING_CHECK_OUT') || has(row, 'MISSING_CHECK_IN')).length
  };
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

export function AttendanceOfficialReportPanel({ token, month, enabled }: { token: string; month: string; enabled: boolean }) {
  const [report, setReport] = useState<AttendanceOfficialReport>();
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<RequestErrorInput>();
  const employeePages = useMemo(() => groupByEmployee(report?.rows || []), [report]);

  useEffect(() => {
    setReport(undefined);
    setError(undefined);
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
    if (!report) return;
    await printDocument('.attendance-official-report-print', `SMS-Attendance-${report.period}-R${report.revision}.pdf`);
  };

  return <>
    <article className="report-center-export-card attendance-report-export-card">
      <div className="report-center-export-icon">ATT</div>
      <div>
        <h3>รายงานลงเวลาประจำเดือนที่รับรองแล้ว</h3>
        <p>ใช้ Certified Snapshot เท่านั้น เพื่อคง Revision, Site, เวลา และผลการลงเวลาอย่างเป็นทางการ โดยไม่ส่งออกรูปหรือ Raw GPS evidence</p>
        <small>{report ? `Report ID: ${report.reportId} · Revision ${report.revision}` : `Period: ${month}`}</small>
      </div>
      <div className="attendance-report-export-actions">
        <button type="button" className="btn-primary" disabled={!report || loading} onClick={() => void exportPdf()}>ส่งออก PDF</button>
        <button type="button" className="btn-neutral" disabled={!report || loading || downloading} onClick={() => void exportExcel()}>{downloading ? 'กำลังสร้าง…' : 'ส่งออก Excel'}</button>
      </div>
    </article>
    {loading && <div className="report-center-state" role="status">กำลังโหลด Certified Attendance Snapshot…</div>}
    {error && <div className="report-center-state report-center-state--error" role="alert"><strong>รายงานลงเวลายังไม่พร้อม</strong><RequestErrorContent error={error} /></div>}
    {!loading && !error && !report && enabled && <div className="report-center-state"><strong>ยังไม่มีรายงานที่รับรองแล้ว</strong><span>ต้อง Certify เดือนนี้ก่อนจึงจะส่งออกรายงานทางการได้</span></div>}
    {report && <AttendanceOfficialReportPrint report={report} employeePages={employeePages} />}
  </>;
}

export function AttendanceOfficialReportPrint({ report, employeePages = groupByEmployee(report.rows) }: { report: AttendanceOfficialReport; employeePages?: AttendanceReportRow[][] }) {
  return <section className="print-only attendance-official-report-print" aria-label="Official Attendance Report">
    {employeePages.map((rows, pageIndex) => {
      const first = rows[0];
      const summary = employeeSummary(rows);
      return <article className="attendance-report-page" key={first?.employeeId || pageIndex}>
        <header className="attendance-report-print-header">
          <div><p>SECURITY MANAGEMENT SYSTEM</p><h1>ใบสรุปการลงเวลาประจำเดือน</h1></div>
          <div className="attendance-report-print-meta"><span>Report ID <strong>{report.reportId}</strong></span><span>Period <strong>{report.period}</strong></span><span>Revision <strong>{report.revision}</strong></span></div>
        </header>
        <section className="attendance-report-employee-meta">
          <div><span>รหัสพนักงาน</span><strong>{first?.employeeCode || '-'}</strong></div>
          <div><span>ชื่อ-นามสกุล</span><strong>{first?.employeeName || '-'}</strong></div>
          <div><span>หน่วยงาน</span><strong>{first?.department || '-'}</strong></div>
          <div><span>สถานะเอกสาร</span><strong>{report.certificationStatus}</strong></div>
        </section>
        <table className="attendance-report-table">
          <thead><tr><th>วันที่</th><th>กะ</th><th>Expected Site</th><th>Actual Site</th><th>เข้า</th><th>ออก</th><th>ชม.</th><th>สาย</th><th>ก่อน</th><th>ผล</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.assignmentId}>
            <td>{formatDate(row.workDate)}</td>
            <td>{row.shift?.code || row.shift?.name || '-'}</td>
            <td>{row.expectedSite?.name || row.expectedSite?.code || '-'}</td>
            <td>{row.actualSite?.name || row.actualSite?.code || '-'}</td>
            <td>{formatTime(row.checkInAt)}</td>
            <td>{formatTime(row.checkOutAt)}</td>
            <td>{durationText(row.workedMinutes)}</td>
            <td>{row.lateMinutes ?? '-'}</td>
            <td>{row.earlyOutMinutes ?? '-'}</td>
            <td>{resultText(row)}</td>
          </tr>)}</tbody>
        </table>
        <section className="attendance-report-summary">
          <span>รายการ <strong>{summary.scheduled}</strong></span><span>ครบ <strong>{summary.complete}</strong></span><span>สาย <strong>{summary.late}</strong></span><span>ออกก่อน <strong>{summary.earlyOut}</strong></span><span>ขาด <strong>{summary.absent}</strong></span><span>ลา <strong>{summary.leave}</strong></span><span>ผิดปกติ <strong>{summary.abnormal}</strong></span>
        </section>
        <footer className="attendance-report-footer">
          <div><span>Certified at</span><strong>{formatDateTime(report.certifiedAt)}</strong></div>
          <div><span>Generated at / by</span><strong>{formatDateTime(report.generatedAt)} · {report.generatedBy}</strong></div>
          <div><span>Digest</span><strong>{report.summaryDigest.slice(0, 16)}…</strong></div>
          <div className="attendance-report-page-number">Page {pageIndex + 1} / {employeePages.length}</div>
        </footer>
      </article>;
    })}
  </section>;
}

export const attendanceReportPresentation = { formatDate, formatDateTime, formatTime, durationText, resultText, employeeSummary, groupByEmployee };
