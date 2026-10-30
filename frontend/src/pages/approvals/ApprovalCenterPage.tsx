import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { getApprovalCenter, getApprovalCenterItem, getApprovalCenterSummary } from '../../approval-center-client';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { SmsIcon } from '../../components/SmsIcon';
import { roleDisplayName } from '../../role-display';
import { formatThaiDate, formatThaiDateTime } from '../../thai-date-time';
import { updateRouteQuery } from '../../routing';
import type { LeaveDecisionAction } from '../../components/LeaveDecisionConfirmation';
import { approveAttendanceAdjustment, rejectAttendanceAdjustment, reviewAttendanceAdjustment, returnAttendanceAdjustment } from '../attendance-supervisor/attendance-adjustment-client';
import { attendanceDeviceSelfieWithTimestamp } from '../attendance/attendance-client';
import '../../styles/approval-center.css';
import { MetricCard, PageHeader, SectionCard } from '../../components/layout';
import { useActionDialog } from '../../components/useActionDialog';

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
type ApprovalSourcePage = 'employees' | 'licenses' | 'schedule' | 'approvals' | 'attendanceDevice' | 'attendanceSupervisor' | 'users' | 'leavePending';
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
  onSummaryLoaded?(summary: unknown): void;
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

/* What actually happens after approval, shown before the decision (audit AC-01 / AC-02). */
const approveConsequence: Partial<Record<ApprovalType, string>> = {
  EMPLOYEE_REFERENCE_PHOTO: 'รูปนี้จะใช้เป็นรูปอ้างอิงของพนักงานในการลงเวลา',
  LICENSE_DOCUMENT: 'ข้อมูลใบอนุญาตตามเอกสารนี้จะมีผลกับการตรวจสิทธิ์ตอนจัดกะ',
  ATTENDANCE_DEVICE_REQUEST: 'อุปกรณ์นี้จะใช้ลงเวลาได้ และเครื่องหลักเดิมของพนักงานจะถูกแทน',
  ATTENDANCE_ADJUSTMENT_REQUEST: 'เวลาที่ขอจะมีผลเป็นเวลาลงงาน โดยบันทึกเดิมยังเก็บไว้ตรวจย้อนหลังได้',
  REGISTRATION_REQUEST: 'บัญชีนี้จะเข้าสู่ระบบได้ตามบทบาทเริ่มต้น',
  USER_ACCESS: 'บัญชีนี้จะเปลี่ยนเป็นใช้งานได้และเข้าสู่ระบบได้ทันที'
};

const panelConsequence: Partial<Record<ApprovalType, string>> = {
  ...approveConsequence,
  LEAVE_REQUEST: 'วันลาจะลง AL แทนกะเดิมในช่วงที่ลา และไม่ทำให้ตารางกะที่อนุมัติแล้วต้องอนุมัติใหม่'
};

