import { useEffect, useMemo, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import { attendanceSelfHistory, type AttendanceSelfHistoryData, type AttendanceSelfRow } from '../attendance/attendance-client';
import './employee-attendance-v4.css';

type Props = { token: string; online: boolean };

type RangeKey = 'today' | 'week' | 'month';

function bangkokDateText(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
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
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${value}T00:00:00.000Z`));
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

export function AttendanceHistoryPwaPage({ token, online }: Props) {
  const [range, setRange] = useState<RangeKey>(() => new URLSearchParams(window.location.search).get('today') === '1' ? 'today' : 'week');
  const [data, setData] = useState<AttendanceSelfHistoryData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const selected = useMemo(() => ranges(range), [range]);

  useEffect(() => {
    if (!online) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    attendanceSelfHistory(token, selected)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านประวัติได้'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [online, range, selected.from, selected.to, token]);

  return <section className="employee-v4-page employee-v4-list-page" aria-label="ประวัติการลงเวลา">
    <header className="employee-v4-section-header">
      <div><p>ATTENDANCE HISTORY</p><h1>ประวัติการลงเวลา</h1><span>ข้อมูลเวลาที่ Server รับและบันทึกจริง</span></div>
      <span className="employee-v4-header-icon"><SmsIcon name="history" size={22} /></span>
    </header>

    <div className="employee-v4-segmented" role="tablist" aria-label="ช่วงเวลาประวัติ">
      {([['today', 'วันนี้'], ['week', '7 วัน'], ['month', '31 วัน']] as const).map(([key, label]) =>
        <button key={key} type="button" className={range === key ? 'active' : ''} onClick={() => setRange(key)}>{label}</button>
      )}
    </div>

    {!online && <div className="employee-v4-message is-warning">ออฟไลน์ — ประวัติ Attendance ต้องอ่านจาก Server</div>}
    {error && <div className="employee-v4-message is-danger">{error}</div>}
    {loading && <div className="employee-v4-loading"><span /><p>กำลังอ่านประวัติ…</p></div>}

    {!loading && online && data && <div className="employee-v4-history-list">
      {data.rows.length === 0 && <article className="employee-v4-empty"><SmsIcon name="history" size={28} /><strong>ยังไม่มีรายการในช่วงนี้</strong><span>เมื่อมี AttendanceEvent ระบบจะแสดงที่นี่</span></article>}
      {data.rows.map((row) => {
        const currentStatus = status(row);
        return <article className="employee-v4-history-card" key={row.assignmentId}>
          <div className="employee-v4-history-card__top">
            <div><strong>{dateLabel(row.date)}</strong><span>{row.shift.code || row.shift.name || 'SHIFT'} · {row.shift.startTime || '—'}–{row.shift.endTime || '—'}</span></div>
            <span className={`employee-v4-status is-${currentStatus.tone}`}>{currentStatus.label}</span>
          </div>
          <div className="employee-v4-history-times">
            <div><span>เวลาเข้า</span><strong>{time(row.checkInAt)}</strong></div>
            <i />
            <div><span>เวลาออก</span><strong>{time(row.checkOutAt)}</strong></div>
            <i />
            <div><span>ชั่วโมง</span><strong>{duration(row.workedMinutes)}</strong></div>
          </div>
          <div className="employee-v4-history-site"><SmsIcon name="quality" size={16} /><span>{row.actualSite?.name || row.expectedSite?.name || 'ไม่ระบุ Site'}</span></div>
          {(row.lateMinutes || row.earlyOutMinutes) ? <div className="employee-v4-history-flags">
            {Boolean(row.lateMinutes) && <span>สาย {row.lateMinutes} นาที</span>}
            {Boolean(row.earlyOutMinutes) && <span>ออกก่อน {row.earlyOutMinutes} นาที</span>}
          </div> : null}
        </article>;
      })}
    </div>}
  </section>;
}
