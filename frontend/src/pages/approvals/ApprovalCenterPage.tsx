import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api';
import { getApprovalCenter, getApprovalCenterSummary } from '../../approval-center-client';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { SmsIcon } from '../../components/SmsIcon';
import { roleDisplayName } from '../../role-display';
import { formatThaiDateTime } from '../../thai-date-time';
import type { LeaveDecisionAction } from '../../components/LeaveDecisionConfirmation';
import { approveAttendanceAdjustment, rejectAttendanceAdjustment } from '../attendance-supervisor/attendance-adjustment-client';
import '../../styles/approval-center.css';
import { MetricCard, PageHeader, SectionCard } from '../../components/layout';

type ApprovalUrgency = 'NEW' | 'DUE_SOON' | 'OVERDUE';
type ApprovalType =
  | 'EMPLOYEE_MASTER_CHANGE'
  | 'EMPLOYEE_REFERENCE_PHOTO'
  | 'LICENSE_DOCUMENT'
  | 'SCHEDULE_APPROVAL'
  | 'ATTENDANCE_DEVICE_REQUEST'
  | 'ATTENDANCE_ADJUSTMENT_REQUEST'
  | 'REGISTRATION_REQUEST'
  | 'USER_ACCESS'
  | 'LEAVE_REQUEST';
type ApprovalSourcePage = 'employees' | 'licenses' | 'approvals' | 'attendanceDevice' | 'attendanceSupervisor' | 'users' | 'leavePending';
type CategoryFilter = 'ALL' | ApprovalType;
type UrgencyFilter = 'ALL' | 'URGENT' | 'STANDARD';

export type ApprovalCenterItem = {
  id: string;
  requestId: string;
  type: ApprovalType;
  title: string;
  status: string;
  sourcePage: ApprovalSourcePage;
  submittedAt: string;
  ageHours: number;
  urgency: ApprovalUrgency;
  sla?: { dueSoonHours: number; overdueHours: number };
  revision?: number;
  changedFields?: string[];
  employee?: { id?: string; employeeCode?: string; firstName?: string; lastName?: string; displayName?: string; department?: string; jobTitle?: string } | null;
  requestedBy?: { id?: string | null; displayName?: string | null; role?: string | null };
  photo?: { fileName?: string; mimeType?: string; fileSize?: number; imageWidth?: number; imageHeight?: number };
  metadata?: Record<string, unknown>;
};

type Summary = {
  total: number;
  byType?: Partial<Record<ApprovalType, number>>;
  truncated?: boolean;
};

type Props = {
  token: string;
  role: string;
  currentEmployeeId?: string;
  refreshKey?: number;
  onChanged(): void;
  onOpenEmployeeChange(requestId: string): void;
  onNavigate(item: ApprovalCenterItem): void;
  onLeaveDecision(item: ApprovalCenterItem, action: LeaveDecisionAction): void;
};

const typeLabel: Record<ApprovalType, string> = {
  EMPLOYEE_MASTER_CHANGE: 'แก้ไขข้อมูลพนักงาน',
  EMPLOYEE_REFERENCE_PHOTO: 'รูปอ้างอิงพนักงาน',
  LICENSE_DOCUMENT: 'เอกสารใบอนุญาต',
  SCHEDULE_APPROVAL: 'อนุมัติตารางกะ',
  ATTENDANCE_DEVICE_REQUEST: 'อุปกรณ์ลงเวลา',
  ATTENDANCE_ADJUSTMENT_REQUEST: 'ขอแก้ไขเวลาลงงาน',
  REGISTRATION_REQUEST: 'ลงทะเบียนบัญชี',
  USER_ACCESS: 'เปิดสิทธิ์ผู้ใช้',
  LEAVE_REQUEST: 'คำขอลา'
};

const approvalTypeOrder: ApprovalType[] = [
  'LEAVE_REQUEST',
  'SCHEDULE_APPROVAL',
  'REGISTRATION_REQUEST',
  'USER_ACCESS',
  'EMPLOYEE_MASTER_CHANGE',
  'EMPLOYEE_REFERENCE_PHOTO',
  'LICENSE_DOCUMENT',
  'ATTENDANCE_DEVICE_REQUEST',
  'ATTENDANCE_ADJUSTMENT_REQUEST'
];

const text = (value: unknown) => value === undefined || value === null || value === '' ? '—' : String(value);

