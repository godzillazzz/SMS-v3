import { useEffect, useMemo, useState } from 'react';
import { api, type SecuritySite } from '../../api';
import { SmsIcon } from '../../components/SmsIcon';
import './attendance-supervisor-v4.css';

type Props = {
  token: string;
  role: string;
  department?: string;
};

type Site = { id: string; code?: string | null; name: string };
type Shift = { id: string; code?: string | null; name?: string | null; startTime?: string | null; endTime?: string | null };

type AttendanceRow = {
  date: string;
  assignmentId: string;
  sessionId?: string | null;
  employeeId: string;
  employeeCode?: string | null;
  employeeName: string;
  department?: string | null;
  expectedSite?: Site | null;
  actualSite?: Site | null;
  shift: Shift;
  expectedStartAt?: string | null;
  expectedEndAt?: string | null;
  originalCheckInAt?: string | null;
  originalCheckOutAt?: string | null;
  checkInAt?: string | null;
  checkOutAt?: string | null;
  workedMinutes?: number | null;
  lateMinutes?: number | null;
  earlyOutMinutes?: number | null;
  attendanceStatus: string;
  flags: string[];
  correctionAuthority?: string;
};

type Summary = {
  scheduledToday: number;
  checkedIn: number;
  currentlyWorking: number;
  notCheckedInYet: number;
  late: number;
  earlyOut: number;
  wrongShift: number;
  assistingOtherSite: number;
  outsideAllSites: number;
  leave: number;
  absent: number;
  corrected: number;
  timeAbnormal: number;
};

type DailyData = {
  date: string;
  generatedAt: string;
  scope: { role: string; department?: string | null };
  summary: Summary;
  rows: AttendanceRow[];
};

type HistoryData = {
  generatedAt: string;
  from: string;
  to: string;
  scope: { role: string; department?: string | null };
  summary: Summary;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  rows: AttendanceRow[];
};

type DetailData = AttendanceRow & {
  rawEvents: Array<{
    id: string;
    eventType: string;
    effectiveEventAt: string;
    receivedAt?: string | null;
    sourceType?: string | null;
    locationEvidence?: unknown;
  }>;
  governance: {
    canCreateAdjustmentRequest: boolean;
    canApproveAdjustmentRequest: boolean;
    directOverrideEnabled: boolean;
    note: string;
  };
};

type Mode = 'daily' | 'history';

const STATUS_OPTIONS = [
  ['', 'ทุกสถานะ'],
  ['CURRENTLY_WORKING', 'กำลังปฏิบัติงาน'],
  ['NOT_CHECKED_IN_YET', 'ยังไม่ลงเวลา'],
  ['LATE', 'มาสาย'],
  ['EARLY_OUT', 'ออกก่อนเวลา'],
  ['WRONG_SHIFT', 'ผิดกะ'],
  ['ASSIST_OTHER_SITE', 'ช่วย Site อื่น'],
  ['OUTSIDE_ALL_SITES', 'นอกพื้นที่'],
  ['LEAVE', 'ลา'],
  ['ABSENT', 'ขาด'],
  ['TIME_ABNORMAL', 'เวลาผิดปกติ'],
  ['COMPLETE', 'ครบเวลา']
] as const;

function bangkokDateText(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function time(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(value));
}

function duration(minutes?: number | null) {
  if (minutes == null) return '—';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    CURRENTLY_WORKING: 'กำลังปฏิบัติงาน',
    NOT_CHECKED_IN_YET: 'ยังไม่ลงเวลา',
    LATE: 'มาสาย',
    EARLY_OUT: 'ออกก่อนเวลา',
    WRONG_SHIFT: 'ผิดกะ',
    ASSIST_OTHER_SITE: 'ช่วย Site อื่น',
    OUTSIDE_ALL_SITES: 'นอกพื้นที่',
    LEAVE: 'ลา',
    ABSENT: 'ขาด',
    TIME_ABNORMAL: 'เวลาผิดปกติ',
    COMPLETE: 'ครบเวลา',
    SCHEDULED: 'มีตาราง'
  };
  return map[status] || status || '—';
}

function statusTone(status: string) {
  if (['ABSENT', 'TIME_ABNORMAL', 'OUTSIDE_ALL_SITES'].includes(status)) return 'danger';
  if (['LATE', 'EARLY_OUT', 'WRONG_SHIFT'].includes(status)) return 'warning';
  if (['CURRENTLY_WORKING', 'COMPLETE'].includes(status)) return 'good';
  return 'neutral';
}

