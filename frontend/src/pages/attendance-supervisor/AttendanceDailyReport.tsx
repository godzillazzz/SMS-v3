import { useEffect, useState } from 'react';
import { printDocument } from '../../schedule-print';

// Owner reference: A4 daily attendance report. Derived strictly from the
// attendance supervisor daily API rows; unknown values render as '–'.
export type DailyReportRow = {
  assignmentId: string;
  employeeId?: string;
  workSiteContext?: string;
  abnormalTime?: boolean;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  attendanceStatus: string;
  flags?: string[];
  actualSite?: { id?: string; code?: string | null; name?: string | null } | null;
  assignedSite?: { id?: string; code?: string | null; name?: string | null } | null;
  expectedSite?: { id?: string; code?: string | null; name?: string | null } | null;
  actualSiteName?: string | null;
  attendanceSites?: Array<{ eventType?: string | null; actualSite?: { id?: string; code?: string | null; name?: string | null } | null; workSiteContext?: string | null }>;
};

const DASH = '–';

const has = (row: DailyReportRow, flag: string) => (row.flags || []).includes(flag) || row.attendanceStatus === flag;
const isLeave = (row: DailyReportRow) => has(row, 'LEAVE');
const isOff = (row: DailyReportRow) => row.attendanceStatus === 'NOT_ACTIONABLE';
const isNoRecord = (row: DailyReportRow) => !row.checkInAt && !row.checkOutAt && !isLeave(row) && !isOff(row) && row.attendanceStatus !== 'SCHEDULED';

export function dailyReportSummary(rows: DailyReportRow[]) {
  const key = (row: DailyReportRow) => row.employeeId ? `employee:${row.employeeId}` : `assignment:${row.assignmentId}`;
  const count = (predicate: (row: DailyReportRow) => boolean) => new Set(rows.filter(predicate).map(key)).size;
  const withRecord = new Set(rows.filter((row) => row.checkInAt || row.checkOutAt).map(key));
  return {
    total: count(() => true),
    checkedIn: count((row) => Boolean(row.checkInAt)),
    late: count((row) => has(row, 'LATE')),
    earlyOut: count((row) => has(row, 'EARLY_OUT')),
    absent: count((row) => has(row, 'ABSENT')),
    noRecord: count((row) => isNoRecord(row) && !withRecord.has(key(row))),
    offSite: count((row) => has(row, 'OUTSIDE_ALL_SITES') || has(row, 'ASSIST_OTHER_SITE') || row.workSiteContext === 'SUPPORT_SITE')
  };
}

export function dailyReportStatus(row: DailyReportRow): { label: string; tone: 'good' | 'warning' | 'danger' | 'neutral' } {
  if (isLeave(row)) return { label: 'ลา', tone: 'neutral' };
  if (isOff(row)) return { label: row.checkInAt ? 'มาทำงาน (วันหยุด)' : 'วันหยุด', tone: 'neutral' };
  if (row.attendanceStatus === 'SCHEDULED' && !row.checkInAt && !row.checkOutAt) return { label: 'ยังไม่ถึงเวลาลงงาน', tone: 'neutral' };
  if (isNoRecord(row)) return { label: 'ไม่มีบันทึก', tone: 'danger' };
  if (has(row, 'LATE')) return { label: 'มาสาย', tone: 'warning' };
  if (row.checkInAt) return { label: 'มาทำงาน', tone: 'good' };
  return { label: 'ข้อมูลไม่ครบ', tone: 'warning' };
}