const fmt = (value: string) => formatThaiDateTime(value);

const employeeName = (item?: ApprovalCenterItem) =>
  item?.employee?.displayName
  || [item?.employee?.firstName, item?.employee?.lastName].filter(Boolean).join(' ')
  || item?.requestedBy?.displayName
  || item?.title
  || 'รายการคำขอ';

const meta = (item: ApprovalCenterItem, key: string) => item.metadata?.[key];

const reasonFor = (item: ApprovalCenterItem) =>
  text(meta(item, 'reason') || meta(item, 'departmentHint') || item.title);

const senderName = (item: ApprovalCenterItem) => item.requestedBy?.displayName?.trim() || 'ไม่ระบุผู้ส่ง';
const senderRoleName = (role?: string | null) =>
  String(role || '').trim().toUpperCase() === 'REQUESTER' ? 'ผู้สมัคร' : roleDisplayName(role);

function pendingAge(ageHours: number) {
  const hours = Math.max(0, Math.floor(Number(ageHours) || 0));
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  if (days > 0) return remainingHours > 0 ? `${days} วัน ${remainingHours} ชม.` : `${days} วัน`;
  return `${hours} ชม.`;
}

function itemSummary(item: ApprovalCenterItem) {
  const values: unknown[] = [];
  if (item.type === 'LEAVE_REQUEST') {
    values.push(meta(item, 'leaveType'));
    values.push(meta(item, 'startDate') && meta(item, 'endDate')
      ? `${text(meta(item, 'startDate'))} – ${text(meta(item, 'endDate'))}`
      : meta(item, 'startDate'));
    values.push(meta(item, 'dayCount') ? `${text(meta(item, 'dayCount'))} วัน` : null);
  } else if (item.type === 'SCHEDULE_APPROVAL') {
    values.push(item.title);
  } else if (item.type === 'REGISTRATION_REQUEST') {
    values.push(meta(item, 'matchedEmployeeName') || meta(item, 'departmentHint'));
  } else if (item.type === 'ATTENDANCE_DEVICE_REQUEST') {
    values.push(meta(item, 'deviceName'));
    values.push(meta(item, 'reason'));
  } else if (item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST') {
    values.push(meta(item, 'workDate'));
    values.push(meta(item, 'reason'));
  } else if (item.type === 'LICENSE_DOCUMENT') {
    values.push(meta(item, 'licenseType'));
    values.push(meta(item, 'fileName'));
  } else if (item.type === 'EMPLOYEE_REFERENCE_PHOTO') {
    values.push(item.photo?.fileName);
  } else if (item.type === 'EMPLOYEE_MASTER_CHANGE') {
    values.push(item.changedFields?.length ? `แก้ไข ${item.changedFields.length} รายการ` : null);
  } else if (item.type === 'USER_ACCESS') {
    values.push(meta(item, 'department'));
  }
  const summary = values.filter((value) => value !== undefined && value !== null && value !== '').map(text).join(' · ');
  return summary || reasonFor(item);
}

function detailActionLabel(item: ApprovalCenterItem) {
  if (item.type === 'EMPLOYEE_MASTER_CHANGE') return 'ดูรายละเอียดการแก้ไข';
  if (item.type === 'SCHEDULE_APPROVAL') return 'ดูรายละเอียดตารางกะ';
  if (item.type === 'REGISTRATION_REQUEST') return 'เปิดตรวจสอบคำขอลงทะเบียน';
  return 'ดูรายละเอียด';
}

function urgencyTone(item: ApprovalCenterItem) {
  if (item.urgency === 'OVERDUE') return 'approval-urgency approval-urgency--overdue';
  if (item.urgency === 'DUE_SOON') return 'approval-urgency approval-urgency--due-soon';
  return 'approval-urgency approval-urgency--new';
}

function urgencyText(item: ApprovalCenterItem) {
  if (item.urgency === 'OVERDUE') return 'เกินกำหนด ' + text(item.sla?.overdueHours) + ' ชม.';
  if (item.urgency === 'DUE_SOON') return 'ใกล้ครบกำหนด ' + text(item.sla?.dueSoonHours) + ' ชม.';
  return 'ปกติ';
}

