import type { ReactNode } from 'react';

export type AttendancePrintEmployee = {
  id: string;
  employeeCode?: string | null;
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  department?: string | null;
  jobTitle?: string | null;
  isActive?: boolean;
};

export type AttendancePrintRow = {
  assignmentId: string;
  employeeId: string;
  employeeCode?: string | null;
  employeeName: string;
  department?: string | null;
  date: string;
  shift: { code?: string | null; name?: string | null; startTime?: string | null; endTime?: string | null };
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  attendanceStatus: string;
  flags?: string[];
  abnormalTime?: boolean;
  workSiteContext?: 'ASSIGNED_SITE' | 'SUPPORT_SITE';
  assignedSite?: { name?: string | null; code?: string | null } | null;
  expectedSite?: { name?: string | null; code?: string | null } | null;
  actualSite?: { name?: string | null; code?: string | null } | null;
  attendanceSites?: Array<{ eventType?: string | null; actualSite?: { name?: string | null; code?: string | null } | null; workSiteContext?: string | null }>;
};

export type AttendanceMonthPrintDay = {
  date: string;
  assignment: { id: string; shiftTypeId?: string | null; shiftCode?: string | null; shiftName?: string | null; startTime?: string | null; endTime?: string | null } | null;
  attendance: AttendancePrintRow | null;
};

export type AttendanceMonthPrintEmployee = {
  id: string;
  employeeCode?: string | null;
  employeeName?: string | null;
  department?: string | null;
  days: AttendanceMonthPrintDay[];
};

export type AttendanceMonthPrintPayload = {
  generatedAt: string;
  monthStart: string;
  selectedDate: string;
  scope: { role: string; department?: string | null };
  employees: AttendanceMonthPrintEmployee[];
};

export function attendanceMonthPrintRows(payload: AttendanceMonthPrintPayload) {
  return payload.employees.flatMap((employee) => employee.days.flatMap((day) => day.attendance ? [day.attendance] : []));
}

const DASH = '–';

export function monthToDateRows(rows: AttendancePrintRow[], date: string) {
  const dayCount = Number(date.slice(8, 10));
  const month = date.slice(0, 7);
  return Array.from({ length: dayCount }, (_, index) => {
    const value = `${month}-${String(index + 1).padStart(2, '0')}`;
    return { date: value, rows: rows.filter((row) => row.date.slice(0, 10) === value) };
  });
}

function thaiDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
}

function thaiMonth(value: string) {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(date);
}

function weekday(value: string) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', weekday: 'short' }).format(new Date(`${value}T00:00:00.000Z`));
}