function KPI({ label, value, icon, tone = 'neutral' }: { label: string; value: number; icon: Parameters<typeof SmsIcon>[0]['name']; tone?: string }) {
  return <article className={`attendance-supervisor-v4__kpi is-${tone}`}>
    <span><SmsIcon name={icon} size={20} /></span>
    <div><strong>{value}</strong><small>{label}</small></div>
  </article>;
}

export function AttendanceSupervisorPage({ token, role, department }: Props) {
  const today = bangkokDateText();
  const [mode, setMode] = useState<Mode>('daily');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(shiftDate(today, -30));
  const [to, setTo] = useState(today);
  const [departmentFilter, setDepartmentFilter] = useState(role === 'MANAGER' ? department || '' : '');
  const [siteId, setSiteId] = useState('');
  const [shiftTypeId, setShiftTypeId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [sites, setSites] = useState<SecuritySite[]>([]);
  const [shifts, setShifts] = useState<Array<{ id: string; code?: string; name?: string }>>([]);
  const [employees, setEmployees] = useState<Array<{ id: string; employeeCode?: string; displayName?: string; firstName?: string; lastName?: string; department?: string }>>([]);
  const [daily, setDaily] = useState<DailyData>();
  const [history, setHistory] = useState<HistoryData>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<DetailData>();
  const [detailLoading, setDetailLoading] = useState(false);

  const manager = role === 'MANAGER';

  useEffect(() => {
    let active = true;
    setFiltersLoading(true);
    Promise.allSettled([
      api.getSecuritySites(token),
      api.shiftTypes(token),
      api.employees(token)
    ]).then(([siteResult, shiftResult, employeeResult]) => {
      if (!active) return;
      if (siteResult.status === 'fulfilled') setSites(siteResult.value?.data?.sites || []);
      if (shiftResult.status === 'fulfilled') setShifts(Array.isArray(shiftResult.value?.data) ? shiftResult.value.data : []);
      if (employeeResult.status === 'fulfilled') setEmployees(Array.isArray(employeeResult.value?.data) ? employeeResult.value.data : []);
    }).finally(() => { if (active) setFiltersLoading(false); });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (manager) setDepartmentFilter(department || '');
  }, [department, manager]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    employees.forEach((employee) => { if (employee.department) values.add(employee.department); });
    return [...values].sort((a, b) => a.localeCompare(b, 'th'));
  }, [employees]);

  const filteredEmployees = useMemo(
    () => employees.filter((employee) => !departmentFilter || employee.department === departmentFilter),
    [departmentFilter, employees]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    const filters = {
      ...(departmentFilter ? { department: departmentFilter } : {}),
      ...(siteId ? { siteId } : {}),
      ...(shiftTypeId ? { shiftTypeId } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(status ? { status } : {})
    };

    const request = mode === 'daily'
      ? api.attendanceSupervisorDaily(token, { date, ...filters })
      : api.attendanceSupervisorHistory(token, { from, to, page, pageSize: 50, ...filters });

    request
      .then((response) => {
        if (!active) return;
        if (mode === 'daily') setDaily(response.data as DailyData);
        else setHistory(response.data as HistoryData);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่าน Attendance Dashboard ได้');
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [date, departmentFilter, employeeId, from, mode, page, shiftTypeId, siteId, status, to, token]);

  useEffect(() => { setPage(1); }, [from, to, departmentFilter, siteId, shiftTypeId, employeeId, status, mode]);

  const data = mode === 'daily' ? daily : history;
  const rows = data?.rows || [];
  const summary = data?.summary;

  const openDetail = async (assignmentId: string) => {
    setDetail(undefined);
    setDetailLoading(true);
    setError(undefined);
    try {
      const response = await api.attendanceSupervisorDetail(token, assignmentId);
      setDetail(response.data as DetailData);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านรายละเอียด Attendance ได้');
    } finally {
      setDetailLoading(false);
    }
  };

  return <section className="attendance-supervisor-v4">
    <header className="attendance-supervisor-v4__hero">
      <div>
        <span className="attendance-supervisor-v4__eyebrow">ATTENDANCE CONTROL CENTER</span>
        <h2>Attendance Dashboard</h2>
        <p>{manager ? `ขอบเขต Manager: ${department || 'ไม่ระบุ Department'}` : 'Admin มองเห็นทุก Department ตามสิทธิ์'}</p>
      </div>
      <div className="attendance-supervisor-v4__tabs" role="tablist" aria-label="Attendance dashboard views">
        <button type="button" className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}><SmsIcon name="dashboard" size={17} />วันนี้</button>
        <button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}><SmsIcon name="history" size={17} />ประวัติ</button>
      </div>
    </header>

    <section className="attendance-supervisor-v4__filters">
      {mode === 'daily' ? <label><span>วันที่</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label> : <>
        <label><span>ตั้งแต่</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
        <label><span>ถึง</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      </>}
      <label><span>Department</span><select value={departmentFilter} disabled={manager || filtersLoading} onChange={(event) => { setDepartmentFilter(event.target.value); setEmployeeId(''); }}>
        {!manager && <option value="">ทั้งหมด</option>}
        {manager && departmentFilter && <option value={departmentFilter}>{departmentFilter}</option>}
        {!manager && departments.map((value) => <option key={value} value={value}>{value}</option>)}
      </select></label>
      <label><span>Site</span><select value={siteId} disabled={filtersLoading} onChange={(event) => setSiteId(event.target.value)}><option value="">ทั้งหมด</option>{sites.filter((site) => site.isActive).map((site) => <option key={site.id} value={site.id}>{site.code} · {site.name}</option>)}</select></label>
      <label><span>Shift</span><select value={shiftTypeId} disabled={filtersLoading} onChange={(event) => setShiftTypeId(event.target.value)}><option value="">ทั้งหมด</option>{shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.code || '—'} · {shift.name || '—'}</option>)}</select></label>
      <label><span>Employee</span><select value={employeeId} disabled={filtersLoading} onChange={(event) => setEmployeeId(event.target.value)}><option value="">ทั้งหมด</option>{filteredEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.employeeCode || '—'} · {employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()}</option>)}</select></label>
      <label><span>Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}>{STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}</select></label>
    </section>

    {summary && <section className="attendance-supervisor-v4__kpis">
      <KPI label="Scheduled" value={summary.scheduledToday} icon="calendar" />
      <KPI label="Checked in" value={summary.checkedIn} icon="check" tone="good" />
      <KPI label="Working now" value={summary.currentlyWorking} icon="attendance" tone="good" />
      <KPI label="Not checked in" value={summary.notCheckedInYet} icon="clock" />
      <KPI label="Late" value={summary.late} icon="clock" tone="warning" />
      <KPI label="Early out" value={summary.earlyOut} icon="history" tone="warning" />
      <KPI label="Wrong shift" value={summary.wrongShift} icon="alert" tone="warning" />
      <KPI label="Assist other Site" value={summary.assistingOtherSite} icon="location" />
      <KPI label="Outside Site" value={summary.outsideAllSites} icon="location" tone="danger" />
      <KPI label="Leave" value={summary.leave} icon="leave" />
      <KPI label="Absent" value={summary.absent} icon="alert" tone="danger" />
      <KPI label="Time abnormal" value={summary.timeAbnormal} icon="quality" tone="danger" />
    </section>}

    {error && <div className="attendance-supervisor-v4__error" role="alert"><strong>ไม่สามารถแสดงข้อมูลได้</strong><span>{error}</span></div>}

    <section className="attendance-supervisor-v4__table-card">
      <div className="attendance-supervisor-v4__table-head">
        <div><strong>{mode === 'daily' ? 'สถานะประจำวัน' : 'Attendance History'}</strong><span>{loading ? 'กำลังโหลด…' : `${rows.length} รายการ`}</span></div>
        {mode === 'history' && history?.meta && <span>หน้า {history.meta.page}/{history.meta.totalPages} · {history.meta.total} รายการ</span>}
      </div>
      <div className="attendance-supervisor-v4__table-wrap">
        <table>
          <thead><tr>
            {mode === 'history' && <th>วันที่</th>}
            <th>Employee</th><th>Shift</th><th>Expected Site</th><th>Actual Site</th><th>In</th><th>Out</th><th>Worked</th><th>Status</th><th>Flags</th><th>Action</th>
          </tr></thead>
          <tbody>
            {!loading && rows.length === 0 && <tr><td colSpan={mode === 'history' ? 11 : 10} className="attendance-supervisor-v4__empty">ไม่พบข้อมูล Attendance ตามตัวกรอง</td></tr>}
            {rows.map((row) => <tr key={row.assignmentId}>
              {mode === 'history' && <td>{row.date}</td>}
              <td><strong>{row.employeeCode || '—'}</strong><small>{row.employeeName}</small><small>{row.department || '—'}</small></td>
              <td>{row.shift.code || row.shift.name || '—'}</td>
              <td>{row.expectedSite?.name || '—'}</td>
              <td>{row.actualSite?.name || '—'}</td>
              <td>{time(row.checkInAt)}</td>
              <td>{time(row.checkOutAt)}</td>
              <td>{duration(row.workedMinutes)}</td>
              <td><span className={`attendance-supervisor-v4__status is-${statusTone(row.attendanceStatus)}`}>{statusLabel(row.attendanceStatus)}</span></td>
              <td><div className="attendance-supervisor-v4__flags">{row.flags.slice(0, 3).map((flag) => <span key={flag}>{flag}</span>)}{row.flags.length > 3 && <span>+{row.flags.length - 3}</span>}</div></td>
              <td><button type="button" className="attendance-supervisor-v4__detail-btn" onClick={() => void openDetail(row.assignmentId)}>ดูรายละเอียด</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {mode === 'history' && history?.meta && history.meta.totalPages > 1 && <div className="attendance-supervisor-v4__pager">
        <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button>
        <span>{page} / {history.meta.totalPages}</span>
        <button type="button" disabled={page >= history.meta.totalPages} onClick={() => setPage((value) => value + 1)}>ถัดไป</button>
      </div>}
    </section>

    {(detailLoading || detail) && <div className="attendance-supervisor-v4__drawer-backdrop" onMouseDown={(event) => { if (event.currentTarget === event.target) setDetail(undefined); }}>
      <aside className="attendance-supervisor-v4__drawer" aria-label="Attendance detail">
        <header><div><span>ATTENDANCE DETAIL</span><h3>{detail?.employeeName || 'กำลังโหลด…'}</h3></div><button type="button" aria-label="ปิด" onClick={() => setDetail(undefined)}>×</button></header>
        {detailLoading ? <div className="attendance-supervisor-v4__drawer-loading">กำลังอ่านรายละเอียด…</div> : detail && <>
          <section className="attendance-supervisor-v4__detail-grid">
            <div><span>วันที่</span><strong>{detail.date}</strong></div>
            <div><span>Employee</span><strong>{detail.employeeCode || '—'}</strong></div>
            <div><span>Shift</span><strong>{detail.shift.code || detail.shift.name || '—'}</strong></div>
            <div><span>Expected Site</span><strong>{detail.expectedSite?.name || '—'}</strong></div>
            <div><span>Actual Site</span><strong>{detail.actualSite?.name || '—'}</strong></div>
            <div><span>Status</span><strong>{statusLabel(detail.attendanceStatus)}</strong></div>
          </section>

          <section className="attendance-supervisor-v4__compare">
            <h4>Original → Effective</h4>
            <div><span>Check in</span><strong>{time(detail.originalCheckInAt)}</strong><i>→</i><strong>{time(detail.checkInAt)}</strong></div>
            <div><span>Check out</span><strong>{time(detail.originalCheckOutAt)}</strong><i>→</i><strong>{time(detail.checkOutAt)}</strong></div>
            <div><span>Worked</span><strong>—</strong><i>→</i><strong>{duration(detail.workedMinutes)}</strong></div>
          </section>

          <section className="attendance-supervisor-v4__raw-events">
            <h4>Immutable Attendance Events</h4>
            {detail.rawEvents.length === 0 ? <p>ยังไม่มี AttendanceEvent</p> : detail.rawEvents.map((event) => <article key={event.id}><div><strong>{event.eventType}</strong><span>{time(event.effectiveEventAt)}</span></div><small>Event ID: {event.id}</small></article>)}
          </section>

          {detail.correctionAuthority === 'LEGACY_CURRENT_CORRECTION_OVERLAY' && <div className="attendance-supervisor-v4__legacy-warning"><strong>Legacy correction overlay</strong><span>รายการนี้มี correction เดิมที่มีผลอยู่ ระบบ V4 จะแยกคำขอใหม่ออกจาก authority จนกว่า ADMIN จะอนุมัติ</span></div>}

          <section className="attendance-supervisor-v4__governance-actions">
            <button type="button" disabled title="เปิดใช้งานหลัง Governed Adjustment V4 backend พร้อม">ยืนยันปฏิบัติงาน</button>
            <button type="button" disabled title="เปิดใช้งานหลัง Governed Adjustment V4 backend พร้อม">แก้ไขเวลาปฏิบัติงาน</button>
            <small>ปุ่มถูก fail-closed ชั่วคราวเพื่อไม่ให้ Correction V1 เดิมเปลี่ยน Attendance ก่อน ADMIN approval</small>
          </section>
        </>}
      </aside>
    </div>}
  </section>;
}