function clock(value?: string | null) {
  if (!value) return DASH;
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function hours(minutes?: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return DASH;
  return `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}`;
}

export function thaiLongDate(value: string) {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return DASH;
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', dateStyle: 'full' }).format(parsed);
}

type Props = {
  date: string;
  rows: DailyReportRow[];
  loading?: boolean;
  error?: string;
  filters?: { department: string; site: string; shift: string; employee: string; status: string };
  onShow: (date: string) => void;
  onClose?: () => void;
};

export function AttendanceDailyReport({ date, rows, loading = false, error, filters, onShow, onClose }: Props) {
  const [draftDate, setDraftDate] = useState(date);
  const [printError, setPrintError] = useState<string>();
  useEffect(() => setDraftDate(date), [date]);
  const summary = dailyReportSummary(rows);
  const cards: Array<[string, number]> = [
    ['พนักงานทั้งหมด', summary.total], ['ลงเวลาเข้า', summary.checkedIn], ['มาสาย', summary.late],
    ['ออกก่อน', summary.earlyOut], ['ขาดงาน', summary.absent], ['ไม่มีบันทึก', summary.noRecord], ['นอกสถานที่', summary.offSite]
  ];
  const print = async () => {
    setPrintError(undefined);
    try {
      await printDocument('.attendance-daily-report__sheet', `รายงานการลงเวลาประจำวัน-${date}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch {
      setPrintError('ไม่สามารถจัดเตรียมรายงานสำหรับพิมพ์ได้');
    }
  };

  return <section className="attendance-daily-report" aria-label="รายงานการลงเวลาประจำวัน">
    <div className="attendance-daily-report__toolbar">
      <label><span>วันที่</span><input type="date" aria-label="วันที่รายงาน" value={draftDate} onChange={(event) => setDraftDate(event.target.value)} /></label>
      <button type="button" className="btn-neutral" disabled={!draftDate} onClick={() => onShow(draftDate)}>แสดง</button>
      <button type="button" className="btn-primary" disabled={loading || Boolean(error) || !rows.length} onClick={() => void print()}>พิมพ์ / บันทึก PDF</button>
      {onClose && <button type="button" className="btn-neutral" onClick={onClose}>ปิด</button>}
      <small>กระดาษ A4 ปิด header/footer ของเบราว์เซอร์</small>
    </div>
    {printError && <p role="alert" className="attendance-daily-report__error">{printError}</p>}
    <div className="attendance-daily-report__scroll">
      <article className="attendance-daily-report__sheet">
        <header className="leave-print-header-redesign daily-report-header-redesign">
          <div className="leave-print-brand-left">
            <div className="leave-print-brand-square">SMS</div>
            <div className="leave-print-company-details">
              <strong>Security Management System</strong>
              <small>ระบบบริหารงานรักษาความปลอดภัย</small>
            </div>
          </div>
          <div className="leave-print-doc-meta">
            <h1 className="leave-print-main-title">รายงานการลงเวลาประจำวัน</h1>
            <div className="leave-print-en-title">DAILY ATTENDANCE REPORT</div>
            <p className="attendance-daily-report__subtitle" style={{ margin: 0, fontSize: '8.5pt', color: '#64748b' }}>Daily Attendance</p>
            <div className="leave-print-doc-no">{thaiLongDate(date)}</div>
          </div>
        </header>
        <div className="leave-print-divider">
          <div className="leave-print-divider-accent" />
        </div>
        <p className="attendance-daily-report__filter-text" style={{ fontSize: '8pt', color: '#475569', margin: '0 0 2mm' }}>ตัวกรอง: แผนก {filters?.department || 'ทั้งหมด'} · จุดปฏิบัติงาน {filters?.site || 'ทั้งหมด'} · กะ {filters?.shift || 'ทั้งหมด'} · พนักงาน {filters?.employee || 'ทั้งหมด'} · สถานะ {filters?.status || 'ทั้งหมด'}</p>
        <section className="attendance-daily-report__cards" aria-label="สรุปการลงเวลา">
          {cards.map(([label, value]) => <div className="attendance-daily-report__card" key={label}><span>{label}</span><strong>{loading || error ? DASH : value}</strong></div>)}
        </section>
        <table>
          <thead><tr>
            <th scope="col">ลำดับ</th><th scope="col">ชื่อ-สกุล</th><th scope="col">รหัส</th><th scope="col">แผนก</th>
            <th scope="col">เวลาเข้า</th><th scope="col">เวลาออก</th><th scope="col">ชั่วโมง</th><th scope="col">สถานะ</th>
            <th scope="col">สถานที่</th><th scope="col">หมายเหตุ</th>
          </tr></thead>
          <tbody>
            {loading ? <tr><td colSpan={10}>กำลังโหลดข้อมูล</td></tr>
              : error ? <tr><td colSpan={10} role="alert">{error}</td></tr>
              : !rows.length ? <tr><td colSpan={10}>ไม่มีข้อมูลในระบบ</td></tr>
              : rows.map((row, index) => {
                const status = dailyReportStatus(row);
                const anomalies = ([['WRONG_SHIFT', 'ผิดกะ'], ['DEVICE_MISMATCH', 'อุปกรณ์ไม่ตรง'], ['OUTSIDE_ALL_SITES', 'นอกพื้นที่'], ['ASSIST_OTHER_SITE', 'ช่วย Site อื่น'], ['TIME_ABNORMAL', 'เวลาผิดปกติ'], ['MISSING_CHECK_IN', 'ไม่ได้ลงเวลาเข้า'], ['MISSING_CHECK_OUT', 'ไม่ได้ลงเวลาออก'], ['EARLY_OUT', 'ออกก่อนเวลา']] as const).filter(([flag]) => has(row, flag) || (flag === 'TIME_ABNORMAL' && row.abnormalTime) || (flag === 'ASSIST_OTHER_SITE' && row.workSiteContext === 'SUPPORT_SITE')).map(([, label]) => label);
                const offSite = has(row, 'OUTSIDE_ALL_SITES') || has(row, 'ASSIST_OTHER_SITE') || row.workSiteContext === 'SUPPORT_SITE';
                const actualSiteName = row.actualSite?.name || row.actualSite?.code || row.actualSiteName || (row.attendanceSites && row.attendanceSites.find((site) => site.actualSite?.name)?.actualSite?.name);
                const siteDisplay = offSite ? (actualSiteName || 'นอกสถานที่') : DASH;
                return <tr key={row.assignmentId}>
                  <td>{index + 1}</td><td>{row.employeeName || DASH}</td><td>{row.employeeCode || DASH}</td><td>{row.department || DASH}</td>
                  <td>{clock(row.checkInAt)}</td><td>{clock(row.checkOutAt)}</td><td>{hours(row.workedMinutes)}</td>
                  <td><span className={`attendance-daily-report__status attendance-daily-report__status--${status.tone}`}>{status.label}</span></td>
                  <td>{siteDisplay}</td><td>{anomalies.length ? anomalies.join(' · ') : DASH}</td>
                </tr>;
              })}
          </tbody>
        </table>
      </article>
    </div>
  </section>;
}