/* Facts shown in the decision panel — only fields the Approval API already returns (audit AC-03 / W-02). */
function panelFacts(item: ApprovalCenterItem): Array<[string, unknown]> {
  const facts: Array<[string, unknown]> = [];
  if (item.type === 'LEAVE_REQUEST') {
    facts.push(['ประเภทการลา', meta(item, 'leaveType')]);
    facts.push(['วันที่ลา', meta(item, 'startDate') && meta(item, 'endDate') ? `${displayLeaveDate(meta(item, 'startDate'))} – ${displayLeaveDate(meta(item, 'endDate'))}` : meta(item, 'startDate') ? displayLeaveDate(meta(item, 'startDate')) : null]);
    facts.push(['จำนวนวัน', meta(item, 'dayCount') ? `${text(meta(item, 'dayCount'))} วัน` : null]);
    facts.push(['ผู้ปฏิบัติแทน', meta(item, 'substitute')]);
  } else if (item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST') {
    facts.push(['วันที่ทำงาน', displayLeaveDate(meta(item, 'workDate'))]);
    facts.push(['ประเภทคำขอ', String(meta(item, 'requestType') || '') === 'ADJUST_WORK_TIME' ? 'แก้ไขเวลาเข้างาน / ออกงาน' : 'ยืนยันการมาปฏิบัติงาน']);
    facts.push(['ฉบับคำขอ', meta(item, 'revision') ? `ฉบับที่ ${text(meta(item, 'revision'))}` : null]);
    const time = (value: unknown) => value ? formatThaiDateTime(String(value), { hour: '2-digit', minute: '2-digit' }).split(' ').pop() : '—';
    facts.push(['เวลาเข้างาน', `${time(meta(item, 'originalCheckInAt'))} → ${time(meta(item, 'proposedCheckInAt'))}`]);
    facts.push(['เวลาออกงาน', `${time(meta(item, 'originalCheckOutAt'))} → ${time(meta(item, 'proposedCheckOutAt'))}`]);
  } else if (item.type === 'ATTENDANCE_DEVICE_REQUEST') {
    facts.push(['อุปกรณ์', meta(item, 'deviceName')]);
  } else if (item.type === 'LICENSE_DOCUMENT') {
    facts.push(['ประเภทใบอนุญาต', meta(item, 'licenseType')]);
    facts.push(['ไฟล์', meta(item, 'fileName')]);
  } else if (item.type === 'REGISTRATION_REQUEST') {
    facts.push(['พนักงานที่ตรงกัน', meta(item, 'matchedEmployeeName')]);
    facts.push(['จุดปฏิบัติงานที่แจ้ง', meta(item, 'departmentHint')]);
  } else if (item.type === 'USER_ACCESS') {
    facts.push(['จุดปฏิบัติงาน', meta(item, 'department')]);
  } else if (item.type === 'EMPLOYEE_REFERENCE_PHOTO') {
    facts.push(['ไฟล์', item.photo?.fileName]);
  }
  facts.push(['ผู้ส่ง', senderName(item)]);
  facts.push(['ส่งเมื่อ', item.submittedAt ? fmt(item.submittedAt) : null]);
  facts.push(['รอมาแล้ว', pendingAge(item.ageHours)]);
  if (item.type !== 'LEAVE_REQUEST' || meta(item, 'reason')) facts.push(['เหตุผล', meta(item, 'reason')]);
  return facts.filter(([, value]) => value !== undefined && value !== null && value !== '');
}

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
      ? `${displayLeaveDate(meta(item, 'startDate'))} – ${displayLeaveDate(meta(item, 'endDate'))}`
      : displayLeaveDate(meta(item, 'startDate')));
    values.push(meta(item, 'dayCount') ? `${text(meta(item, 'dayCount'))} วัน` : null);
  } else if (item.type === 'SCHEDULE_APPROVAL') {
    values.push(item.title);
  } else if (item.type === 'REGISTRATION_REQUEST') {
    values.push(meta(item, 'matchedEmployeeName') || meta(item, 'departmentHint'));
  } else if (item.type === 'ATTENDANCE_DEVICE_REQUEST') {
    values.push(meta(item, 'deviceName'));
    values.push(meta(item, 'reason'));
  } else if (item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST') {
    values.push(displayLeaveDate(meta(item, 'workDate')));
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

function displayLeaveDate(value: unknown): string {
  const raw = String(value || '');
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(raw)?.[1];
  if (!day) return text(value);
  try {
    return formatThaiDate(`${day}T00:00:00.000Z`, { timeZone: 'UTC' });
  } catch {
    return text(value);
  }
}

const queryTypeForFilter = (value: CategoryFilter): string | undefined => {
  if (value === 'ALL') return undefined;
  if (value === 'SCHEDULE_APPROVAL') return 'SCHEDULE';
  if (value === 'LEAVE_REQUEST') return 'LEAVE';
  if (value === 'ATTENDANCE_DEVICE_REQUEST') return 'DEVICE';
  if (value === 'LICENSE_DOCUMENT') return 'LICENSE';
  return value;
};

const filterForQueryType = (value: string | null): CategoryFilter => {
  if (value === 'SCHEDULE') return 'SCHEDULE_APPROVAL';
  if (value === 'LEAVE') return 'LEAVE_REQUEST';
  if (value === 'DEVICE') return 'ATTENDANCE_DEVICE_REQUEST';
  if (value === 'LICENSE') return 'LICENSE_DOCUMENT';
  return value && approvalTypeOrder.includes(value as ApprovalType) ? value as ApprovalType : 'ALL';
};

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
  onSummaryLoaded,
  onOpenEmployeeChange,
  onNavigate,
  onLeaveDecision
}: Props) {
  const [items, setItems] = useState<ApprovalCenterItem[]>([]);
  const [summary, setSummary] = useState<Summary>({ total: 0, byType: {} });
  const [summaryAvailable, setSummaryAvailable] = useState(false);
  const [filter, setFilter] = useState<CategoryFilter>(() => filterForQueryType(new URLSearchParams(window.location.search).get('type')));
  const [urgencyFilter, setUrgencyFilter] = useState<UrgencyFilter>('ALL');
  const [selectedId, setSelectedId] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<{ id: string; action: 'approve' | 'reject' | 'return' }>();
  const [rejectMode, setRejectMode] = useState<'reject' | 'return'>('reject');
  const actionDialog = useActionDialog();
  const [error, setError] = useState<RequestErrorInput>();
  const [notice, setNotice] = useState('');
  const [detailState, setDetailState] = useState<{ status: 'loading' | 'not-found' | 'forbidden' | 'error'; message: string }>();
  const [detailKey, setDetailKey] = useState<string>();
  const detailGeneration = useRef(0);
  const detailInFlight = useRef<string | null>(null);
  const [rejecting, setRejecting] = useState<ApprovalCenterItem>();
  const [rejectReason, setRejectReason] = useState('');

  const loadQueue = async (forceRefresh = false) => {
    setLoading(true);
    setSummaryAvailable(false);
    setError(undefined);

    try {
      const [result, authoritativeSummary] = await Promise.all([
        getApprovalCenter(token, { forceRefresh }),
        getApprovalCenterSummary(token, { forceRefresh })
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
      onSummaryLoaded?.(authoritativeSummary?.summary);
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
  const [decisionId, setDecisionId] = useState('');
  const [deviceSelfie, setDeviceSelfie] = useState<{ id?: string; url?: string; capturedAt?: string | null; loading?: boolean; error?: string }>({});
  const selfieGeneration = useRef(0);

  useEffect(() => () => {
    if (deviceSelfie.url) URL.revokeObjectURL(deviceSelfie.url);
  }, [deviceSelfie.url]);

  useEffect(() => () => { selfieGeneration.current += 1; }, [token]);

  useEffect(() => {
    setDeviceSelfie({});
  }, [decisionId, token]);

  const toggleDeviceSelfie = async (item: ApprovalCenterItem) => {
    if (deviceSelfie.url) {
      selfieGeneration.current += 1;
      setDeviceSelfie({});
      return;
    }
    const employeeId = String(meta(item, 'employeeId') || item.employee?.id || '');
    const deviceId = String(meta(item, 'candidateDeviceId') || '');
    if (!employeeId || !deviceId) {
      setDeviceSelfie({ id: item.id, error: 'ไม่พบรหัสอุปกรณ์หรือพนักงานสำหรับดึงรูปเซลฟี่' });
      return;
    }
    const generation = ++selfieGeneration.current;
    setDeviceSelfie({ id: item.id, loading: true });
    try {
      const { blob, capturedAt } = await attendanceDeviceSelfieWithTimestamp(token, employeeId, deviceId);
      if (generation !== selfieGeneration.current) return;
      setDeviceSelfie({ id: item.id, url: URL.createObjectURL(blob), capturedAt });
    } catch {
      if (generation !== selfieGeneration.current) return;
      setDeviceSelfie({ id: item.id, error: 'ไม่มีรูปเซลฟี่จากการลงเวลา หรือดึงรูปไม่สำเร็จ' });
    }
  };
  const decision = items.find((item) => item.id === decisionId);
  const visibleSelfie = deviceSelfie.id === decisionId ? deviceSelfie : {};
  const decisionPanelRef = useRef<HTMLElement>(null);
  useEffect(() => { if (decisionId) decisionPanelRef.current?.focus(); }, [decisionId]);
  const changeDecision = (id: string) => {
    selfieGeneration.current += 1;
    setDecisionId(id);
    setDeviceSelfie({});
  };
  const openDecision = (item: ApprovalCenterItem) => { setSelectedId(item.id); changeDecision(item.id); };

  useEffect(() => {
    if (selected?.type !== 'SCHEDULE_APPROVAL') return;
    const panel = document.querySelector<HTMLElement>('.approval-schedule-detail');
    if (panel && typeof panel.scrollIntoView === 'function') panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    panel?.focus({ preventScroll: true });
  }, [selected?.id, selected?.type]);

  const selectedLeaveIsSelf = selected?.type === 'LEAVE_REQUEST'
    && Boolean(currentEmployeeId)
    && selected.employee?.id === currentEmployeeId;


  const executeDirectDecision = async (
    item: ApprovalCenterItem,
    action: 'approve' | 'reject' | 'return',
    reason = ''
  ) => {
    if (item.type === 'EMPLOYEE_MASTER_CHANGE') {
      onOpenEmployeeChange(item.requestId);
      return;
    }

    if (item.type === 'SCHEDULE_APPROVAL') {
      onNavigate(item);
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
        const isForwardStage = item.status === 'PENDING_SUPERVISOR' || item.status === 'PENDING_MANAGER';
        if (action === 'approve') {
          if (isForwardStage) {
            await reviewAttendanceAdjustment(token, item.requestId, item.status === 'PENDING_SUPERVISOR' ? 'หัวหน้างานส่งต่อให้ผู้จัดการ' : 'ผู้จัดการส่งต่อให้ Admin');
            setNotice(item.status === 'PENDING_SUPERVISOR' ? 'ส่งต่อให้ผู้จัดการพิจารณาแล้ว และอัปเดตคิวแล้ว' : 'ส่งต่อให้ผู้ดูแลระบบอนุมัติแล้ว และอัปเดตคิวแล้ว');
          } else {
            await approveAttendanceAdjustment(token, item.requestId);
            setNotice('อนุมัติคำขอสำเร็จ และอัปเดตคิวแล้ว');
          }
        } else if (action === 'return' || isForwardStage) {
          await returnAttendanceAdjustment(token, item.requestId, reason || 'ส่งกลับให้แก้ไข');
          setNotice('ส่งคำขอกลับไปแก้ไขแล้ว และอัปเดตคิวแล้ว');
        } else {
          await rejectAttendanceAdjustment(token, item.requestId, reason);
          setNotice('ปฏิเสธคำขอสำเร็จ และอัปเดตคิวแล้ว');
        }
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
      await loadQueue(true);
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

  const requestReject = (item: ApprovalCenterItem, mode: 'reject' | 'return' = 'reject') => {
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
    setRejectMode(mode);
  };

  const confirmReject = async () => {
    if (!rejecting) return;
    const isReturn = rejectMode === 'return' || (rejecting.type === 'ATTENDANCE_ADJUSTMENT_REQUEST' && (rejecting.status === 'PENDING_SUPERVISOR' || rejecting.status === 'PENDING_MANAGER'));
    const minimumLength = rejecting.type === 'SCHEDULE_APPROVAL' ? 5 : 3;
    if (rejectReason.trim().length < minimumLength) {
      setError(`กรุณาระบุเหตุผลอย่างน้อย ${minimumLength} ตัวอักษร`);
      return;
    }

    await executeDirectDecision(rejecting, isReturn ? 'return' : 'reject', rejectReason.trim());
  };

  const confirmApprove = async (item: ApprovalCenterItem) => {
    if (item.type === 'LEAVE_REQUEST' || item.type === 'EMPLOYEE_MASTER_CHANGE' || item.type === 'SCHEDULE_APPROVAL') {
      await executeDirectDecision(item, 'approve');
      return;
    }
    const isForwardStage = item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST' && (item.status === 'PENDING_SUPERVISOR' || item.status === 'PENDING_MANAGER');
    const confirmed = await actionDialog.confirm({
      eyebrow: typeLabel[item.type],
      title: isForwardStage
        ? (item.status === 'PENDING_SUPERVISOR' ? 'ส่งต่อให้ผู้จัดการพิจารณา?' : 'ส่งต่อให้ผู้ดูแลระบบอนุมัติ?')
        : `อนุมัติ${typeLabel[item.type]}?`,
      message: isForwardStage
        ? (item.status === 'PENDING_SUPERVISOR' ? 'คำขอแก้ไขเวลานี้จะถูกส่งต่อไปยังขั้นตอนของผู้จัดการ' : 'คำขอแก้ไขเวลานี้จะถูกส่งต่อไปยังขั้นตอนของผู้ดูแลระบบเพื่ออนุมัติขั้นสุดท้าย')
        : (approveConsequence[item.type] || 'คำขอนี้จะถูกอนุมัติตามสิทธิ์ของคุณ'),
      context: employeeName(item),
      confirmLabel: isForwardStage ? 'ยืนยันส่งต่อ' : 'ยืนยันอนุมัติ',
      cancelLabel: 'ยกเลิก',
      tone: 'primary'
    });
    if (confirmed) await executeDirectDecision(item, 'approve');
  };

  const renderActionButtons = (item: ApprovalCenterItem, mobile = false) => {
    const busy = busyAction?.id === item.id;
    const selfLeave = item.type === 'LEAVE_REQUEST'
      && Boolean(currentEmployeeId)
      && item.employee?.id === currentEmployeeId;

    if (item.type === 'EMPLOYEE_MASTER_CHANGE') return null;
    if (item.type === 'SCHEDULE_APPROVAL') return null;

    if (selfLeave) {
    return <span className="approval-self-leave">
        ห้ามอนุมัติใบลาของตนเอง
      </span>;
    }

    const isAdjustment = item.type === 'ATTENDANCE_ADJUSTMENT_REQUEST';
    const isForwardStage = isAdjustment && (item.status === 'PENDING_SUPERVISOR' || item.status === 'PENDING_MANAGER');
    const approveLabel = isForwardStage
      ? (item.status === 'PENDING_SUPERVISOR' ? 'ส่งต่อให้ผู้จัดการ' : 'ส่งต่อให้ Admin')
      : 'อนุมัติ…';
    const approveBusyLabel = isForwardStage ? 'กำลังส่งต่อ…' : 'กำลังอนุมัติ…';

    return <div className={`approval-action-buttons${mobile ? ' approval-action-buttons--mobile' : ''}`}>
      <button
        type="button"
        disabled={busy}
        onClick={() => requestReject(item, isForwardStage ? 'return' : 'reject')}
        className="approval-action-button approval-action-button--reject"
      >
        {busy && busyAction?.action === (isForwardStage ? 'return' : 'reject') ? (isForwardStage ? 'กำลังส่งกลับ…' : 'กำลังปฏิเสธ…') : (isForwardStage ? 'ส่งกลับแก้ไข' : 'ปฏิเสธ')}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void confirmApprove(item)}
        className="approval-action-button approval-action-button--approve"
      >
        {busy && busyAction?.action === 'approve' ? approveBusyLabel : approveLabel}
      </button>
      {item.type === 'LEAVE_REQUEST' && <button
        type="button"
        disabled={busy}
        onClick={() => onLeaveDecision(item, 'return')}
        className="approval-action-button approval-action-button--return"
      >ส่งกลับไปแก้ไข</button>}
      {isAdjustment && !isForwardStage && <button
        type="button"
        disabled={busy}
        onClick={() => requestReject(item, 'return')}
        className="approval-action-button approval-action-button--return"
      >ส่งกลับไปแก้ไข</button>}
    </div>;
  };

  /* Rows never decide directly: they open the decision panel so the facts are seen first (W-02 · AC-03). */
  const renderReviewButton = (item: ApprovalCenterItem, mobile = false) => {
    const actions = renderActionButtons(item, mobile);
    if (!actions) return null;
    if (item.type === 'LEAVE_REQUEST' && Boolean(currentEmployeeId) && item.employee?.id === currentEmployeeId) return actions;
    return <button
      type="button"
      className="approval-action-button approval-action-button--review"
      aria-expanded={decisionId === item.id}
      onClick={() => openDecision(item)}
    >พิจารณา</button>;
  };

  const openDetails = async (item: ApprovalCenterItem) => {
    const key = `${item.type}:${String(item.requestId)}`;
    if (detailInFlight.current === key) return;
    detailInFlight.current = key;
    const generation = ++detailGeneration.current;
    setDetailKey(key);
    setDetailState({ status: 'loading', message: 'กำลังโหลดรายละเอียดคำขอ…' });
    try {
      const result = await getApprovalCenterItem(token, item.type, item.requestId);
      if (generation !== detailGeneration.current) return;
      const detail = (Array.isArray(result?.data) ? result.data[0] : result?.data || result) as ApprovalCenterItem;
      if (!detail || detail.type !== item.type || String(detail.requestId) !== String(item.requestId)) {
        setDetailState({ status: 'not-found', message: 'ไม่พบคำขอที่มีสิทธิ์เปิดรายละเอียด' });
        return;
      }
      setDetailState(undefined);
      if (detail.type === 'EMPLOYEE_MASTER_CHANGE') {
        onOpenEmployeeChange(detail.requestId);
        return;
      }
      if (detail.type === 'SCHEDULE_APPROVAL') {
        onNavigate(detail);
        return;
      }
      onNavigate(detail);
    } catch (cause) {
      if (generation !== detailGeneration.current) return;
      const status = typeof cause === 'object' && cause !== null && 'status' in cause ? Number((cause as { status?: unknown }).status) : 0;
      const next = status === 404
        ? { status: 'not-found' as const, message: 'ไม่พบคำขอที่ต้องการเปิดรายละเอียด (404)' }
        : status === 403
          ? { status: 'forbidden' as const, message: 'คุณไม่มีสิทธิ์ดูรายละเอียดคำขอนี้ (403)' }
          : { status: 'error' as const, message: 'โหลดรายละเอียดคำขอไม่สำเร็จ กรุณาลองใหม่ (โหลดผิดพลาด)' };
      setDetailState(next);
    } finally {
      if (detailInFlight.current === key) detailInFlight.current = null;
    }
  };

  const renderDetailButton = (item: ApprovalCenterItem, className = '') => <button
    type="button"
    disabled={detailState?.status === 'loading' && detailKey === `${item.type}:${String(item.requestId)}`}
    onClick={() => void openDetails(item)}
    className={`approval-detail-button ${className}`.trim()}
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
    {actionDialog.dialog}
    <div className="approval-center-content">
      <PageHeader kicker="งานที่รอการพิจารณา" title="ศูนย์อนุมัติคำขอ" description="ดูและดำเนินการกับคำขอที่รออนุมัติตามสิทธิ์ของคุณ" className="approval-center-header" actions={<button type="button" disabled={loading} onClick={() => void loadQueue(true)} className="btn-neutral small-action"><SmsIcon name="refresh" size={16} />รีเฟรชข้อมูล</button>} />

      {error && <div className="approval-center-alert approval-center-alert--error" role="alert" aria-live="assertive">
        <RequestErrorContent error={error} />
      </div>}
      {detailState?.status === 'loading' && <div className="approval-center-alert approval-center-alert--loading" role="status" aria-live="polite">
        {detailState.message}
      </div>}
      {detailState && detailState.status !== 'loading' && <div className="approval-center-alert approval-center-alert--error" role="alert" aria-live="assertive">
        {detailState.message}
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
              onClick={() => {
                setFilter(id);
                updateRouteQuery({ type: queryTypeForFilter(id) }, { replace: false });
              }}
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
                          onClick={() => openDecision(item)}
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
                      <td className="approval-queue-type-cell" title={`รอมา ${pendingAge(item.ageHours)}`}>
                        <div className="approval-type-label">{typeLabel[item.type]}</div>
                        <span className={urgencyTone(item)}>
                          {urgencyText(item)}
                        </span>
                        <small className="approval-queue-age">รอมา {pendingAge(item.ageHours)}</small>
                      </td>
                      <td className="approval-queue-submitted">
                        {fmt(item.submittedAt)}
                      </td>
                      <td className="approval-queue-summary" title={String(itemSummary(item) ?? '')}>
                        {itemSummary(item)}
                      </td>
                      <td><div className="approval-queue-row-actions">{renderDetailButton(item)}{renderReviewButton(item)}</div></td>
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
                onClick={() => openDecision(item)}
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
              <div className="approval-mobile-card-actions">{renderReviewButton(item, true)}</div>
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

      {decision && decision.type !== 'SCHEDULE_APPROVAL' && decision.type !== 'EMPLOYEE_MASTER_CHANGE' && <>
        <div className="approval-decision-backdrop" aria-hidden="true" onClick={() => changeDecision('')} />
        <aside
          className="approval-decision-panel"
          aria-labelledby="approval-decision-title"
          tabIndex={-1}
          ref={decisionPanelRef}
          onKeyDown={(event) => { if (event.key === 'Escape') changeDecision(''); }}
        >
          <header className="approval-decision-panel__head">
            <div className="approval-decision-panel__chips">
              <span className="approval-type-label">{typeLabel[decision.type]}</span>
              <span className={urgencyTone(decision)}>{urgencyText(decision)}</span>
            </div>
            <button type="button" className="approval-decision-panel__close" aria-label="ปิดแผงรายละเอียด" onClick={() => changeDecision('')}>×</button>
            <h2 id="approval-decision-title">{employeeName(decision)} · {typeLabel[decision.type]}</h2>
            {(decision.employee?.department || decision.employee?.employeeCode) && <p>{[decision.employee?.employeeCode, decision.employee?.department].filter(Boolean).join(' · ')}</p>}
          </header>
          <dl className="approval-decision-panel__facts">
            {panelFacts(decision).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{text(value)}</dd></div>)}
          </dl>
          {panelConsequence[decision.type] && <section className="approval-decision-panel__consequence" aria-label="ผลกระทบถ้าอนุมัติ">
            <strong>ถ้าอนุมัติ</strong>
            <p>{panelConsequence[decision.type]}</p>
          </section>}
          {decision.type === 'ATTENDANCE_DEVICE_REQUEST' && (
            <div className="approval-device-selfie-review" style={{ margin: '14px 0', padding: '12px 14px', background: 'var(--color-surface-muted, #f8fafc)', borderRadius: '10px', border: '1px solid var(--color-border, #e2e8f0)' }}>
              <button
                type="button"
                className="btn-neutral approval-device-selfie-toggle"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', padding: '8px 14px', borderRadius: '8px', cursor: 'pointer', fontWeight: 600, width: '100%', justifyContent: 'center' }}
                disabled={visibleSelfie.loading}
                onClick={() => void toggleDeviceSelfie(decision)}
              >
                <SmsIcon name="eye" size={16} />
                {visibleSelfie.loading ? 'กำลังโหลดรูปเซลฟี่…' : visibleSelfie.url ? 'ซ่อนรูปเซลฟี่' : 'ดูรูปเซลฟี่จากการลงเวลา'}
              </button>
              {visibleSelfie.url && (
                <div className="approval-device-selfie-preview" style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                  <img
                    src={visibleSelfie.url}
                    alt={`รูปเซลฟี่จากการลงเวลาของ ${employeeName(decision)}`}
                    style={{ maxWidth: '100%', maxHeight: '240px', borderRadius: '8px', border: '1px solid var(--color-border, #cbd5e1)', objectFit: 'contain' }}
                  />
                  <small style={{ color: 'var(--color-text-muted, #64748b)', fontSize: '11px', textAlign: 'center' }}>รูปเซลฟี่จากการลงเวลา ไม่ใช่รูปแนบคำขอ</small>
                  <small>{visibleSelfie.capturedAt ? `เวลาลงเวลาที่บันทึกพร้อมรูป: ${new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', dateStyle: 'medium', timeStyle: 'short' }).format(new Date(visibleSelfie.capturedAt))} (เวลาไทย)` : 'ไม่พบเวลาบันทึกรูปเซลฟี่'}</small>
                </div>
              )}
              {visibleSelfie.error && (
                <div style={{ marginTop: '8px', color: 'var(--color-danger, #ef4444)', fontSize: '12px', textAlign: 'center' }}>
                  {visibleSelfie.error}
                </div>
              )}
            </div>
          )}
          <footer className="approval-decision-panel__actions">
            {renderActionButtons(decision)}
            {renderDetailButton(decision, 'approval-decision-panel__detail')}
          </footer>
        </aside>
      </>}

      {selected?.type === 'SCHEDULE_APPROVAL' && <aside className="approval-schedule-detail" tabIndex={-1} aria-label="รายละเอียดตารางกะ">
        <div className="approval-schedule-detail__header">
          <div>
            <p className="approval-reject-kicker">SCHEDULE APPROVAL</p>
            <h2>รายละเอียดตารางกะ</h2>
          </div>
          <button type="button" className="approval-detail-button" onClick={() => setSelectedId('')}>ปิดรายละเอียด</button>
        </div>
        <dl className="approval-schedule-detail__grid">
          <div><dt>รายการ</dt><dd>{selected.title}</dd></div>
          <div><dt>ผู้ส่ง</dt><dd>{senderName(selected)}</dd></div>
          <div><dt>ฉบับที่</dt><dd>{text(selected.revision || meta(selected, 'revision'))}</dd></div>
          <div><dt>ส่งเมื่อ</dt><dd>{fmt(selected.submittedAt)}</dd></div>
          <div><dt>สถานะ</dt><dd>{text(selected.status)}</dd></div>
          <div><dt>ผลตรวจกฎ</dt><dd>{text(meta(selected, 'ruleCheckSummary') || meta(selected, 'changeType'))}</dd></div>
          <div><dt>ความเห็น</dt><dd>{text(meta(selected, 'approvalNote') || meta(selected, 'comment'))}</dd></div>
        </dl>
        <button type="button" className="btn-neutral small-action" onClick={() => onNavigate(selected)}>เปิดในหน้าตารางกะรายเดือน</button>
      </aside>}

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
        <p className="approval-reject-kicker">{rejectMode === 'return' || (rejecting.type === 'ATTENDANCE_ADJUSTMENT_REQUEST' && (rejecting.status === 'PENDING_SUPERVISOR' || rejecting.status === 'PENDING_MANAGER')) ? 'RETURN FOR CORRECTION' : 'REJECT REQUEST'}</p>
        <h2>{employeeName(rejecting)}</h2>
        <label className="approval-reject-reason">
          {rejectMode === 'return' || (rejecting.type === 'ATTENDANCE_ADJUSTMENT_REQUEST' && (rejecting.status === 'PENDING_SUPERVISOR' || rejecting.status === 'PENDING_MANAGER')) ? 'เหตุผลการส่งกลับให้แก้ไข' : 'เหตุผลการปฏิเสธ'}
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
            {busyAction ? 'กำลังดำเนินการ…' : (rejectMode === 'return' || (rejecting.type === 'ATTENDANCE_ADJUSTMENT_REQUEST' && (rejecting.status === 'PENDING_SUPERVISOR' || rejecting.status === 'PENDING_MANAGER')) ? 'ยืนยันส่งกลับแก้ไข' : 'ยืนยันปฏิเสธ')}
          </button>
        </div>
      </section>
    </div>}
  </section>;
}
