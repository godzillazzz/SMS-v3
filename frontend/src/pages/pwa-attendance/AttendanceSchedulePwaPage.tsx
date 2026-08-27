import { useEffect, useMemo, useState } from 'react';
import { SmsIcon } from '../../components/SmsIcon';
import { attendanceSelfSchedule, type AttendanceSelfScheduleData } from '../attendance/attendance-client';
import './employee-attendance-v4.css';

type Props = { token: string; online: boolean };

function currentBangkokMonth() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}`;
}

function currentBangkokDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftMonth(value: string, offset: number) {
  const [year, month] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

function monthLabel(value: string) {
  return new Intl.DateTimeFormat('th-TH', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00.000Z`));
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('th-TH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00.000Z`));
}

export function AttendanceSchedulePwaPage({ token, online }: Props) {
  const [month, setMonth] = useState(currentBangkokMonth);
  const [data, setData] = useState<AttendanceSelfScheduleData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const today = currentBangkokDate();
  const highlights = useMemo(() => {
    if (!data?.approved || month !== today.slice(0, 7)) return { today: undefined, next: undefined };
    const sorted = [...data.rows].sort((a, b) => a.date.localeCompare(b.date));
    const todayRow = sorted.find((row) => row.date === today);
    const nextRow = sorted.find((row) => row.date > today);
    return { today: todayRow, next: nextRow };
  }, [data, month, today]);

  useEffect(() => {
    if (!online) return;
    let active = true;
    setLoading(true);
    setError(undefined);
    attendanceSelfSchedule(token, month)
      .then((result) => { if (active) setData(result); })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านตารางงานได้'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [month, online, token]);

  return <section className="employee-v4-page employee-v4-list-page" aria-label="ตารางงาน">
    <header className="employee-v4-section-header">
      <div><p>WORK SCHEDULE</p><h1>ตารางงาน</h1><span>แสดงเฉพาะตารางที่อนุมัติและล็อกแล้ว</span></div>
      <span className="employee-v4-header-icon"><SmsIcon name="calendar" size={22} /></span>
    </header>

    <div className="employee-v4-month-control">
      <button type="button" aria-label="เดือนก่อนหน้า" onClick={() => setMonth((value) => shiftMonth(value, -1))}>‹</button>
      <div><span>เดือนที่เลือก</span><strong>{monthLabel(month)}</strong></div>
      <button type="button" aria-label="เดือนถัดไป" onClick={() => setMonth((value) => shiftMonth(value, 1))}>›</button>
    </div>

    {!online && <div className="employee-v4-message is-warning">ออฟไลน์ — ตารางงานต้องอ่านจาก Server</div>}
    {error && <div className="employee-v4-message is-danger">{error}</div>}
    {loading && <div className="employee-v4-loading"><span /><p>กำลังอ่านตารางงาน…</p></div>}

    {!loading && online && data && !data.approved && <article className="employee-v4-empty">
      <SmsIcon name="shield" size={28} /><strong>ตารางเดือนนี้ยังไม่พร้อม</strong><span>ระบบจะแสดงเมื่อ ADMIN อนุมัติและตารางถูกล็อกแล้ว</span>
    </article>}

    {!loading && online && data?.approved && <div className="employee-v4-schedule-list">
      <div className="employee-v4-approved"><SmsIcon name="check" size={17} /><span>Approved Schedule</span><b>Revision {data.revision}</b></div>
      {month === today.slice(0, 7) && (highlights.today || highlights.next) && <section className="employee-v4-shift-highlights" aria-label="กะวันนี้และกะถัดไป">
        {highlights.today && <article className="is-today">
          <span>กะวันนี้</span>
          <strong>{highlights.today.shift.code || highlights.today.shift.name || 'SHIFT'}</strong>
          <small>{highlights.today.shift.startTime || '—'}–{highlights.today.shift.endTime || '—'}</small>
          <p><SmsIcon name="location" size={14} />{highlights.today.expectedSite?.name || 'ไม่ระบุ Site'}</p>
        </article>}
        {highlights.next && <article>
          <span>กะถัดไป · {dateLabel(highlights.next.date)}</span>
          <strong>{highlights.next.shift.code || highlights.next.shift.name || 'SHIFT'}</strong>
          <small>{highlights.next.shift.startTime || '—'}–{highlights.next.shift.endTime || '—'}</small>
          <p><SmsIcon name="location" size={14} />{highlights.next.expectedSite?.name || 'ไม่ระบุ Site'}</p>
        </article>}
      </section>}
      {data.rows.length === 0 && <article className="employee-v4-empty"><SmsIcon name="calendar" size={28} /><strong>ไม่มีตารางงานในเดือนนี้</strong></article>}
      {data.rows.map((row) => <article className="employee-v4-schedule-card" key={row.assignmentId}>
        <div className="employee-v4-schedule-date"><strong>{new Date(`${row.date}T00:00:00.000Z`).getUTCDate()}</strong><span>{dateLabel(row.date).split(' ')[0]}</span></div>
        <div className="employee-v4-schedule-main"><strong>{row.shift.code || row.shift.name || 'SHIFT'}</strong><span>{row.shift.startTime || '—'}–{row.shift.endTime || '—'}</span><small><SmsIcon name="quality" size={14} />{row.expectedSite?.name || 'ไม่ระบุ Site'}</small></div>
        {row.remark && <span className="employee-v4-schedule-note">{row.remark}</span>}
      </article>)}
    </div>}
  </section>;
}
