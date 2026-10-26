import './my-work-queue.css';
import { SmsIcon, type SmsIconName } from '../SmsIcon';
import { APPROVAL_COUNT_TYPES, type ApprovalCountSummary, type ApprovalCountType } from '../approval-count-badge';

/* Labels match the Approval Center filter chips so the user lands on the same words (audit D-01). */
const QUEUE_LABEL: Record<ApprovalCountType, string> = {
  LEAVE_REQUEST: 'คำขอลา',
  LICENSE_DOCUMENT: 'เอกสารใบอนุญาต',
  ATTENDANCE_ADJUSTMENT_REQUEST: 'ขอแก้ไขเวลาลงงาน',
  REGISTRATION_REQUEST: 'ลงทะเบียนบัญชี',
  ATTENDANCE_DEVICE_REQUEST: 'อุปกรณ์ลงเวลา',
  SCHEDULE_APPROVAL: 'อนุมัติตารางกะ',
  EMPLOYEE_MASTER_CHANGE: 'แก้ไขข้อมูลพนักงาน',
  EMPLOYEE_REFERENCE_PHOTO: 'รูปอ้างอิงพนักงาน',
  USER_ACCESS: 'เปิดสิทธิ์ผู้ใช้'
};

const QUEUE_ICON: Record<ApprovalCountType, SmsIconName> = {
  LEAVE_REQUEST: 'leave',
  LICENSE_DOCUMENT: 'license',
  ATTENDANCE_ADJUSTMENT_REQUEST: 'clock',
  REGISTRATION_REQUEST: 'key',
  ATTENDANCE_DEVICE_REQUEST: 'device',
  SCHEDULE_APPROVAL: 'calendar',
  EMPLOYEE_MASTER_CHANGE: 'employees',
  EMPLOYEE_REFERENCE_PHOTO: 'employees',
  USER_ACCESS: 'employees'
};

type Props = {
  summary: ApprovalCountSummary | null | undefined;
  status?: 'loading' | 'ready' | 'error';
  onOpen(type?: ApprovalCountType): void;
};

const countText = (value: number) => (value > 99 ? '99+' : new Intl.NumberFormat('th-TH').format(value));

/**
 * "งานของฉัน" — one queue of what is waiting for this user's decision, split by request type.
 * Counts come from the existing role-scoped approval summary (same source as the menu badges);
 * every row opens the Approval Center pre-filtered to that type. No new API, no derived numbers.
 */
export function MyWorkQueueCard({ summary, status = summary ? 'ready' : 'loading', onOpen }: Props) {
  const rows = summary
    ? APPROVAL_COUNT_TYPES.map((type) => ({ type, count: Number(summary.byType?.[type]) || 0 })).filter((row) => row.count > 0).sort((a, b) => b.count - a.count)
    : [];
  const total = summary ? Number(summary.total) || 0 : 0;

  return (
    <section className="my-work-queue" aria-label="งานของฉัน">
      <header>
        <div>
          <p className="nexus-kicker">คิวเดียว</p>
          <h2>งานของฉัน</h2>
          <span>{status === 'ready' ? (total ? `คำขอที่รอคุณพิจารณาตามสิทธิ์อนุมัติ · ${countText(total)} รายการ` : 'ไม่มีคำขอที่รอคุณพิจารณา') : status === 'error' ? 'โหลดจำนวนคำขอไม่สำเร็จ ระบบไม่แสดงตัวเลขแทน' : 'กำลังอ่านจำนวนคำขอ…'}</span>
        </div>
        <button type="button" className="my-work-queue__all" onClick={() => onOpen()}>เปิดศูนย์อนุมัติ</button>
      </header>
      {status === 'ready' && rows.length > 0 && (
        <ul className="my-work-queue__list">
          {rows.map((row) => (
            <li key={row.type}>
              <button type="button" onClick={() => onOpen(row.type)} aria-label={`${QUEUE_LABEL[row.type]} ${row.count} รายการ เปิดในศูนย์อนุมัติ`}>
                <span className="my-work-queue__icon" aria-hidden="true"><SmsIcon name={QUEUE_ICON[row.type]} size={17} /></span>
                <strong>{QUEUE_LABEL[row.type]}</strong>
                <b className="my-work-queue__count">{countText(row.count)}</b>
                <span className="my-work-queue__open" aria-hidden="true">เปิด →</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {status === 'ready' && rows.length === 0 && (
        <div className="my-work-queue__clear"><SmsIcon name="check" size={22} /><strong>ไม่มีงานรอคุณ</strong></div>
      )}
    </section>
  );
}
