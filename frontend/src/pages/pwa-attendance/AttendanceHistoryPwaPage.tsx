import { useEffect, useMemo, useState } from 'react';
import { formatRequestErrorMessage } from '../../request-error';
import { SmsIcon } from '../../components/SmsIcon';
import { activateTabFromKeyboard } from '../../components/AccessibleTabs';
import { bangkokDateInput, formatThaiDate, formatThaiDateTime } from '../../thai-date-time';
import { attendanceSelfHistory, type AttendanceSelfHistoryData, type AttendanceSelfRow } from '../attendance/attendance-client';
import {
  createAttendanceAdjustment,
  listAttendanceAdjustments,
  submitAttendanceAdjustment
} from '../attendance-supervisor/attendance-adjustment-client';
import './employee-attendance-v4.css';

type Props = { token: string; online: boolean };

type RangeKey = 'today' | 'week' | 'month';

const SELF_CONFIRM_WINDOW_DAYS = 7;

function bangkokToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function dayDiff(fromDate: string, toDate: string) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  if (Number.isNaN(from) || Number.isNaN(to)) return Number.POSITIVE_INFINITY;
  return Math.round((to - from) / 86_400_000);
}

function bangkokTimeInput(value?: string | null) {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(parsed);
}

function bangkokDateTimeToIso(date: string, hhmm: string) {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const parsed = new Date(`${date}T${hhmm}:00+07:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function bangkokDateText(value = new Date()) {
  return bangkokDateInput(value);
}

function shiftDate(value: string, offset: number) {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  return date.toISOString().slice(0, 10);
}

function ranges(key: RangeKey) {
  const today = bangkokDateText();
  if (key === 'today') return { from: today, to: today };
  if (key === 'week') return { from: shiftDate(today, -6), to: today };
  return { from: shiftDate(today, -30), to: today };
}

function time(value?: string | null) {
  if (!value) return '—';
  return formatThaiDateTime(value, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
}

function actualSiteLabel(row: AttendanceSelfRow) {
  const sites = row.attendanceSites || [];
  const fallback = row.actualSite?.name || row.actualSite?.code || (row.assignedSite || row.expectedSite)?.name || '—';
  if (sites.length <= 1) return fallback;
  return sites.map((site) => `${site.eventType === 'CHECK_OUT' ? 'ออก' : 'เข้า'}: ${site.actualSite?.name || site.actualSite?.code || fallback}`).join(' / ');
}

function dateLabel(value: string) {
  return formatThaiDate(`${value}T00:00:00.000Z`, { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' });
}

function duration(minutes?: number | null) {
  if (minutes == null) return '—';
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours ? `${hours} ชม. ${mins} นาที` : `${mins} นาที`;
}

function status(row: AttendanceSelfRow) {
  if (row.flags.includes('TIME_ABNORMAL') || row.flags.includes('MISSING_CHECK_OUT') || row.flags.includes('MISSING_CHECK_IN')) return { label: 'เวลาผิดปกติ', tone: 'danger' };
  if (row.flags.includes('LATE')) return { label: 'มาสาย', tone: 'warning' };
  if (row.flags.includes('EARLY_OUT')) return { label: 'ออกก่อนเวลา', tone: 'warning' };
  if (row.flags.includes('LEAVE')) return { label: 'ลา', tone: 'neutral' };
  if (row.flags.includes('ABSENT')) return { label: 'ขาดงาน', tone: 'danger' };
  if (row.status === 'COMPLETE') return { label: 'ครบถ้วน', tone: 'success' };
  if (row.status === 'IN_PROGRESS') return { label: 'กำลังปฏิบัติงาน', tone: 'info' };
  return { label: 'ตามตาราง', tone: 'neutral' };
}

const operationalFlagLabels: Record<string, string> = {
  WRONG_SHIFT: 'ผิดกะ',
  ASSIST_OTHER_SITE: 'ช่วยพื้นที่อื่น',
  DEVICE_MISMATCH: 'ใช้อุปกรณ์อื่น · ตรวจสอบ',
  DEVICE_MOVE_PENDING: 'รออนุมัติย้ายเครื่อง',
  OUTSIDE_ALL_SITES: 'นอกพื้นที่',
  MISSING_CHECK_IN: 'ไม่มีเวลาเข้า',
  MISSING_CHECK_OUT: 'ไม่มีเวลาออก',
  TIME_ABNORMAL: 'เวลาผิดปกติ',
  LOCATION_RISK: 'ความเสี่ยงตำแหน่ง',
  PHOTO_RISK: 'ความเสี่ยงรูปภาพ'
};

export function AttendanceHistoryPwaPage({ token, online }: Props) {
  const [range, setRange] = useState<RangeKey>(() => new URLSearchParams(window.location.search).get('today') === '1' ? 'today' : 'week');
  const [data, setData] = useState<AttendanceSelfHistoryData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [requestsByAssignment, setRequestsByAssignment] = useState<Record<string, { id: string; status: string }>>({});
  const [confirmRow, setConfirmRow] = useState<AttendanceSelfRow>();
  const [confirmCheckIn, setConfirmCheckIn] = useState('');
  const [confirmCheckOut, setConfirmCheckOut] = useState('');
  const [confirmReason, setConfirmReason] = useState('');
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState<string>();
  const [confirmNotice, setConfirmNotice] = useState<string>();

  const selected = useMemo(() => ranges(range), [range]);

  const loadRequests = () => {
    if (!online) return;
    listAttendanceAdjustments(token, { pageSize: 100 })
      .then((result: unknown) => {
        const rows = Array.isArray((result as { data?: unknown[] })?.data) ? (result as { data: Array<Record<string, unknown>> }).data : [];
        const map: Record<string, { id: string; status: string }> = {};
        for (const row of rows) {
          const assignmentId = String(row.shiftAssignmentId || '');
          if (assignmentId) map[assignmentId] = { id: String(row.id), status: String(row.status) };
        }
        setRequestsByAssignment(map);
      })
      .catch(() => setRequestsByAssignment({}));
  };

  useEffect(() => {
    if (!online) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    attendanceSelfHistory(token, selected)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(formatRequestErrorMessage(reason, 'ไม่สามารถอ่านประวัติได้')); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [online, range, selected.from, selected.to, token]);

  useEffect(loadRequests, [online, token]);

  const today = bangkokToday();
  const canConfirm = (row: AttendanceSelfRow) => {
    const age = dayDiff(row.date, today);
    return age >= 0 && age <= SELF_CONFIRM_WINDOW_DAYS && !requestsByAssignment[row.assignmentId];
  };

  const openConfirm = (row: AttendanceSelfRow) => {
    setConfirmRow(row);
    setConfirmCheckIn(bangkokTimeInput(row.checkInAt));
    setConfirmCheckOut(bangkokTimeInput(row.checkOutAt));
    setConfirmReason('');
    setConfirmError(undefined);
    setConfirmNotice(undefined);
  };

  const submitConfirm = async () => {
    if (!confirmRow) return;
    const checkInAt = bangkokDateTimeToIso(confirmRow.date, confirmCheckIn);
    const checkOutAt = bangkokDateTimeToIso(confirmRow.date, confirmCheckOut);
    if (!checkInAt || !checkOutAt) {
      setConfirmError('กรุณาระบุเวลาเข้าและเวลาออกให้ครบ');
      return;
    }
    if (confirmReason.trim().length < 5) {
      setConfirmError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }
    setConfirmBusy(true);
    setConfirmError(undefined);
    try {
      const created = await createAttendanceAdjustment(token, {
        assignmentId: confirmRow.assignmentId,
        requestType: 'CONFIRM_WORK_PERFORMED',
        proposal: { checkInAt, checkOutAt },
        reason: confirmReason.trim()
      }) as { id?: string; data?: { id?: string } };
      const requestId = created?.id || created?.data?.id;
      if (!requestId) throw new Error('missing request id');
      await submitAttendanceAdjustment(token, requestId);
      setConfirmNotice('ส่งคำขอยืนยันแล้ว — รอผู้ดูแลอนุมัติ');
      setConfirmRow(undefined);
      loadRequests();
    } catch (reason) {
      setConfirmError(formatRequestErrorMessage(reason, 'ไม่สามารถส่งคำขอได้'));
    } finally {
      setConfirmBusy(false);
    }
  };

  return <section className="employee-v4-page employee-v4-list-page nexus-mobile-history" aria-label="Attendance History">
    <div className="nexus-mobile-breadcrumb">ประวัติการลงเวลา</div>
    <header className="employee-v4-section-header">
      <div><p>ข้อมูลย้อนหลัง</p><h1>ประวัติการลงเวลา</h1><span>ข้อมูลเวลาที่เซิร์ฟเวอร์รับและบันทึกจริง</span></div>
      <span className="employee-v4-header-icon"><SmsIcon name="history" size={22} /></span>
    </header>

    <div className="employee-v4-segmented" role="tablist" aria-label="ช่วงเวลาประวัติ" onKeyDown={activateTabFromKeyboard}>
      {([['today', 'วันนี้'], ['week', '7 วัน'], ['month', '31 วัน']] as const).map(([key, label]) =>
        <button id={`attendance-range-${key}`} key={key} type="button" role="tab" aria-selected={range === key} aria-controls="attendance-history-panel" tabIndex={range === key ? 0 : -1} className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{label}</button>
      )}
    </div>

    <div id="attendance-history-panel" role="tabpanel" aria-labelledby={`attendance-range-${range}`}>
    {!online && <div className="employee-v4-message is-warning">ออฟไลน์ — ประวัติการลงเวลาต้องอ่านจากเซิร์ฟเวอร์</div>}
    {error && <div className="employee-v4-message is-danger">{error}</div>}
    {confirmNotice && <div className="employee-v4-message is-success">{confirmNotice}</div>}
    {loading && <div className="employee-v4-loading"><span /><p>กำลังอ่านประวัติ…</p></div>}

    {!loading && online && data && <div className="employee-v4-history-list">
      {data.rows.length === 0 && <article className="employee-v4-empty"><SmsIcon name="history" size={28} /><strong>ยังไม่มีรายการในช่วงนี้</strong><span>เมื่อมีรายการลงเวลา ระบบจะแสดงที่นี่</span></article>}
      {data.rows.map((row) => {
        const currentStatus = status(row);
        return <article className="employee-v4-history-card" key={row.assignmentId}>
          <div className="employee-v4-history-card__top">
            <div><strong>{dateLabel(row.date)}</strong><span>{row.shift.code || row.shift.name || 'ไม่ระบุกะ'} · {row.shift.startTime || '—'}–{row.shift.endTime || '—'}</span></div>
            <div className="employee-v4-history-card__badges">
              {row.corrected && <span className="employee-v4-correction-badge"><SmsIcon name="history" size={12} />ปรับแล้ว</span>}
              <span className={`employee-v4-status is-${currentStatus.tone}`}>{currentStatus.label}</span>
            </div>
          </div>
          <div className="employee-v4-history-times">
            <div><span>เวลาเข้า</span><strong>{time(row.checkInAt)}</strong></div>
            <i />
            <div><span>เวลาออก</span><strong>{time(row.checkOutAt)}</strong></div>
            <i />
            <div><span>ชั่วโมง</span><strong>{duration(row.workedMinutes)}</strong></div>
          </div>
          {row.corrected && <details className="employee-v4-history-correction">
            <summary><SmsIcon name="history" size={15} />ดูเวลาเดิมและเวลาที่มีผล</summary>
            <div>
              <span>รายการ</span><strong>เดิม</strong><strong>มีผล</strong>
            </div>
            <div>
              <span>เวลาเข้า</span><strong>{time(row.originalCheckInAt)}</strong><strong>{time(row.checkInAt)}</strong>
            </div>
            <div>
              <span>เวลาออก</span><strong>{time(row.originalCheckOutAt)}</strong><strong>{time(row.checkOutAt)}</strong>
            </div>
            <small>แสดงเฉพาะการแก้ไขที่มีผลต่อการลงเวลาแล้ว · ข้อมูลเหตุการณ์ลงเวลาเดิมไม่ถูกแก้ไข</small>
          </details>}
          <div className="employee-v4-history-sites">
            <div><SmsIcon name="quality" size={15} /><span>สถานที่ตามตาราง</span><strong>{(row.assignedSite || row.expectedSite)?.name || 'ไม่ระบุ'}</strong></div>
            <div><SmsIcon name="location" size={15} /><span>สถานที่ลงเวลาจริง</span><strong>{actualSiteLabel(row)}</strong></div>
            <div><SmsIcon name="quality" size={15} /><span>ประเภท</span><strong>{row.workSiteContext === 'SUPPORT_SITE' ? 'ช่วยปฏิบัติงาน' : 'ปกติ'}</strong></div>
          </div>
          {(() => {
            const flags = row.flags.map((flag) => operationalFlagLabels[flag]).filter(Boolean);
            const timeLabels = [
              row.punctuality === 'LATE' ? 'มาสาย' : row.punctuality === 'ON_TIME' ? 'ตรงเวลา' : null,
              row.checkoutCondition === 'EARLY_LEAVE' ? 'ออกก่อนเวลา' : row.checkoutCondition === 'MISSING_CHECK_OUT' ? 'ไม่ได้ลงเวลาออก' : null,
              row.abnormalTime ? 'เวลาผิดปกติ' : null
            ].filter((value): value is string => Boolean(value));
            return (row.lateMinutes || row.earlyOutMinutes || flags.length > 0 || timeLabels.length > 0) ? <div className="employee-v4-history-flags">
              {timeLabels.map((label) => <span key={`time-${label}`}>{label}</span>)}
              {Boolean(row.lateMinutes) && <span>สาย {row.lateMinutes} นาที</span>}
              {Boolean(row.earlyOutMinutes) && <span>ออกก่อน {row.earlyOutMinutes} นาที</span>}
              {flags.map((flag) => <span key={flag}>{flag}</span>)}
            </div> : null;
          })()}
          {canConfirm(row) && <div className="employee-v4-history-flags">
            <button
              type="button"
              className="employee-v4-primary"
              onClick={() => openConfirm(row)}
              aria-label={`ยืนยันการปฏิบัติงานวันที่ ${row.date}`}
            >ยืนยันการปฏิบัติงาน</button>
          </div>}
          {requestsByAssignment[row.assignmentId] && <p className="employee-v4-history-note">
            มีคำขอสำหรับกะนี้แล้ว · สถานะ {requestsByAssignment[row.assignmentId].status}
          </p>}
        </article>;
      })}
    </div>}
    </div>
    {confirmRow && <div className="employee-v4-overlay" role="dialog" aria-modal="true" aria-label="ยืนยันการปฏิบัติงาน">
      <div className="employee-v4-dialog">
        <header>
          <h2>ยืนยันการปฏิบัติงาน</h2>
          <button type="button" aria-label="ปิด" onClick={() => setConfirmRow(undefined)}>✕</button>
        </header>
        <p className="employee-v4-hint">
          วันที่ {confirmRow.date} · ระบบบันทึกเวลาไว้แล้ว แก้ไขได้หากไม่ตรงกับเวลาที่ปฏิบัติงานจริง (ย้อนหลังได้ไม่เกิน {SELF_CONFIRM_WINDOW_DAYS} วัน)
        </p>
        <label>
          <span>เวลาเข้า (เวลาไทย)</span>
          <input type="time" value={confirmCheckIn} onChange={(event) => setConfirmCheckIn(event.target.value)} />
        </label>
        <label>
          <span>เวลาออก (เวลาไทย)</span>
          <input type="time" value={confirmCheckOut} onChange={(event) => setConfirmCheckOut(event.target.value)} />
        </label>
        <label>
          <span>เหตุผล (อย่างน้อย 5 ตัวอักษร)</span>
          <textarea value={confirmReason} onChange={(event) => setConfirmReason(event.target.value)} rows={3} />
        </label>
        {confirmError && <div className="employee-v4-message is-danger">{confirmError}</div>}
        <div className="employee-v4-dialog__actions">
          <button type="button" onClick={() => setConfirmRow(undefined)} disabled={confirmBusy}>ยกเลิก</button>
          <button type="button" className="employee-v4-primary" onClick={submitConfirm} disabled={confirmBusy}>
            {confirmBusy ? 'กำลังส่ง…' : 'ส่งคำขอยืนยัน'}
          </button>
        </div>
      </div>
    </div>}
  </section>;
}