export function ApprovalCenterPage({
  token,
  role,
  currentEmployeeId,
  refreshKey = 0,
  onChanged,
  onOpenEmployeeChange,
  onNavigate,
  onLeaveDecision
}: Props) {
  const [items, setItems] = useState<ApprovalCenterItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byType: {} });
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const [filter, setFilter] = useState<CategoryFilter>('ALL');
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<{ id: string; action: 'approve' | 'reject' }>();
  const [error, setError] = useState<RequestErrorInput>();
  const [notice, setNotice] = useState('');
  const [rejecting, setRejecting] = useState<ApprovalCenterItem>();
  const [rejectReason, setRejectReason] = useState('');

  const loadQueue = async () => {
    setLoading(true);
    setSummaryAvailable(false);
    setError(undefined);

    try {
      const [result, authoritativeSummary] = await Promise.all([
        getApprovalCenter(token),
        getApprovalCenterSummary(token)
      ]);
      const next = Array.isArray(result?.data) ? result.data as ApprovalCenterItem[] : [];
      const byType = authoritativeSummary?.summary?.byType;

      setItems(next);
      setSummary({
        total: Number(authoritativeSummary?.summary?.total || 0),
        byType: byType && typeof byType === 'object' ? byType : {},
        truncated: Boolean(result?.summary?.truncated)
      });
      setFilter((current) => current === 'ALL' || Number(byType?.[current] || 0) > 0 ? current : 'ALL');
      setSummaryAvailable(true);
      setSelectedId((current) => next.some((item) => item.id === current) ? current : next[0]?.id || '');
    } catch (cause) {
      setSummaryAvailable(false);
      setError(toRequestErrorState(cause, 'ไม่สามารถโหลดศูนย์อนุมัติได้'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadQueue();
  }, [token, role, refreshKey]);

  const visible = useMemo(() => items.filter((item) => {
    const categoryMatches = filter === 'ALL' || item.type === filter;
    const urgencyMatches = urgencyFilter === 'ALL'
      || (urgencyFilter === 'URGENT' ? item.urgency !== 'NEW' : item.urgency === 'NEW');

    return categoryMatches && urgencyMatches;
  }), [items, filter, urgencyFilter]);

  const selected = items.find((item) => item.id === selectedId);
  const selectedLeaveIsSelf = selected?.type === 'LEAVE_REQUEST'
    && Boolean(currentEmployeeId)
    && selected.employee?.id === currentEmployeeId;


  const executeDirectDecision = async (
    item: ApprovalCenterItem,
    action: 'approve' | 'reject',
    reason = ''
  ) => {
    if (item.type === 'EMPLOYEE_MASTER_CHANGE') {
      onOpenEmployeeChange(item.requestId);
      return;
    }

    if (item.type === 'LEAVE_REQUEST') {
      if (Boolean(currentEmployeeId) && item.employee?.id === currentEmployeeId) {
        setError('ไม่สามารถอนุมัติหรือปฏิเสธใบลาของตนเองได้');
        return;
      }
      onLeaveDecision(item, action);
      return;
    }

    setBusyAction({ id: item.id, action });
    setError(undefined);
    setNotice('');

    try {
      if (item.type === 'EMPLOYEE_REFERENCE_PHOTO') {
        if (action === 'approve') await api.approveEmployeeReferencePhoto(token, item.requestId);
        else await api.rejectEmployeeReferencePhoto(token, item.requestId, reason);
      } else if (item.type === 'LICENSE_DOCUMENT') {
        if (action === 'approve') await api.approveLicenseDocument(token, item.requestId);
        else await api.rejectLicenseDocument(token, item.requestId, reason);
      } else if (item.type === 'ATTENDANCE_DEVICE_REQUEST') {
        if (action === 'approve') await api.approveAttendanceDeviceRequest(token, item.requestId);
        else await api.rejectAttendanceDeviceRequest(token, item.requestId, reason);
      } else if (item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST') {
        if (action === 'approve') await approveAttendanceAdjustment(token, item.requestId);
        else await rejectAttendanceAdjustment(token, item.requestId, reason);
      } else if (item.type === 'REGISTRATION_REQUEST') {
        if (action === 'approve') await api.approveRegistrationRequest(token, item.requestId);
        else await api.rejectRegistrationRequest(token, item.requestId, reason);
      } else if (item.type === 'USER_ACCESS') {
        if (action === 'approve') {
          await api.updateUser(token, item.requestId, { accountStatus: 'ACTIVE', isActive: true });
        } else {
          await api.updateUser(token, item.requestId, { accountStatus: 'REJECTED', isActive: false });
        }
      } else {
        onNavigate(item);
        return;
      }

      setNotice(action === 'approve'
        ? 'อนุมัติคำขอสำเร็จ และอัปเดตคิวแล้ว'
        : 'ปฏิเสธคำขอสำเร็จ และอัปเดตคิวแล้ว');
      setRejecting(undefined);
      setRejectReason('');
      await loadQueue();
      onChanged();
    } catch (cause) {
      setError(toRequestErrorState(
        cause,
        action === 'approve' ? 'อนุมัติคำขอไม่สำเร็จ' : 'ปฏิเสธคำขอไม่สำเร็จ'
      ));
    } finally {
      setBusyAction(undefined);
    }
  };

  const requestReject = (item: ApprovalCenterItem) => {
    if (item.type === 'EMPLOYEE_MASTER_CHANGE') {
      onOpenEmployeeChange(item.requestId);
      return;
    }

    if (item.type === 'LEAVE_REQUEST') {
      if (Boolean(currentEmployeeId) && item.employee?.id === currentEmployeeId) {
        setError('ไม่สามารถตรวจสอบใบลาของตนเองได้');
        return;
      }
      onLeaveDecision(item, 'reject');
      return;
    }

    setRejecting(item);
    setRejectReason('');
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    if (rejectReason.trim().length < 3) {
      setError('กรุณาระบุเหตุผลการปฏิเสธอย่างน้อย 3 ตัวอักษร');
      return;
    }

    await executeDirectDecision(rejecting, 'reject', rejectReason.trim());
  };

  const renderActionButtons = (item: ApprovalCenterItem, mobile = false) => {
    const busy = busyAction?.id === item.id;
    const selfLeave = item.type === 'LEAVE_REQUEST'
      && Boolean(currentEmployeeId)
      && item.employee?.id === currentEmployeeId;

    if (item.type === 'EMPLOYEE_MASTER_CHANGE' || item.type === 'SCHEDULE_APPROVAL') return null;

    if (selfLeave) {
    return <span className="approval-self-leave">
        ห้ามอนุมัติใบลาของตนเอง
      </span>;
    }

    return <div className={`approval-action-buttons${mobile ? ' approval-action-buttons--mobile' : ''}`}>
      <button
        type="button"
        disabled={busy}
        onClick={() => requestReject(item)}
        className="approval-action-button approval-action-button--reject"
      >
        {busy && busyAction?.action === 'reject' ? 'กำลังปฏิเสธ…' : 'ปฏิเสธ'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void executeDirectDecision(item, 'approve')}
        className="approval-action-button approval-action-button--approve"
      >
        {busy && busyAction?.action === 'approve' ? 'กำลังอนุมัติ…' : 'อนุมัติทันที'}
      </button>
    </div>;
  };

  const openDetails = (item: ApprovalCenterItem) => {
    if (item.type === 'EMPLOYEE_MASTER_CHANGE') {
      onOpenEmployeeChange(item.requestId);
      return;
    }
    onNavigate(item);
  };

  const renderDetailButton = (item: ApprovalCenterItem) => <button
    type="button"
    onClick={() => openDetails(item)}
    className="approval-detail-button"
  >
    {detailActionLabel(item)}
  </button>;

  const telemetry = [
    {
      label: 'คำขอรออนุมัติ',
      value: summaryAvailable ? String(summary.total) : null,
      loading,
      note: 'รายการที่รอการอนุมัติตามสิทธิ์ ' + roleDisplayName(role)
    }
  ];

  return <section
    className="nexus-approval-center approval-center-page layout-page-surface"
    aria-label="ศูนย์อนุมัติคำขอ"
  >
    <div className="approval-center-content">
      <PageHeader kicker="งานที่รอการพิจารณา" title="ศูนย์อนุมัติคำขอ" description="ดูและดำเนินการกับคำขอที่รออนุมัติตามสิทธิ์ของคุณ" className="approval-center-header" actions={<button type="button" disabled={loading} onClick={() => void loadQueue()} className="btn-neutral small-action"><SmsIcon name="refresh" size={16} />รีเฟรชข้อมูล</button>} />

      {error && <div className="approval-center-alert approval-center-alert--error">
        <RequestErrorContent error={error} />
      </div>}
      {notice && <div className="approval-center-alert approval-center-alert--success">
        {notice}
      </div>}

      <div className="approval-center-metrics">
        {telemetry.filter((metric) => metric.loading || metric.value !== null).map((metric) => <MetricCard key={metric.label} label={metric.label} value={metric.loading ? <span className="approval-metric-skeleton" aria-label="กำลังโหลด" /> : metric.value} description={metric.note} loading={metric.loading} className="nexus-telemetry-card" />)}
      </div>

      <SectionCard kicker="ตัวกรอง" title="ประเภทและความเร่งด่วน" description="เลือกประเภทคำขอหรือระดับความเร่งด่วนเพื่อจำกัดรายการที่แสดง" className="approval-filter-card">
        <div className="approval-filter-layout">
          <div className="approval-category-filters" role="group" aria-label="ตัวกรองประเภทคำขอ">
            {[
              { id: 'ALL' as const, label: 'ทั้งหมด', count: summary.total },
              ...approvalTypeOrder
                .map((id) => ({ id, label: typeLabel[id], count: Number(summary.byType?.[id] || 0) }))
                .filter((option) => option.count > 0)
            ].map(({ id, label, count }) => <button
              type="button"
              key={id}
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`approval-filter-option${filter === id ? ' is-selected' : ''}`}
            >
              {label} <b>{count}</b>
            </button>)}
          </div>

          <div className="approval-urgency-filters" role="group" aria-label="ตัวกรองระดับความเร่งด่วน">
            {([
              ['URGENT', 'ด่วนที่สุด (Urgent)'],
              ['STANDARD', 'ปกติ (Standard)']
            ] as Array<[Exclude<UrgencyFilter, 'ALL'>, string]>).map(([id, label]) => <button
              type="button"
              key={id}
              aria-pressed={urgencyFilter === id}
              onClick={() => setUrgencyFilter((current) => current === id ? 'ALL' : id)}
              className={`approval-filter-option${urgencyFilter === id ? ' is-selected' : ''}${id === 'URGENT' ? ' approval-filter-option--urgent' : ''}`}
            >
              {label}
            </button>)}
          </div>
        </div>
      </SectionCard>

      <div className="approval-queue-section">
        <SectionCard kicker="คิวคำขอ" title="งานที่รอฉันดำเนินการ" description="แสดงคำขอจาก Approval API เดิม พร้อมทางลัดดูรายละเอียดและดำเนินการตามสิทธิ์" className="approval-queue-card" actions={<span className="approval-queue-count">{summaryAvailable ? `${visible.length} จาก ${summary.total} รายการ` : 'กำลังโหลด'}</span>}>

          <div className="approval-queue-desktop">
            <div className="approval-queue-table-scroll">
              <table className="approval-queue-table">
                <thead>
                  <tr>
                    <th>ผู้ส่งคำขอ / ผู้ปฏิบัติงาน</th>
                    <th>ประเภทและอายุคิว</th>
                    <th>ส่งเมื่อ</th>
                    <th>สรุปรายการ</th>
                    <th className="approval-queue-actions-heading">รายละเอียด / ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr>
                    <td colSpan={5} className="approval-queue-state">
                      กำลังโหลดคิวอนุมัติ…
                    </td>
                  </tr> : visible.length ? visible.map((item) => {
                    const active = selected?.id === item.id;

                    return <tr
                      key={item.id}
                      className={`approval-queue-row${active ? ' is-selected' : ''}`}
                    >
                      <td>
                        <button
                          type="button"
                          aria-pressed={selected?.id === item.id}
                          onClick={() => setSelectedId(item.id)}
                          className="nexus-approval-select approval-person-select"
                        >
                          <span className="approval-person-avatar" aria-hidden="true">
                            <SmsIcon name="users" size={17} />
                          </span>
                          <span className="approval-person-copy">
                            <strong className="approval-person-name">
                              {employeeName(item)}
                            </strong>
                            <small>
                              ผู้ส่ง: {senderName(item)}
                            </small>
                            <small>
                              {item.requestedBy?.role ? senderRoleName(item.requestedBy.role) : item.employee?.jobTitle || item.employee?.department || 'คำขออนุมัติ'}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td>
                        <div className="approval-type-label">{typeLabel[item.type]}</div>
                        <span className={urgencyTone(item)}>
                          {urgencyText(item)}
                        </span>
                        <small className="approval-queue-age">รอมา {pendingAge(item.ageHours)}</small>
                      </td>
                      <td className="approval-queue-submitted">
                        {fmt(item.submittedAt)}
                      </td>
                      <td className="approval-queue-summary">
                        {itemSummary(item)}
                      </td>
                      <td><div className="approval-queue-row-actions">{renderDetailButton(item)}{renderActionButtons(item)}</div></td>
                    </tr>;
                  }) : <tr>
                    <td colSpan={5} className="approval-queue-empty">
                      <SmsIcon name="check" size={28} className="approval-queue-empty-icon" />
                      <strong>ไม่มีคำขอในตัวกรองนี้</strong>
                      <span>
                        ระบบจะแสดงเฉพาะข้อมูลจริงจาก Approval API เดิม
                      </span>
                    </td>
                  </tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="approval-queue-mobile">
            {loading ? <div className="approval-queue-state">
              กำลังโหลดคิวอนุมัติ…
            </div> : visible.length ? visible.map((item) => <article
              key={item.id}
              className={`approval-mobile-card${selected?.id === item.id ? ' is-selected' : ''}`}
            >
              <button
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelectedId(item.id)}
                className="nexus-approval-select approval-mobile-card-select"
              >
                <div className="approval-mobile-card-heading">
                  <span className="approval-person-avatar" aria-hidden="true">
                    <SmsIcon name="users" size={18} />
                  </span>
                  <span className="approval-person-copy">
                    <strong className="approval-person-name">{employeeName(item)}</strong>
                    <small>ผู้ส่ง: {senderName(item)}</small>
                    <small>{typeLabel[item.type]}</small>
                  </span>
                  <span className={urgencyTone(item)}>
                    {item.urgency === 'NEW' ? 'ปกติ' : 'เร่งด่วน'}
                  </span>
                </div>

                <dl className="approval-mobile-card-meta">
                  <div>
                    <dt>ส่งเมื่อ</dt>
                    <dd>{fmt(item.submittedAt)}</dd>
                  </div>
                  <div>
                    <dt>อายุคิว</dt>
                    <dd>{pendingAge(item.ageHours)}</dd>
                  </div>
                  <div className="approval-mobile-card-meta__summary">
                    <dt>สรุปรายการ</dt>
                    <dd>{itemSummary(item)}</dd>
                  </div>
                </dl>
              </button>
              <div className="approval-mobile-card-actions">{renderDetailButton(item)}{renderActionButtons(item, true)}</div>
            </article>) : <div className="approval-queue-empty">
              <SmsIcon name="check" size={30} className="approval-queue-empty-icon" />
              <strong className="approval-queue-empty-title">ไม่มีคำขอในตัวกรองนี้</strong>
            </div>}
          </div>
        </SectionCard>
      </div>

      {summary.truncated && <p className="approval-queue-warning">
        คิวมีรายการมากกว่าจำนวนที่โหลดจาก API (limit 100) — ระบบไม่ได้ซ่อนจำนวนรวมใน Telemetry
      </p>}

      <div className="approval-center-live-region" aria-live="polite">
        {selectedLeaveIsSelf
          ? 'คำขอลาที่เลือกเป็นคำขอของผู้ใช้ปัจจุบัน'
          : ''}
      </div>
    </div>

    {rejecting && <div
      className="nexus-reject-modal approval-reject-modal"
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันการปฏิเสธคำขอ"
    >
      <section className="approval-reject-dialog">
        <p className="approval-reject-kicker">REJECT REQUEST</p>
        <h2>{employeeName(rejecting)}</h2>
        <label className="approval-reject-reason">
          เหตุผลการปฏิเสธ
          <textarea
            autoFocus
            rows={4}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            className="approval-reject-input"
            placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร"
          />
        </label>

        <div className="approval-reject-actions">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => { setRejecting(undefined); setRejectReason(''); }}
            className="approval-reject-button"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => void confirmReject()}
            className="approval-reject-button approval-reject-button--confirm"
          >
            {busyAction ? 'กำลังดำเนินการ…' : 'ยืนยันปฏิเสธ'}
          </button>
        </div>
      </section>
    </div>}
  </section>;
}
