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
type ApprovalSourcePage = 'employees' | 'licenses' | 'approvals' | 'attendanceDevice' | 'attendance' | 'users' | 'leavePending';
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
  if (item.urgency === 'OVERDUE') return 'border-[#ef4444]/45 bg-[#ef4444]/10 text-[#ef4444]';
  if (item.urgency === 'DUE_SOON') return 'border-[#f59e0b]/45 bg-[#f59e0b]/10 text-[#f59e0b]';
  return 'border-[#25b8d3]/30 bg-[#25b8d3]/10 text-[#8be5f2]';
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
      return <span className="rounded-[7px] border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-3 py-2 text-xs text-[#f59e0b]">
        ห้ามอนุมัติใบลาของตนเอง
      </span>;
    }

    return <div className={mobile ? 'grid grid-cols-2 gap-2' : 'flex justify-end gap-2'}>
      <button
        type="button"
        disabled={busy}
        onClick={() => requestReject(item)}
        className="min-h-[44px] rounded-[7px] border border-[#ef4444]/55 bg-[#0f1d2a] px-3 text-sm font-semibold text-[#fca5a5] transition hover:bg-[#1a2836] disabled:cursor-wait disabled:opacity-50"
      >
        {busy && busyAction?.action === 'reject' ? 'กำลังปฏิเสธ…' : 'ปฏิเสธ'}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void executeDirectDecision(item, 'approve')}
        className="min-h-[44px] rounded-[7px] border border-[#25b8d3]/65 bg-[#25b8d3] px-3 text-sm font-bold text-[#020813] shadow-[0_0_18px_rgba(37,184,211,0.18)] transition hover:bg-[#52c9de] disabled:cursor-wait disabled:opacity-50"
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
    className="min-h-[44px] rounded-[7px] border border-[#25b8d3]/40 bg-[#0f1d2a] px-3 text-sm font-semibold text-[#8be5f2] transition hover:bg-[#1a2836]"
  >
    {detailActionLabel(item)}
  </button>;

  const telemetry = [
    {
      label: 'คำขอรออนุมัติ',
      value: summaryAvailable ? String(summary.total) : null,
      loading,
      note: 'คำขอรอการอนุมัติตามสิทธิ์ ' + roleDisplayName(role),
      tone: 'text-[#f59e0b]'
    }
  ];

  return <section
    className="nexus-approval-center -m-4 min-h-[calc(100vh-80px)] overflow-x-hidden bg-[#020813] p-4 font-['Plus_Jakarta_Sans'] text-slate-200 sm:-m-5 sm:p-5 lg:-m-6 lg:p-6"
    aria-label="ศูนย์อนุมัติคำขอ"
  >
    <div className="mx-auto grid w-full max-w-[1540px] gap-4">
      <header className="rounded-[8px] border border-[#25b8d3]/25 bg-[#061421] p-4 shadow-[0_0_28px_rgba(37,184,211,0.06)] sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="mb-2 font-mono text-[11px] font-semibold tracking-[0.14em] text-[#25b8d3]">
              ศูนย์อนุมัติ
            </p>
            <h1 className="font-['Kanit'] text-2xl font-semibold tracking-[-0.02em] text-white sm:text-[30px]">
              ศูนย์อนุมัติคำขอ
            </h1>
            <p className="mt-1 max-w-3xl font-['Kanit'] text-sm text-slate-400">
              ดูและดำเนินการกับคำขอที่รออนุมัติตามสิทธิ์ของคุณ
            </p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void loadQueue()}
            className="inline-flex min-h-[42px] items-center justify-center gap-2 self-start rounded-[7px] border border-[#25b8d3]/30 bg-[#0f1d2a] px-3 text-sm font-semibold text-[#8be5f2] transition hover:bg-[#1a2836] disabled:opacity-50"
          >
            <SmsIcon name="refresh" size={16} />รีเฟรชข้อมูล
          </button>
        </div>
      </header>

      {error && <div className="rounded-[8px] border border-[#ef4444]/45 bg-[#ef4444]/10 px-4 py-3 text-sm text-[#fecaca]">
        <RequestErrorContent error={error} />
      </div>}
      {notice && <div className="rounded-[8px] border border-[#10b981]/40 bg-[#10b981]/10 px-4 py-3 text-sm text-[#a7f3d0]">
        {notice}
      </div>}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {telemetry.filter((metric) => metric.loading || metric.value !== null).map((metric) => <article
          key={metric.label}
          className="nexus-telemetry-card min-w-0 rounded-[8px] border border-[#25b8d3]/20 bg-[#061421] p-3 sm:p-4"
        >
          <span className="block font-mono text-[10px] font-semibold tracking-[0.08em] text-slate-500">
            {metric.label}
          </span>
          <strong className={'mt-2 block break-words font-mono text-lg font-bold sm:text-2xl ' + metric.tone}>
            {metric.loading ? <span className="block h-7 w-24 animate-pulse rounded bg-slate-700/70" aria-label="กำลังโหลด" /> : metric.value}
          </strong>
          <small className="mt-1 block font-['Kanit'] text-[11px] leading-4 text-slate-500">
            {metric.note}
          </small>
        </article>)}
      </div>

      <section className="rounded-[8px] border border-[#25b8d3]/20 bg-[#061421] p-3">
        <div className="grid gap-3 xl:grid-cols-[1fr_auto] xl:items-center">
          <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="ตัวกรองประเภทคำขอ">
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
              className={'min-h-[38px] rounded-[7px] border px-3 font-["Kanit"] text-xs transition ' + (
                filter === id
                  ? 'border-[#25b8d3]/60 bg-[#253545] text-[#8be5f2]'
                  : 'border-[#25b8d3]/15 bg-[#0f1d2a] text-slate-400 hover:bg-[#1a2836] hover:text-slate-200'
              )}
            >
              {label} <b className="ml-1 font-mono">{count}</b>
            </button>)}
          </div>

          <div className="flex gap-2" role="group" aria-label="ตัวกรองระดับความเร่งด่วน">
            {([
              ['URGENT', 'ด่วนที่สุด (Urgent)'],
              ['STANDARD', 'ปกติ (Standard)']
            ] as Array<[Exclude<UrgencyFilter, 'ALL'>, string]>).map(([id, label]) => <button
              type="button"
              key={id}
              aria-pressed={urgencyFilter === id}
              onClick={() => setUrgencyFilter((current) => current === id ? 'ALL' : id)}
              className={'min-h-[38px] rounded-[7px] border px-3 font-["Kanit"] text-xs transition ' + (
                urgencyFilter === id
                  ? (id === 'URGENT'
                    ? 'border-[#f59e0b]/60 bg-[#f59e0b]/10 text-[#f59e0b]'
                    : 'border-[#25b8d3]/50 bg-[#253545] text-[#8be5f2]')
                  : 'border-[#25b8d3]/15 bg-[#0f1d2a] text-slate-400 hover:bg-[#1a2836]'
              )}
            >
              {label}
            </button>)}
          </div>
        </div>
      </section>

      <div className="min-w-0">
        <section className="min-w-0 rounded-[8px] border border-[#25b8d3]/25 bg-[#020f1c]">
          <header className="flex items-center justify-between gap-3 border-b border-[#25b8d3]/15 bg-[#061421] px-4 py-3">
            <div>
              <p className="font-mono text-[10px] tracking-[0.12em] text-[#25b8d3]">APPROVAL ACTION QUEUE</p>
              <h2 className="mt-1 font-['Kanit'] text-lg font-semibold text-white">งานที่รอฉันดำเนินการ</h2>
            </div>
            <span className="rounded-[6px] border border-[#f59e0b]/35 bg-[#f59e0b]/10 px-2 py-1 font-mono text-xs font-bold text-[#f59e0b]">
              {summaryAvailable ? `${visible.length} จาก ${summary.total} รายการ` : 'กำลังโหลด'}
            </span>
          </header>

          <div className="hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] border-collapse text-left">
                <thead className="bg-[#0f1d2a] font-mono text-[10px] uppercase tracking-[0.08em] text-slate-500">
                  <tr>
                    <th className="px-3 py-3 font-semibold">ผู้ส่งคำขอ / ผู้ปฏิบัติงาน</th>
                    <th className="px-3 py-3 font-semibold">ประเภทและอายุคิว</th>
                    <th className="px-3 py-3 font-semibold">ส่งเมื่อ</th>
                    <th className="px-3 py-3 font-semibold">สรุปรายการ</th>
                    <th className="px-3 py-3 text-right font-semibold">รายละเอียด / ดำเนินการ</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? <tr>
                    <td colSpan={5} className="px-4 py-12 text-center font-['Kanit'] text-sm text-slate-500">
                      กำลังโหลดคิวอนุมัติ…
                    </td>
                  </tr> : visible.length ? visible.map((item) => {
                    const active = selected?.id === item.id;

                    return <tr
                      key={item.id}
                      className={'border-t border-[#25b8d3]/10 align-top transition ' + (
                        active ? 'bg-[#253545]/55' : 'bg-[#020f1c] hover:bg-[#1a2836]/70'
                      )}
                    >
                      <td className="px-3 py-3">
                        <button
                          type="button"
                          aria-pressed={selected?.id === item.id}
                          onClick={() => setSelectedId(item.id)}
                          className="nexus-approval-select flex min-w-0 items-start gap-3 text-left"
                        >
                          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[7px] border border-[#25b8d3]/25 bg-[#0f1d2a] text-[#8be5f2]" aria-hidden="true">
                            <SmsIcon name="users" size={17} />
                          </span>
                          <span className="min-w-0">
                            <strong className="block font-['Kanit'] text-sm font-medium text-slate-100">
                              {employeeName(item)}
                            </strong>
                            <small className="block font-['Kanit'] text-[11px] text-slate-500">
                              ผู้ส่ง: {senderName(item)}
                            </small>
                            <small className="block font-['Kanit'] text-[11px] text-slate-500">
                              {item.requestedBy?.role ? senderRoleName(item.requestedBy.role) : item.employee?.jobTitle || item.employee?.department || 'คำขออนุมัติ'}
                            </small>
                          </span>
                        </button>
                      </td>
                      <td className="px-3 py-3">
                        <div className="font-['Kanit'] text-xs text-slate-300">{typeLabel[item.type]}</div>
                        <span className={'mt-2 inline-flex rounded-[6px] border px-2 py-1 font-mono text-[9px] font-bold ' + urgencyTone(item)}>
                          {urgencyText(item)}
                        </span>
                        <small className="mt-2 block font-['Kanit'] text-xs text-slate-400">รอมา {pendingAge(item.ageHours)}</small>
                      </td>
                      <td className="max-w-[180px] px-3 py-3 font-mono text-[11px] leading-5 text-slate-400">
                        {fmt(item.submittedAt)}
                      </td>
                      <td className="max-w-[220px] px-3 py-3 font-['Kanit'] text-xs leading-5 text-slate-400">
                        {itemSummary(item)}
                      </td>
                      <td className="px-3 py-3"><div className="grid justify-end gap-2">{renderDetailButton(item)}{renderActionButtons(item)}</div></td>
                    </tr>;
                  }) : <tr>
                    <td colSpan={5} className="px-4 py-12 text-center">
                      <SmsIcon name="check" size={28} className="mx-auto text-[#10b981]" />
                      <strong className="mt-2 block font-['Kanit'] text-sm text-slate-200">ไม่มีคำขอในตัวกรองนี้</strong>
                      <span className="mt-1 block font-['Kanit'] text-xs text-slate-500">
                        ระบบจะแสดงเฉพาะข้อมูลจริงจาก Approval API เดิม
                      </span>
                    </td>
                  </tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="grid gap-3 p-3 md:hidden">
            {loading ? <div className="py-10 text-center font-['Kanit'] text-sm text-slate-500">
              กำลังโหลดคิวอนุมัติ…
            </div> : visible.length ? visible.map((item) => <article
              key={item.id}
              className={'min-w-0 rounded-[8px] border p-3 ' + (
                selected?.id === item.id
                  ? 'border-[#25b8d3]/55 bg-[#253545]/55'
                  : 'border-[#25b8d3]/18 bg-[#061421]'
              )}
            >
              <button
                type="button"
                aria-pressed={selected?.id === item.id}
                onClick={() => setSelectedId(item.id)}
                className="nexus-approval-select w-full text-left"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[7px] border border-[#25b8d3]/25 bg-[#0f1d2a] text-[#8be5f2]" aria-hidden="true">
                    <SmsIcon name="users" size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <strong className="block font-['Kanit'] text-base font-medium text-white">{employeeName(item)}</strong>
                    <small className="block font-['Kanit'] text-xs text-slate-400">ผู้ส่ง: {senderName(item)}</small>
                    <small className="block font-['Kanit'] text-xs text-slate-500">{typeLabel[item.type]}</small>
                  </span>
                  <span className={'shrink-0 rounded-[6px] border px-2 py-1 font-mono text-[9px] font-bold ' + urgencyTone(item)}>
                    {item.urgency === 'NEW' ? 'ปกติ' : 'เร่งด่วน'}
                  </span>
                </div>

                <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="min-w-0 rounded-[6px] bg-[#0f1d2a] p-2">
                    <dt className="font-mono text-[9px] text-slate-600">ส่งเมื่อ</dt>
                    <dd className="mt-1 font-mono text-slate-400">{fmt(item.submittedAt)}</dd>
                  </div>
                  <div className="min-w-0 rounded-[6px] bg-[#0f1d2a] p-2">
                    <dt className="font-mono text-[9px] text-slate-600">อายุคิว</dt>
                    <dd className="mt-1 font-['Kanit'] text-slate-400">{pendingAge(item.ageHours)}</dd>
                  </div>
                  <div className="col-span-2 min-w-0 rounded-[6px] bg-[#0f1d2a] p-2">
                    <dt className="font-mono text-[9px] text-slate-600">สรุปรายการ</dt>
                    <dd className="mt-1 break-words font-['Kanit'] text-slate-400">{itemSummary(item)}</dd>
                  </div>
                </dl>
              </button>
              <div className="mt-3 grid gap-2">{renderDetailButton(item)}{renderActionButtons(item, true)}</div>
            </article>) : <div className="py-10 text-center">
              <SmsIcon name="check" size={30} className="mx-auto text-[#10b981]" />
              <strong className="mt-2 block font-['Kanit'] text-sm text-slate-200">ไม่มีคำขอในตัวกรองนี้</strong>
            </div>}
          </div>
        </section>
      </div>

      {summary.truncated && <p className="font-['Kanit'] text-xs text-[#f59e0b]">
        คิวมีรายการมากกว่าจำนวนที่โหลดจาก API (limit 100) — ระบบไม่ได้ซ่อนจำนวนรวมใน Telemetry
      </p>}

      <div className="sr-only" aria-live="polite">
        {selectedLeaveIsSelf
          ? 'คำขอลาที่เลือกเป็นคำขอของผู้ใช้ปัจจุบัน'
          : ''}
      </div>
    </div>

    {rejecting && <div
      className="nexus-reject-modal fixed inset-0 z-[120] grid place-items-center bg-[#020813]/90 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="ยืนยันการปฏิเสธคำขอ"
    >
      <section className="w-full max-w-[480px] rounded-[8px] border border-[#ef4444]/45 bg-[#061421] p-4 shadow-2xl">
        <p className="font-mono text-[10px] tracking-[0.12em] text-[#ef4444]">REJECT REQUEST</p>
        <h2 className="mt-2 font-['Kanit'] text-xl font-semibold text-white">{employeeName(rejecting)}</h2>
        <label className="mt-4 grid gap-2 font-['Kanit'] text-sm text-slate-400">
          เหตุผลการปฏิเสธ
          <textarea
            autoFocus
            rows={4}
            value={rejectReason}
            onChange={(event) => setRejectReason(event.target.value)}
            className="w-full resize-none rounded-[7px] border border-[#25b8d3]/25 bg-[#0f1d2a] p-3 text-sm text-slate-100 outline-none placeholder:text-slate-600 focus:border-[#25b8d3]/60"
            placeholder="ระบุเหตุผลอย่างน้อย 3 ตัวอักษร"
          />
        </label>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => { setRejecting(undefined); setRejectReason(''); }}
            className="min-h-[44px] rounded-[7px] border border-[#25b8d3]/20 bg-[#0f1d2a] font-['Kanit'] text-sm text-slate-300 hover:bg-[#1a2836]"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            disabled={Boolean(busyAction)}
            onClick={() => void confirmReject()}
            className="min-h-[44px] rounded-[7px] border border-[#ef4444]/60 bg-[#ef4444]/15 font-['Kanit'] text-sm font-semibold text-[#fecaca] hover:bg-[#ef4444]/25 disabled:opacity-50"
          >
            {busyAction ? 'กำลังดำเนินการ…' : 'ยืนยันปฏิเสธ'}
          </button>
        </div>
      </section>
    </div>}
  </section>;
}