function time(value?: string | null) {
  if (!value) return DASH;
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function minutes(rows: AttendancePrintRow[]) {
  const values = rows.map((row) => row.workedMinutes).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return values.length ? values.reduce((total, value) => total + value, 0) : null;
}

function duration(value: number | null) {
  return value === null ? DASH : `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
}

function has(row: AttendancePrintRow, flag: string) {
  return row.attendanceStatus === flag || (row.flags || []).includes(flag);
}

function isOffDay(row: AttendancePrintRow) {
  return row.attendanceStatus === 'NOT_ACTIONABLE' || String(row.shift?.code || '').toUpperCase() === 'OFF';
}

function offDay(rows: AttendancePrintRow[]) {
  return rows.length > 0 && rows.every(isOffDay);
}

function dayStatus(rows: AttendancePrintRow[]) {
  if (!rows.length) return DASH;
  if (rows.some((row) => has(row, 'LEAVE'))) return 'ลา';
  if (offDay(rows)) return rows.some((row) => row.checkInAt) ? 'มาทำงาน (วันหยุด)' : 'วันหยุด';
  if (rows.some((row) => has(row, 'ABSENT'))) return 'ขาดงาน';
  if (rows.some((row) => has(row, 'LATE'))) return 'มาสาย';
  if (rows.some((row) => row.checkInAt)) return 'มาทำงาน';
  return 'ไม่มีบันทึก';
}

function statusTone(status: string) {
  if (status === 'วันหยุด') return 'timesheet-status--off';
  if (status === 'ขาดงาน' || status === 'ไม่มีบันทึก') return 'timesheet-status--danger';
  if (status === 'มาสาย') return 'timesheet-status--warn';
  if (status === 'ลา') return 'timesheet-status--leave';
  return undefined;
}

function siteLabel(site?: { name?: string | null; code?: string | null } | null) {
  return site?.name || site?.code || '';
}

function eventSite(rows: AttendancePrintRow[], eventType: 'CHECK_IN' | 'CHECK_OUT') {
  for (const row of rows) {
    const found = (row.attendanceSites || []).find((site) => site.eventType === eventType && siteLabel(site.actualSite));
    if (found) return siteLabel(found.actualSite);
  }
  return '';
}

/** Note naming the Site actually used when attendance happened away from the assigned Site. */
function siteNote(rows: AttendancePrintRow[]) {
  if (rows.some((row) => has(row, 'OUTSIDE_ALL_SITES'))) return 'นอกพื้นที่ทุก Site';
  if (!rows.some((row) => row.workSiteContext === 'SUPPORT_SITE')) return '';
  const checkIn = eventSite(rows, 'CHECK_IN');
  const checkOut = eventSite(rows, 'CHECK_OUT');
  if (checkIn && checkOut && checkIn !== checkOut) return `เข้า: ${checkIn} · ออก: ${checkOut}`;
  const single = checkIn || checkOut || rows.map((row) => siteLabel(row.actualSite)).find(Boolean);
  return single ? `ลงเวลาที่: ${single}` : 'นอกสถานที่';
}

function notes(rows: AttendancePrintRow[]) {
  const labels: string[] = [];
  if (rows.some((row) => has(row, 'EARLY_OUT'))) labels.push('ออกก่อน');
  const site = siteNote(rows);
  if (site) labels.push(site);
  if (rows.some((row) => has(row, 'WRONG_SHIFT'))) labels.push('ผิดกะ');
  if (rows.some((row) => row.abnormalTime || has(row, 'TIME_ABNORMAL'))) labels.push('เวลาผิดปกติ');
  return labels.join(' · ') || DASH;
}

function firstTime(rows: AttendancePrintRow[], key: 'checkInAt' | 'checkOutAt') {
  const values = rows.map((row) => row[key]).filter((value): value is string => Boolean(value)).sort();
  return key === 'checkInAt' ? values[0] : values[values.length - 1];
}

function summary(rows: AttendancePrintRow[]) {
  const days = [...new Set(rows.map((row) => row.date.slice(0, 10)))];
  const count = (predicate: (dayRows: AttendancePrintRow[]) => boolean) => days.filter((date) => predicate(rows.filter((row) => row.date.slice(0, 10) === date))).length;
  const offDays = days.filter((date) => offDay(rows.filter((row) => row.date.slice(0, 10) === date))).length;
  return [
    ['วันทำงาน', String(days.length - offDays)],
    ['วันหยุด', String(offDays)],
    ['มาทำงาน', String(count((day) => day.some((row) => Boolean(row.checkInAt))))],
    ['มาสาย', String(count((day) => day.some((row) => has(row, 'LATE'))))],
    ['ออกก่อน', String(count((day) => day.some((row) => has(row, 'EARLY_OUT'))))],
    ['ลา', String(count((day) => day.some((row) => has(row, 'LEAVE'))))],
    ['ขาดงาน', String(count((day) => day.some((row) => has(row, 'ABSENT'))))],
    ['นอกสถานที่', String(count((day) => day.some((row) => has(row, 'OUTSIDE_ALL_SITES') || row.workSiteContext === 'SUPPORT_SITE')))],
    ['ชั่วโมงรวม', duration(minutes(rows))]
  ] as Array<[string, string]>;
}

function employeeName(employee: AttendancePrintEmployee) {
  return employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim() || DASH;
}

export function AttendanceMonthToDatePrint({ date, employees, rows }: { date: string; employees: AttendancePrintEmployee[]; rows: AttendancePrintRow[] }) {
  return <section className="print-only attendance-supervisor-print" aria-label="ใบลงเวลาทำงานรายเดือน">
    {employees.map((employee, pageIndex) => {
      const employeeRows = rows.filter((row) => row.employeeId === employee.id);
      const days = monthToDateRows(employeeRows, date);
      const representative = employeeRows[0];
      const sites = [...new Set(employeeRows.map((row) => (row.assignedSite || row.expectedSite)?.name || (row.assignedSite || row.expectedSite)?.code).filter(Boolean))];
      const boxes = summary(employeeRows);
      return <article className="attendance-supervisor-print-page timesheet-sheet" key={employee.id}>
        <header className="leave-print-header-redesign timesheet-header-redesign">
          <div className="leave-print-brand-left">
            <div className="leave-print-brand-square">SMS</div>
            <div className="leave-print-company-details">
              <strong>Security Management System</strong>
              <small>ระบบบริหารงานรักษาความปลอดภัย</small>
            </div>
          </div>
          <div className="leave-print-doc-meta">
            <h1 className="leave-print-main-title">ใบลงเวลาทำงาน</h1>
            <div className="leave-print-en-title">MONTHLY TIMESHEET</div>
            <div className="leave-print-doc-no">ประจำเดือน {thaiMonth(date)}</div>
            <div className="leave-print-doc-no" style={{ fontSize: '8.5pt', color: '#475569', marginTop: '0.8mm' }}>ถึงวันที่ {thaiDate(date)}</div>
          </div>
        </header>
        <div className="leave-print-divider">
          <div className="leave-print-divider-accent" />
        </div>
        <section className="timesheet-employee" aria-label="ข้อมูลพนักงาน">
          <div><span>ชื่อ-สกุล</span><strong>{employeeName(employee)}</strong></div>
          <div><span>รหัสพนักงาน</span><strong>{employee.employeeCode || representative?.employeeCode || DASH}</strong></div>
          <div><span>ตำแหน่ง</span><strong>{employee.jobTitle || DASH}</strong></div>
          <div><span>แผนก</span><strong>{employee.department || representative?.department || DASH}</strong></div>
          <div className="timesheet-employee--wide"><span>สถานที่ปฏิบัติงาน (Site)</span><strong>{sites.length ? sites.join(', ') : DASH}</strong></div>
        </section>
        <section className="timesheet-summary" aria-label="สรุปรายเดือน">{boxes.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</section>
        <table className="timesheet-table"><thead><tr><th>วันที่</th><th>วัน</th><th>เวลาเข้า</th><th>เวลาออก</th><th>ชั่วโมง</th><th>สถานะ</th><th>หมายเหตุ</th></tr></thead>
          <tbody>{days.map((day) => <tr key={day.date}><td>{thaiDate(day.date)}</td><td>{weekday(day.date)}</td><td>{time(firstTime(day.rows, 'checkInAt'))}</td><td>{time(firstTime(day.rows, 'checkOutAt'))}</td><td>{duration(minutes(day.rows))}</td><td className={statusTone(dayStatus(day.rows))}>{dayStatus(day.rows)}</td><td>{notes(day.rows)}</td></tr>)}</tbody>
        </table>
        <footer className="timesheet-signatures">{['พนักงาน', 'หัวหน้างาน', 'ฝ่ายบุคคล'].map((label): ReactNode => <div key={label}><i /><strong>{label}</strong><span>วันที่ ____/____/______</span></div>)}</footer>
        <div className="timesheet-auditline">ข้อมูลจริงจากประวัติ Attendance วันที่ 1–{Number(date.slice(8, 10))} · หน้า {pageIndex + 1}/{employees.length}</div>
      </article>;
    })}
  </section>;
}
