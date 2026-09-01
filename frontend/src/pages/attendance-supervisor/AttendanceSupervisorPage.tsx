
import { useEffect, useMemo, useState } from 'react';
import { api, type SecuritySite } from '../../api';
import { SmsIcon, type SmsIconName } from '../../components/SmsIcon';
import {
  attendanceSupervisorDaily,
  attendanceSupervisorHistory,
  attendanceSupervisorDetail,
  attendanceEvidenceView
} from './attendance-supervisor-client';
import {
  approveAttendanceAdjustment,
  createAttendanceAdjustment,
  listAttendanceAdjustments,
  rejectAttendanceAdjustment,
  returnAttendanceAdjustment,
  reviseAttendanceAdjustment,
  submitAttendanceAdjustment,
  type AttendanceAdjustmentRequest,
  type AttendanceAdjustmentStatus
} from './attendance-adjustment-client';
import './attendance-supervisor-v4.css';

type Props = {
  token: string;
  role: string;
  department?: string;
  userId?: string;
  onOpenAttendanceReport?: () => void;
};

type Site = { id: string; code?: string | null; name: string };
type Shift = {
  id: string;
  code?: string | null;
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
};

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
  requiresAttention: number;
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
    evidence?: {
      id: string;
      capturedAt?: string | null;
      retentionUntil?: string | null;
      purgedAt?: string | null;
    } | null;
  }>;
  governance: {
    canCreateAdjustmentRequest: boolean;
    canApproveAdjustmentRequest: boolean;
    directOverrideEnabled: boolean;
    note: string;
  };
};

type Mode = 'daily' | 'history' | 'requests';
type AdjustmentType = 'CONFIRM_WORK_PERFORMED' | 'ADJUST_WORK_TIME';
type AdjustmentDialog = {
  requestId?: string;
  assignmentId: string;
  employeeName: string;
  type: AdjustmentType;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
  returnedComment?: string | null;
};
type ReviewDialog = {
  request: AttendanceAdjustmentRequest;
  action: 'approve' | 'return' | 'reject';
  comment: string;
};

type ManualConfirmationDialog = {
  employeeId: string;
  workDate: string;
  checkInAt: string;
  checkOutAt: string;
  reason: string;
};

const STATUS_OPTIONS = [
  ['', 'ทุกสถานะ'],
  ['REQUIRES_ATTENTION', 'ต้องตรวจสอบ'],
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

const REQUEST_STATUS_OPTIONS: Array<[AttendanceAdjustmentStatus | '', string]> = [
  ['', 'ทุกสถานะ'],
  ['PENDING_APPROVAL', 'รอ ADMIN อนุมัติ'],
  ['RETURNED_FOR_CORRECTION', 'ส่งกลับให้แก้ไข'],
  ['DRAFT', 'แบบร่าง'],
  ['APPROVED', 'อนุมัติแล้ว'],
  ['REJECTED', 'ไม่อนุมัติ']
];

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

function dateTime(value?: string | null) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('th-TH', {
    timeZone: 'Asia/Bangkok',
    day: '2-digit',
    month: 'short',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(value));
}

function bangkokInput(value?: string | null) {
  if (!value) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(value));
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

function bangkokInputToIso(value: string) {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  return new Date(Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour) - 7,
    Number(minute)
  )).toISOString();
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

function requestStatusLabel(status: AttendanceAdjustmentStatus) {
  const map: Record<AttendanceAdjustmentStatus, string> = {
    DRAFT: 'แบบร่าง',
    PENDING_APPROVAL: 'รอ ADMIN อนุมัติ',
    RETURNED_FOR_CORRECTION: 'ส่งกลับให้แก้ไข',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ไม่อนุมัติ',
    CANCELLED: 'ยกเลิก'
  };
  return map[status];
}

function requestStatusTone(status: AttendanceAdjustmentStatus) {
  if (status === 'APPROVED') return 'good';
  if (status === 'PENDING_APPROVAL') return 'warning';
  if (status === 'REJECTED') return 'danger';
  return 'neutral';
}

function requestTypeLabel(type: AdjustmentType) {
  return type === 'CONFIRM_WORK_PERFORMED' ? 'ยืนยันปฏิบัติงาน' : 'แก้ไขเวลาปฏิบัติงาน';
}

function proposalLine(request: AttendanceAdjustmentRequest) {
  const before = request.beforeSnapshot?.effective || {};
  const after = request.currentProposal || {};
  return {
    beforeIn: before.checkInAt || null,
    beforeOut: before.checkOutAt || null,
    afterIn: after.checkInAt || before.checkInAt || null,
    afterOut: after.checkOutAt || before.checkOutAt || null
  };
}

function KPI({
  label,
  value,
  icon,
  tone = 'neutral',
  onClick
}: {
  label: string;
  value: number;
  icon: SmsIconName;
  tone?: string;
  onClick?: () => void;
}) {
  return <article className={`attendance-supervisor-v4__kpi is-${tone}${onClick ? ' is-actionable' : ''}`} role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined} onClick={onClick} onKeyDown={onClick ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onClick(); } } : undefined}>
    <span><SmsIcon name={icon} size={20} /></span>
    <div><strong>{value}</strong><small>{label}</small></div>
  </article>;
}

export function AttendanceSupervisorPage({ token, role, department, userId, onOpenAttendanceReport }: Props) {
  const today = bangkokDateText();
  const manager = role === 'MANAGER';
  const admin = role === 'ADMIN';

  const [mode, setMode] = useState<Mode>('daily');
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState(shiftDate(today, -30));
  const [to, setTo] = useState(today);
  const [departmentFilter, setDepartmentFilter] = useState(manager ? department || '' : '');
  const [siteId, setSiteId] = useState('');
  const [shiftTypeId, setShiftTypeId] = useState('');
  const [employeeId, setEmployeeId] = useState('');
  const [status, setStatus] = useState('');
  const [sites, setSites] = useState<SecuritySite[]>([]);
  const [shifts, setShifts] = useState<Array<{ id: string; code?: string; name?: string }>>([]);
  const [employees, setEmployees] = useState<Array<{
    id: string;
    employeeCode?: string;
    displayName?: string;
    firstName?: string;
    lastName?: string;
    department?: string;
  }>>([]);
  const [daily, setDaily] = useState<DailyData>();
  const [history, setHistory] = useState<HistoryData>();
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filtersLoading, setFiltersLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [detail, setDetail] = useState<DetailData>();
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailRequests, setDetailRequests] = useState<AttendanceAdjustmentRequest[]>([]);

  const [requestStatus, setRequestStatus] = useState<AttendanceAdjustmentStatus | ''>(admin ? 'PENDING_APPROVAL' : '');
  const [requestPage, setRequestPage] = useState(1);
  const [requests, setRequests] = useState<AttendanceAdjustmentRequest[]>([]);
  const [requestMeta, setRequestMeta] = useState({ page: 1, pageSize: 25, total: 0, totalPages: 1 });
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState<string>();
  const [requestNotice, setRequestNotice] = useState<string>();
  const [adjustmentDialog, setAdjustmentDialog] = useState<AdjustmentDialog>();
  const [manualDialog, setManualDialog] = useState<ManualConfirmationDialog>();
  const [reviewDialog, setReviewDialog] = useState<ReviewDialog>();
  const [workflowBusy, setWorkflowBusy] = useState(false);
  const [workflowError, setWorkflowError] = useState<string>();
  const [reloadKey, setReloadKey] = useState(0);

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
      if (shiftResult.status === 'fulfilled') {
        setShifts(Array.isArray(shiftResult.value?.data) ? shiftResult.value.data : []);
      }
      if (employeeResult.status === 'fulfilled') {
        setEmployees(Array.isArray(employeeResult.value?.data) ? employeeResult.value.data : []);
      }
    }).finally(() => {
      if (active) setFiltersLoading(false);
    });
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    if (manager) setDepartmentFilter(department || '');
  }, [department, manager]);

  const departments = useMemo(() => {
    const values = new Set<string>();
    employees.forEach((employee) => {
      if (employee.department) values.add(employee.department);
    });
    return [...values].sort((a, b) => a.localeCompare(b, 'th'));
  }, [employees]);

  const filteredEmployees = useMemo(
    () => employees.filter((employee) => !departmentFilter || employee.department === departmentFilter),
    [departmentFilter, employees]
  );

  useEffect(() => {
    if (mode === 'requests') return;
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
      ? attendanceSupervisorDaily(token, { date, ...filters })
      : attendanceSupervisorHistory(token, { from, to, page, pageSize: 50, ...filters });

    request
      .then((response) => {
        if (!active) return;
        if (mode === 'daily') setDaily(response.data as DailyData);
        else setHistory(response.data as HistoryData);
      })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่าน Attendance Dashboard ได้');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => { active = false; };
  }, [
    date,
    departmentFilter,
    employeeId,
    from,
    mode,
    page,
    reloadKey,
    shiftTypeId,
    siteId,
    status,
    to,
    token
  ]);

  useEffect(() => {
    if (mode !== 'requests') return;
    let active = true;
    setRequestLoading(true);
    setRequestError(undefined);

    listAttendanceAdjustments(token, {
      ...(requestStatus ? { status: requestStatus } : {}),
      page: requestPage,
      pageSize: 25
    })
      .then((response) => {
        if (!active) return;
        setRequests(Array.isArray(response.data) ? response.data : []);
        setRequestMeta(response.meta || { page: requestPage, pageSize: 25, total: 0, totalPages: 1 });
      })
      .catch((reason) => {
        if (active) setRequestError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านคิวคำขอ Attendance ได้');
      })
      .finally(() => {
        if (active) setRequestLoading(false);
      });

    return () => { active = false; };
  }, [mode, reloadKey, requestPage, requestStatus, token]);

  useEffect(() => {
    setPage(1);
  }, [from, to, departmentFilter, siteId, shiftTypeId, employeeId, status, mode]);

  useEffect(() => {
    setRequestPage(1);
  }, [requestStatus]);

  const data = mode === 'daily' ? daily : history;
  const rows = mode === 'requests' ? [] : data?.rows || [];
  const summary = mode === 'requests' ? undefined : data?.summary;

  const refresh = () => setReloadKey((value) => value + 1);

  const openDetail = async (assignmentId: string) => {
    setDetail(undefined);
    setDetailRequests([]);
    setDetailLoading(true);
    setError(undefined);
    try {
      const [detailResult, requestResult] = await Promise.allSettled([
        attendanceSupervisorDetail(token, assignmentId),
        listAttendanceAdjustments(token, { assignmentId, page: 1, pageSize: 10 })
      ]);
      if (detailResult.status === 'rejected') throw detailResult.reason;
      setDetail(detailResult.value.data as DetailData);
      if (requestResult.status === 'fulfilled') {
        setDetailRequests(Array.isArray(requestResult.value.data) ? requestResult.value.data : []);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถอ่านรายละเอียด Attendance ได้');
    } finally {
      setDetailLoading(false);
    }
  };

  const openEvidence = async (evidenceId: string) => {
    try {
      const result = await attendanceEvidenceView(token, evidenceId);
      const url = result?.data?.url;
      if (!url) throw new Error('ไม่พบ URL หลักฐานภาพ');
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'ไม่สามารถเปิดหลักฐานภาพ Attendance ได้');
    }
  };

  const openManualConfirmation = () => {
    setWorkflowError(undefined);
    setManualDialog({
      employeeId: employeeId || '',
      workDate: date || today,
      checkInAt: '',
      checkOutAt: '',
      reason: ''
    });
  };

  const saveManualConfirmation = async () => {
    if (!manualDialog || workflowBusy) return;
    setWorkflowError(undefined);

    const selectedEmployee = filteredEmployees.find((employee) => employee.id === manualDialog.employeeId);
    if (!selectedEmployee) {
      setWorkflowError('กรุณาเลือกพนักงาน');
      return;
    }
    if (!manualDialog.workDate) {
      setWorkflowError('กรุณาเลือกวันที่ปฏิบัติงาน');
      return;
    }
    if (manualDialog.workDate > today) {
      setWorkflowError('ไม่สามารถยืนยันการปฏิบัติงานล่วงหน้าได้');
      return;
    }

    const checkInAt = bangkokInputToIso(manualDialog.checkInAt);
    const checkOutAt = bangkokInputToIso(manualDialog.checkOutAt);
    if (!checkInAt || !checkOutAt) {
      setWorkflowError('กรุณาระบุเวลาเข้าและเวลาออกให้ครบ');
      return;
    }
    if (!manualDialog.checkInAt.startsWith(`${manualDialog.workDate}T`)) {
      setWorkflowError('เวลาเข้าต้องอยู่ในวันที่ปฏิบัติงานที่เลือก');
      return;
    }
    const checkOutDate = manualDialog.checkOutAt.slice(0, 10);
    if (![manualDialog.workDate, shiftDate(manualDialog.workDate, 1)].includes(checkOutDate)) {
      setWorkflowError('เวลาออกต้องอยู่ในวันเดียวกันหรือวันถัดไปสำหรับกะข้ามคืน');
      return;
    }
    if (new Date(checkOutAt) <= new Date(checkInAt)) {
      setWorkflowError('เวลาออกต้องอยู่หลังเวลาเข้า');
      return;
    }
    if (manualDialog.reason.trim().length < 5) {
      setWorkflowError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }

    setWorkflowBusy(true);
    try {
      const dailyResult = await attendanceSupervisorDaily(token, {
        date: manualDialog.workDate,
        employeeId: manualDialog.employeeId
      });
      const target = (dailyResult.data as DailyData)?.rows?.find((row) => row.employeeId === manualDialog.employeeId);
      if (!target) throw new Error('ไม่พบตารางงานของพนักงานในวันที่เลือก จึงไม่สามารถยืนยัน Attendance ย้อนหลังได้');

      const created = await createAttendanceAdjustment(token, {
        assignmentId: target.assignmentId,
        requestType: 'CONFIRM_WORK_PERFORMED',
        proposal: { checkInAt, checkOutAt },
        reason: manualDialog.reason.trim()
      });
      const requestId = created.data.id as string;
      await submitAttendanceAdjustment(token, requestId);

      if (admin) {
        try {
          await approveAttendanceAdjustment(token, requestId);
          setRequestNotice(`บันทึกยืนยันปฏิบัติงานย้อนหลังของ ${target.employeeName} วันที่ ${manualDialog.workDate} และอนุมัติแล้ว`);
          setMode('requests');
          setRequestStatus('APPROVED');
        } catch (approvalReason) {
          setRequestNotice(`สร้างคำขอแล้ว แต่การอนุมัติอัตโนมัติไม่สำเร็จ: ${approvalReason instanceof Error ? approvalReason.message : 'กรุณาตรวจคิวอนุมัติ'}`);
          setMode('requests');
          setRequestStatus('PENDING_APPROVAL');
        }
      } else {
        setRequestNotice(`ส่งคำขอยืนยันปฏิบัติงานย้อนหลังของ ${target.employeeName} แล้ว · รอ ADMIN อนุมัติเป็นขั้นสุดท้าย`);
        setMode('requests');
        setRequestStatus('PENDING_APPROVAL');
      }

      setDate(manualDialog.workDate);
      setEmployeeId(manualDialog.employeeId);
      setManualDialog(undefined);
      refresh();
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : 'บันทึกยืนยันปฏิบัติงานย้อนหลังไม่สำเร็จ');
    } finally {
      setWorkflowBusy(false);
    }
  };

  const openRowAdjustment = (row: AttendanceRow) => {
    setWorkflowError(undefined);
    setAdjustmentDialog({
      assignmentId: row.assignmentId,
      employeeName: row.employeeName,
      type: 'CONFIRM_WORK_PERFORMED',
      checkInAt: bangkokInput(row.checkInAt || row.originalCheckInAt || ''),
      checkOutAt: bangkokInput(row.checkOutAt || row.originalCheckOutAt || ''),
      reason: ''
    });
  };

  const openNewAdjustment = (type: AdjustmentType) => {
    if (!detail) return;
    setWorkflowError(undefined);
    const checkIn = detail.checkInAt || detail.expectedStartAt || '';
    const checkOut = detail.checkOutAt || detail.expectedEndAt || '';
    setAdjustmentDialog({
      assignmentId: detail.assignmentId,
      employeeName: detail.employeeName,
      type,
      checkInAt: bangkokInput(checkIn),
      checkOutAt: bangkokInput(checkOut),
      reason: ''
    });
  };

  const openReturnedRevision = (request: AttendanceAdjustmentRequest) => {
    const before = request.beforeSnapshot?.effective || {};
    const proposal = request.currentProposal || {};
    setWorkflowError(undefined);
    setAdjustmentDialog({
      requestId: request.id,
      assignmentId: request.shiftAssignmentId,
      employeeName: request.employeeName || request.employeeCode || 'Attendance',
      type: request.requestType,
      checkInAt: bangkokInput(proposal.checkInAt || before.checkInAt || ''),
      checkOutAt: bangkokInput(proposal.checkOutAt || before.checkOutAt || ''),
      reason: request.reason,
      returnedComment: request.lastReviewerComment
    });
  };

  const saveAdjustment = async () => {
    if (!adjustmentDialog || workflowBusy) return;
    setWorkflowError(undefined);

    const checkInAt = bangkokInputToIso(adjustmentDialog.checkInAt);
    const checkOutAt = bangkokInputToIso(adjustmentDialog.checkOutAt);
    if (adjustmentDialog.type === 'CONFIRM_WORK_PERFORMED' && (!checkInAt || !checkOutAt)) {
      setWorkflowError('กรุณาระบุเวลาเข้าและเวลาออกให้ครบ');
      return;
    }
    if (adjustmentDialog.type === 'ADJUST_WORK_TIME' && !checkInAt && !checkOutAt) {
      setWorkflowError('กรุณาระบุเวลาอย่างน้อย 1 รายการ');
      return;
    }
    if (checkInAt && checkOutAt && new Date(checkOutAt) <= new Date(checkInAt)) {
      setWorkflowError('เวลาออกต้องอยู่หลังเวลาเข้า');
      return;
    }
    if (adjustmentDialog.reason.trim().length < 5) {
      setWorkflowError('กรุณาระบุเหตุผลอย่างน้อย 5 ตัวอักษร');
      return;
    }

    const payload = {
      requestType: adjustmentDialog.type,
      proposal: { checkInAt, checkOutAt },
      reason: adjustmentDialog.reason.trim()
    };

    setWorkflowBusy(true);
    try {
      let requestId = adjustmentDialog.requestId;
      if (requestId) {
        await reviseAttendanceAdjustment(token, requestId, payload);
      } else {
        const created = await createAttendanceAdjustment(token, {
          assignmentId: adjustmentDialog.assignmentId,
          ...payload
        });
        requestId = created.data.id;
      }
      await submitAttendanceAdjustment(token, requestId as string);
      setAdjustmentDialog(undefined);
      setDetail(undefined);
      setRequestNotice(
        admin
          ? 'ส่งคำขอแล้ว · ยังไม่มีผลต่อ Attendance จนกว่าจะกดอนุมัติแยกต่างหาก'
          : 'ส่งคำขอแล้ว · รอ ADMIN อนุมัติก่อนจึงจะมีผลต่อ Attendance'
      );
      setMode('requests');
      setRequestStatus('PENDING_APPROVAL');
      refresh();
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : 'ส่งคำขอแก้ไข Attendance ไม่สำเร็จ');
    } finally {
      setWorkflowBusy(false);
    }
  };

  const executeReview = async () => {
    if (!reviewDialog || workflowBusy) return;
    if (reviewDialog.action !== 'approve' && reviewDialog.comment.trim().length < 3) {
      setWorkflowError('กรุณาระบุความเห็นอย่างน้อย 3 ตัวอักษร');
      return;
    }

    setWorkflowBusy(true);
    setWorkflowError(undefined);
    try {
      if (reviewDialog.action === 'approve') {
        await approveAttendanceAdjustment(token, reviewDialog.request.id);
        setRequestNotice('ADMIN อนุมัติแล้ว · Effective Attendance ถูกสร้างจาก revision ที่อนุมัติ');
      } else if (reviewDialog.action === 'return') {
        await returnAttendanceAdjustment(token, reviewDialog.request.id, reviewDialog.comment.trim());
        setRequestNotice('ส่งคำขอกลับให้ Maker แก้ไขแล้ว');
      } else {
        await rejectAttendanceAdjustment(token, reviewDialog.request.id, reviewDialog.comment.trim());
        setRequestNotice('ปฏิเสธคำขอแล้ว · Attendance เดิมไม่เปลี่ยนแปลง');
      }
      setReviewDialog(undefined);
      refresh();
    } catch (reason) {
      setWorkflowError(reason instanceof Error ? reason.message : 'ดำเนินการคำขอ Attendance ไม่สำเร็จ');
    } finally {
      setWorkflowBusy(false);
    }
  };

  return <section className="attendance-supervisor-v4">
    <header className="attendance-supervisor-v4__hero">
      <div>
        <span className="attendance-supervisor-v4__eyebrow">ATTENDANCE CONTROL CENTER</span>
        <h2>Attendance Dashboard</h2>
        <p>{manager ? `ขอบเขต Manager: ${department || 'ไม่ระบุ Department'}` : 'Admin มองเห็นทุก Department ตามสิทธิ์'}</p>
      </div>
      <div className="attendance-supervisor-v4__hero-controls">
        <button type="button" className="attendance-supervisor-v4__manual-btn" onClick={openManualConfirmation}>
          <SmsIcon name="attendance" size={17} />คีย์ยืนยันมาปฏิบัติงานย้อนหลัง
        </button>
        <div className="attendance-supervisor-v4__tabs" role="tablist" aria-label="Attendance dashboard views">
          {admin && onOpenAttendanceReport && <button type="button" onClick={onOpenAttendanceReport} title="เปิดรายงานการลงเวลาประจำเดือน"><SmsIcon name="report" size={17} />Export Report</button>}
          <button type="button" className={mode === 'daily' ? 'active' : ''} onClick={() => setMode('daily')}>
            <SmsIcon name="dashboard" size={17} />วันนี้
          </button>
          <button type="button" className={mode === 'history' ? 'active' : ''} onClick={() => setMode('history')}>
            <SmsIcon name="history" size={17} />ประวัติ
          </button>
          <button type="button" className={mode === 'requests' ? 'active' : ''} onClick={() => setMode('requests')}>
            <SmsIcon name="approval" size={17} />คำขอแก้ไข
          </button>
        </div>
      </div>
    </header>

    {mode !== 'requests' ? <>
      <section className="attendance-supervisor-v4__filters">
        {mode === 'daily' ? (
          <label><span>วันที่</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        ) : <>
          <label><span>ตั้งแต่</span><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label><span>ถึง</span><input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
        </>}
        <label>
          <span>Department</span>
          <select
            value={departmentFilter}
            disabled={manager || filtersLoading}
            onChange={(event) => {
              setDepartmentFilter(event.target.value);
              setEmployeeId('');
            }}
          >
            {!manager && <option value="">ทั้งหมด</option>}
            {manager && departmentFilter && <option value={departmentFilter}>{departmentFilter}</option>}
            {!manager && departments.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label>
          <span>Site</span>
          <select value={siteId} disabled={filtersLoading} onChange={(event) => setSiteId(event.target.value)}>
            <option value="">ทั้งหมด</option>
            {sites.filter((site) => site.isActive).map((site) => (
              <option key={site.id} value={site.id}>{site.code} · {site.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Shift</span>
          <select value={shiftTypeId} disabled={filtersLoading} onChange={(event) => setShiftTypeId(event.target.value)}>
            <option value="">ทั้งหมด</option>
            {shifts.map((shift) => (
              <option key={shift.id} value={shift.id}>{shift.code || '—'} · {shift.name || '—'}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Employee</span>
          <select value={employeeId} disabled={filtersLoading} onChange={(event) => setEmployeeId(event.target.value)}>
            <option value="">ทั้งหมด</option>
            {filteredEmployees.map((employee) => (
              <option key={employee.id} value={employee.id}>
                {employee.employeeCode || '—'} · {employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            {STATUS_OPTIONS.map(([value, label]) => <option key={value || 'all'} value={value}>{label}</option>)}
          </select>
        </label>
      </section>

      {summary && <section className="attendance-supervisor-v4__kpis">
        <KPI label="ต้องตรวจสอบ" value={summary.requiresAttention} icon="quality" tone="danger" onClick={() => setStatus('REQUIRES_ATTENTION')} />
        <KPI label="Scheduled" value={summary.scheduledToday} icon="calendar" />
        <KPI label="Checked in" value={summary.checkedIn} icon="check" tone="good" />
        <KPI label="Working now" value={summary.currentlyWorking} icon="attendance" tone="good" />
        <KPI label="Not checked in" value={summary.notCheckedInYet} icon="clock" onClick={() => setStatus('NOT_CHECKED_IN_YET')} />
        <KPI label="Late" value={summary.late} icon="clock" tone="warning" onClick={() => setStatus('LATE')} />
        <KPI label="Early out" value={summary.earlyOut} icon="history" tone="warning" onClick={() => setStatus('EARLY_OUT')} />
        <KPI label="Wrong shift" value={summary.wrongShift} icon="quality" tone="warning" onClick={() => setStatus('WRONG_SHIFT')} />
        <KPI label="Assist other Site" value={summary.assistingOtherSite} icon="location" onClick={() => setStatus('ASSIST_OTHER_SITE')} />
        <KPI label="Outside Site" value={summary.outsideAllSites} icon="location" tone="danger" onClick={() => setStatus('OUTSIDE_ALL_SITES')} />
        <KPI label="Leave" value={summary.leave} icon="leave" onClick={() => setStatus('LEAVE')} />
        <KPI label="Absent" value={summary.absent} icon="quality" tone="danger" onClick={() => setStatus('ABSENT')} />
        <KPI label="Time abnormal" value={summary.timeAbnormal} icon="quality" tone="danger" onClick={() => setStatus('TIME_ABNORMAL')} />
      </section>}

      {error && <div className="attendance-supervisor-v4__error" role="alert">
        <strong>ไม่สามารถแสดงข้อมูลได้</strong>
        <span>{error}</span>
      </div>}

      <section className="attendance-supervisor-v4__table-card">
        <div className="attendance-supervisor-v4__table-head">
          <div>
            <strong>{mode === 'daily' ? 'สถานะประจำวัน' : 'Attendance History'}</strong>
            <span>{loading ? 'กำลังโหลด…' : `${rows.length} รายการ`}</span>
          </div>
          {mode === 'history' && history?.meta && (
            <span>หน้า {history.meta.page}/{history.meta.totalPages} · {history.meta.total} รายการ</span>
          )}
        </div>
        <div className="attendance-supervisor-v4__table-wrap">
          <table>
            <thead>
              <tr>
                {mode === 'history' && <th>วันที่</th>}
                <th>Employee</th>
                <th>Shift</th>
                <th>Expected Site</th>
                <th>Actual Site</th>
                <th>In</th>
                <th>Out</th>
                <th>Worked</th>
                <th>Status</th>
                <th>Flags</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={mode === 'history' ? 11 : 10} className="attendance-supervisor-v4__empty">
                    ไม่พบข้อมูล Attendance ตามตัวกรอง
                  </td>
                </tr>
              )}
              {rows.map((row) => (
                <tr key={row.assignmentId}>
                  {mode === 'history' && <td>{row.date}</td>}
                  <td>
                    <strong>{row.employeeCode || '—'}</strong>
                    <small>{row.employeeName}</small>
                    <small>{row.department || '—'}</small>
                  </td>
                  <td>{row.shift.code || row.shift.name || '—'}</td>
                  <td>{row.expectedSite?.name || '—'}</td>
                  <td>{row.actualSite?.name || '—'}</td>
                  <td>{time(row.checkInAt)}</td>
                  <td>{time(row.checkOutAt)}</td>
                  <td>{duration(row.workedMinutes)}</td>
                  <td>
                    <span className={`attendance-supervisor-v4__status is-${statusTone(row.attendanceStatus)}`}>
                      {statusLabel(row.attendanceStatus)}
                    </span>
                  </td>
                  <td>
                    <div className="attendance-supervisor-v4__flags">
                      {row.flags.slice(0, 3).map((flag) => <span key={flag}>{flag}</span>)}
                      {row.flags.length > 3 && <span>+{row.flags.length - 3}</span>}
                    </div>
                  </td>
                  <td>
                    <div className="attendance-supervisor-v4__row-actions">
                      <button
                        type="button"
                        className="attendance-supervisor-v4__onbehalf-btn"
                        onClick={() => openRowAdjustment(row)}
                      >
                        ลงเวลาแทน
                      </button>
                      <button
                        type="button"
                        className="attendance-supervisor-v4__detail-btn"
                        onClick={() => void openDetail(row.assignmentId)}
                      >
                        ดูรายละเอียด
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {mode === 'history' && history?.meta && history.meta.totalPages > 1 && (
          <div className="attendance-supervisor-v4__pager">
            <button type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button>
            <span>{page} / {history.meta.totalPages}</span>
            <button type="button" disabled={page >= history.meta.totalPages} onClick={() => setPage((value) => value + 1)}>ถัดไป</button>
          </div>
        )}
      </section>
    </> : (
      <section className="attendance-supervisor-v4__requests">
        <div className="attendance-supervisor-v4__request-toolbar">
          <div>
            <span className="attendance-supervisor-v4__eyebrow">GOVERNED ADJUSTMENT</span>
            <h3>{admin ? 'คิวอนุมัติ Attendance' : 'คำขอแก้ไข Attendance'}</h3>
            <p>
              {admin
                ? 'ทุกการเปลี่ยนเวลาต้องผ่านปุ่มอนุมัติแยกต่างหากก่อนมีผลจริง'
                : 'คำขอของ Manager ไม่มีผลต่อ Attendance จนกว่า ADMIN จะอนุมัติ'}
            </p>
          </div>
          <label>
            <span>สถานะคำขอ</span>
            <select
              value={requestStatus}
              onChange={(event) => setRequestStatus(event.target.value as AttendanceAdjustmentStatus | '')}
            >
              {REQUEST_STATUS_OPTIONS.map(([value, label]) => (
                <option key={value || 'all'} value={value}>{label}</option>
              ))}
            </select>
          </label>
        </div>

        {requestNotice && (
          <div className="attendance-supervisor-v4__notice" role="status">
            <SmsIcon name="check" size={18} />
            <span>{requestNotice}</span>
            <button type="button" aria-label="ปิดข้อความ" onClick={() => setRequestNotice(undefined)}>×</button>
          </div>
        )}
        {requestError && (
          <div className="attendance-supervisor-v4__error" role="alert">
            <strong>ไม่สามารถแสดงคิวคำขอได้</strong>
            <span>{requestError}</span>
          </div>
        )}

        <div className="attendance-supervisor-v4__request-list">
          {requestLoading && <div className="attendance-supervisor-v4__request-empty">กำลังโหลดคำขอ…</div>}
          {!requestLoading && requests.length === 0 && (
            <div className="attendance-supervisor-v4__request-empty">
              <SmsIcon name="approval" size={26} />
              <strong>ไม่มีคำขอตามสถานะที่เลือก</strong>
              <span>เมื่อ Manager/Admin ส่งคำขอ ระบบจะแสดงที่นี่โดยไม่เปลี่ยน Attendance เดิม</span>
            </div>
          )}

          {requests.map((request) => {
            const proposal = proposalLine(request);
            const canRevise = request.status === 'RETURNED_FOR_CORRECTION' && request.makerUserId === userId;
            return <article className="attendance-supervisor-v4__request-card" key={request.id}>
              <header>
                <div>
                  <span className="attendance-supervisor-v4__request-type">
                    {requestTypeLabel(request.requestType)}
                  </span>
                  <h4>{request.employeeCode || '—'} · {request.employeeName || '—'}</h4>
                  <p>{request.department || '—'} · วันที่ {String(request.workDate || '').slice(0, 10) || '—'}</p>
                </div>
                <span className={`attendance-supervisor-v4__status is-${requestStatusTone(request.status)}`}>
                  {requestStatusLabel(request.status)}
                </span>
              </header>

              <div className="attendance-supervisor-v4__request-compare">
                <div className="is-label"><span></span><strong>ก่อน</strong><strong>เสนอ</strong></div>
                <div><span>เวลาเข้า</span><strong>{time(proposal.beforeIn)}</strong><strong>{time(proposal.afterIn)}</strong></div>
                <div><span>เวลาออก</span><strong>{time(proposal.beforeOut)}</strong><strong>{time(proposal.afterOut)}</strong></div>
              </div>

              <div className="attendance-supervisor-v4__request-meta">
                <span><b>Maker</b> {request.makerDisplayName || request.makerRoleSnapshot}</span>
                <span><b>Revision</b> {request.currentRevision}</span>
                <span><b>สร้างเมื่อ</b> {dateTime(request.createdAt)}</span>
                {request.approverDisplayName && <span><b>Approver</b> {request.approverDisplayName}</span>}
              </div>

              <div className="attendance-supervisor-v4__request-reason">
                <span>เหตุผล</span>
                <p>{request.reason}</p>
                {request.lastReviewerComment && (
                  <div><strong>ความเห็นจาก ADMIN:</strong> {request.lastReviewerComment}</div>
                )}
              </div>

              <footer>
                <button
                  type="button"
                  className="attendance-supervisor-v4__detail-btn"
                  onClick={() => void openDetail(request.shiftAssignmentId)}
                >
                  ดู Attendance
                </button>

                {canRevise && (
                  <button type="button" className="is-primary" onClick={() => openReturnedRevision(request)}>
                    แก้ไขและส่งใหม่
                  </button>
                )}

                {admin && request.status === 'PENDING_APPROVAL' && <>
                  <button
                    type="button"
                    className="is-return"
                    onClick={() => {
                      setWorkflowError(undefined);
                      setReviewDialog({ request, action: 'return', comment: '' });
                    }}
                  >
                    ส่งกลับ
                  </button>
                  <button
                    type="button"
                    className="is-reject"
                    onClick={() => {
                      setWorkflowError(undefined);
                      setReviewDialog({ request, action: 'reject', comment: '' });
                    }}
                  >
                    ไม่อนุมัติ
                  </button>
                  <button
                    type="button"
                    className="is-approve"
                    onClick={() => {
                      setWorkflowError(undefined);
                      setReviewDialog({ request, action: 'approve', comment: '' });
                    }}
                  >
                    อนุมัติ
                  </button>
                </>}
              </footer>
            </article>;
          })}
        </div>

        {requestMeta.totalPages > 1 && (
          <div className="attendance-supervisor-v4__pager">
            <button type="button" disabled={requestPage <= 1} onClick={() => setRequestPage((value) => Math.max(1, value - 1))}>ก่อนหน้า</button>
            <span>หน้า {requestMeta.page}/{requestMeta.totalPages} · {requestMeta.total} รายการ</span>
            <button type="button" disabled={requestPage >= requestMeta.totalPages} onClick={() => setRequestPage((value) => value + 1)}>ถัดไป</button>
          </div>
        )}
      </section>
    )}

    {(detailLoading || detail) && (
      <div
        className="attendance-supervisor-v4__drawer-backdrop"
        onMouseDown={(event) => {
          if (event.currentTarget === event.target) setDetail(undefined);
        }}
      >
        <aside className="attendance-supervisor-v4__drawer" aria-label="Attendance detail">
          <header>
            <div>
              <span>ATTENDANCE DETAIL</span>
              <h3>{detail?.employeeName || 'กำลังโหลด…'}</h3>
            </div>
            <button type="button" aria-label="ปิด" onClick={() => setDetail(undefined)}>×</button>
          </header>

          {detailLoading ? (
            <div className="attendance-supervisor-v4__drawer-loading">กำลังอ่านรายละเอียด…</div>
          ) : detail && <>
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
              {detail.rawEvents.length === 0 ? <p>ยังไม่มี AttendanceEvent</p> : detail.rawEvents.map((event) => (
                <article key={event.id}>
                  <div>
                    <strong>{event.eventType}</strong>
                    <span>{time(event.effectiveEventAt)}</span>
                    {event.evidence?.id && !event.evidence.purgedAt && (
                      <button type="button" className="attendance-supervisor-v4__evidence-view" onClick={() => void openEvidence(event.evidence!.id)} title="ดูหลักฐานภาพแบบ Private">
                        <SmsIcon name="eye" size={16} /> ดูหลักฐาน
                      </button>
                    )}
                  </div>
                  <small>Event ID: {event.id}</small>
                  {event.evidence?.purgedAt && <small>หลักฐานภาพครบกำหนด retention และถูกลบแล้ว · ประวัติยังคงอยู่</small>}
                </article>
              ))}
            </section>

            <section className="attendance-supervisor-v4__detail-requests">
              <h4>Adjustment Request History</h4>
              {detailRequests.length === 0 ? (
                <p>ยังไม่มีคำขอแก้ไข Attendance สำหรับรายการนี้</p>
              ) : detailRequests.map((request) => (
                <article key={request.id}>
                  <div>
                    <strong>{requestTypeLabel(request.requestType)}</strong>
                    <span className={`attendance-supervisor-v4__status is-${requestStatusTone(request.status)}`}>
                      {requestStatusLabel(request.status)}
                    </span>
                  </div>
                  <small>
                    Revision {request.currentRevision} · Maker {request.makerDisplayName || request.makerRoleSnapshot} · {dateTime(request.createdAt)}
                  </small>
                  <p>{request.reason}</p>
                </article>
              ))}
            </section>

            {detail.correctionAuthority === 'EFFECTIVE_ATTENDANCE_CORRECTION' && (
              <div className="attendance-supervisor-v4__legacy-warning">
                <strong>Approved Attendance correction</strong>
                <span>รายการนี้มี correction ที่ผ่าน governed request และ ADMIN approval แล้ว ค่า Effective คือ authority ปัจจุบัน</span>
              </div>
            )}

            <section className="attendance-supervisor-v4__governance-actions">
              <button type="button" onClick={() => openNewAdjustment('CONFIRM_WORK_PERFORMED')}>
                ยืนยันปฏิบัติงาน
              </button>
              <button type="button" onClick={() => openNewAdjustment('ADJUST_WORK_TIME')}>
                แก้ไขเวลาปฏิบัติงาน
              </button>
              <small>
                การกดปุ่มจะสร้างคำขอเท่านั้น · Pending ไม่มีผลต่อ Attendance · ADMIN ต้องอนุมัติแยกต่างหาก
              </small>
            </section>
          </>}
        </aside>
      </div>
    )}

    {manualDialog && (
      <div className="attendance-supervisor-v4__modal-backdrop">
        <section className="attendance-supervisor-v4__workflow-modal" role="dialog" aria-modal="true" aria-label="Manual Attendance confirmation">
          <header>
            <div>
              <span>MANUAL ATTENDANCE</span>
              <h3>คีย์ยืนยันมาปฏิบัติงานย้อนหลัง</h3>
              <p>{manager ? 'Manager ส่งคำขอ · ADMIN อนุมัติเป็นขั้นสุดท้าย' : 'Admin ยืนยันและอนุมัติผ่าน Audit workflow เดิม'}</p>
            </div>
            <button type="button" aria-label="ปิด" disabled={workflowBusy} onClick={() => setManualDialog(undefined)}>×</button>
          </header>

          <div className="attendance-supervisor-v4__workflow-principle">
            <SmsIcon name="shield" size={19} />
            <div>
              <strong>ใช้สำหรับพนักงานที่มาปฏิบัติงานจริงแต่ไม่สามารถลงเวลาปกติได้</strong>
              <span>เลือกพนักงานและวันที่จริง ระบบจะตรวจว่ามี ShiftAssignment ในวันนั้นก่อนสร้างคำขอ และไม่สร้าง Check-in อัตโนมัติ</span>
            </div>
          </div>

          <div className="attendance-supervisor-v4__workflow-fields">
            <label className="is-wide">
              <span>พนักงาน *</span>
              <select
                value={manualDialog.employeeId}
                disabled={workflowBusy || filtersLoading}
                onChange={(event) => setManualDialog((current) => current ? { ...current, employeeId: event.target.value } : current)}
              >
                <option value="">เลือกพนักงาน</option>
                {filteredEmployees.map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.employeeCode || '—'} · {employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>วันที่ปฏิบัติงาน *</span>
              <input
                type="date"
                max={today}
                value={manualDialog.workDate}
                onChange={(event) => setManualDialog((current) => current ? { ...current, workDate: event.target.value, checkInAt: '', checkOutAt: '' } : current)}
              />
            </label>
            <label>
              <span>เวลาเข้า *</span>
              <input
                type="datetime-local"
                value={manualDialog.checkInAt}
                onChange={(event) => setManualDialog((current) => current ? { ...current, checkInAt: event.target.value } : current)}
              />
            </label>
            <label>
              <span>เวลาออก *</span>
              <input
                type="datetime-local"
                value={manualDialog.checkOutAt}
                onChange={(event) => setManualDialog((current) => current ? { ...current, checkOutAt: event.target.value } : current)}
              />
            </label>
            <label className="is-wide">
              <span>เหตุผล / คำสั่งงาน / หลักฐานอ้างอิง *</span>
              <textarea
                rows={4}
                maxLength={1000}
                value={manualDialog.reason}
                placeholder="เช่น ได้รับคำสั่งไปปฏิบัติงานนอกสถานที่และไม่สามารถลงเวลาผ่านมือถือได้"
                onChange={(event) => setManualDialog((current) => current ? { ...current, reason: event.target.value } : current)}
              />
            </label>
          </div>

          {workflowError && <div className="attendance-supervisor-v4__workflow-error" role="alert">{workflowError}</div>}

          <footer>
            <button type="button" className="is-secondary" disabled={workflowBusy} onClick={() => setManualDialog(undefined)}>ยกเลิก</button>
            <button type="button" className="is-primary" disabled={workflowBusy} onClick={() => void saveManualConfirmation()}>
              {workflowBusy ? 'กำลังบันทึก…' : admin ? 'บันทึกและอนุมัติ' : 'ส่งให้ ADMIN อนุมัติ'}
            </button>
          </footer>
        </section>
      </div>
    )}

    {adjustmentDialog && (
      <div className="attendance-supervisor-v4__modal-backdrop">
        <section className="attendance-supervisor-v4__workflow-modal" role="dialog" aria-modal="true" aria-label="Attendance adjustment request">
          <header>
            <div>
              <span>GOVERNED REQUEST</span>
              <h3>{requestTypeLabel(adjustmentDialog.type)}</h3>
              <p>{adjustmentDialog.employeeName}</p>
            </div>
            <button type="button" aria-label="ปิด" disabled={workflowBusy} onClick={() => setAdjustmentDialog(undefined)}>×</button>
          </header>

          {adjustmentDialog.returnedComment && (
            <div className="attendance-supervisor-v4__returned-note">
              <strong>ADMIN ส่งกลับให้แก้ไข</strong>
              <span>{adjustmentDialog.returnedComment}</span>
            </div>
          )}

          <div className="attendance-supervisor-v4__workflow-principle">
            <SmsIcon name="shield" size={19} />
            <div>
              <strong>คำขอนี้ยังไม่เปลี่ยน Attendance</strong>
              <span>ระบบจะเก็บ Before / After / Maker / Revision และรอ ADMIN อนุมัติก่อนมีผล</span>
            </div>
          </div>

          <div className="attendance-supervisor-v4__workflow-fields">
            <label>
              <span>เวลาเข้า (Asia/Bangkok){adjustmentDialog.type === 'CONFIRM_WORK_PERFORMED' ? ' *' : ''}</span>
              <input
                type="datetime-local"
                value={adjustmentDialog.checkInAt}
                onChange={(event) => setAdjustmentDialog((current) => current ? { ...current, checkInAt: event.target.value } : current)}
              />
            </label>
            <label>
              <span>เวลาออก (Asia/Bangkok){adjustmentDialog.type === 'CONFIRM_WORK_PERFORMED' ? ' *' : ''}</span>
              <input
                type="datetime-local"
                value={adjustmentDialog.checkOutAt}
                onChange={(event) => setAdjustmentDialog((current) => current ? { ...current, checkOutAt: event.target.value } : current)}
              />
            </label>
            <label className="is-wide">
              <span>เหตุผล *</span>
              <textarea
                rows={4}
                maxLength={1000}
                value={adjustmentDialog.reason}
                placeholder="ระบุหลักฐาน/เหตุผลที่ตรวจสอบได้อย่างน้อย 5 ตัวอักษร"
                onChange={(event) => setAdjustmentDialog((current) => current ? { ...current, reason: event.target.value } : current)}
              />
            </label>
          </div>

          {workflowError && <div className="attendance-supervisor-v4__workflow-error" role="alert">{workflowError}</div>}

          <footer>
            <button type="button" className="is-secondary" disabled={workflowBusy} onClick={() => setAdjustmentDialog(undefined)}>ยกเลิก</button>
            <button type="button" className="is-primary" disabled={workflowBusy} onClick={() => void saveAdjustment()}>
              {workflowBusy ? 'กำลังส่ง…' : adjustmentDialog.requestId ? 'บันทึก Revision และส่งใหม่' : 'ส่งคำขอให้ ADMIN พิจารณา'}
            </button>
          </footer>
        </section>
      </div>
    )}

    {reviewDialog && (
      <div className="attendance-supervisor-v4__modal-backdrop">
        <section className="attendance-supervisor-v4__workflow-modal is-review" role="dialog" aria-modal="true" aria-label="Attendance approval review">
          <header>
            <div>
              <span>ADMIN APPROVAL</span>
              <h3>
                {reviewDialog.action === 'approve'
                  ? 'ยืนยันการอนุมัติ'
                  : reviewDialog.action === 'return'
                    ? 'ส่งกลับให้แก้ไข'
                    : 'ไม่อนุมัติคำขอ'}
              </h3>
              <p>{reviewDialog.request.employeeCode || '—'} · {reviewDialog.request.employeeName || '—'}</p>
            </div>
            <button type="button" aria-label="ปิด" disabled={workflowBusy} onClick={() => setReviewDialog(undefined)}>×</button>
          </header>

          {(() => {
            const proposal = proposalLine(reviewDialog.request);
            return <div className="attendance-supervisor-v4__review-compare">
              <div><span></span><strong>Before</strong><strong>After</strong></div>
              <div><span>เวลาเข้า</span><strong>{time(proposal.beforeIn)}</strong><strong>{time(proposal.afterIn)}</strong></div>
              <div><span>เวลาออก</span><strong>{time(proposal.beforeOut)}</strong><strong>{time(proposal.afterOut)}</strong></div>
            </div>;
          })()}

          <div className="attendance-supervisor-v4__review-reason">
            <span>เหตุผลจาก Maker</span>
            <strong>{reviewDialog.request.reason}</strong>
            <small>Maker: {reviewDialog.request.makerDisplayName || reviewDialog.request.makerRoleSnapshot} · Revision {reviewDialog.request.currentRevision}</small>
          </div>

          {reviewDialog.action !== 'approve' && (
            <label className="attendance-supervisor-v4__review-comment">
              <span>ความเห็นจาก ADMIN *</span>
              <textarea
                rows={4}
                maxLength={1000}
                value={reviewDialog.comment}
                placeholder={reviewDialog.action === 'return' ? 'ระบุสิ่งที่ต้องแก้ไข' : 'ระบุเหตุผลที่ไม่อนุมัติ'}
                onChange={(event) => setReviewDialog((current) => current ? { ...current, comment: event.target.value } : current)}
              />
            </label>
          )}

          <div className="attendance-supervisor-v4__approval-warning">
            {reviewDialog.action === 'approve'
              ? 'เมื่ออนุมัติ ระบบจะตรวจ stale base และเดือนที่ certify อีกครั้ง แล้วจึงสร้าง Effective Correction แบบ atomic'
              : 'Attendance เดิมจะไม่เปลี่ยนแปลงจากการดำเนินการนี้'}
          </div>

          {workflowError && <div className="attendance-supervisor-v4__workflow-error" role="alert">{workflowError}</div>}

          <footer>
            <button type="button" className="is-secondary" disabled={workflowBusy} onClick={() => setReviewDialog(undefined)}>ยกเลิก</button>
            <button
              type="button"
              className={reviewDialog.action === 'approve' ? 'is-approve' : reviewDialog.action === 'return' ? 'is-return' : 'is-reject'}
              disabled={workflowBusy}
              onClick={() => void executeReview()}
            >
              {workflowBusy
                ? 'กำลังดำเนินการ…'
                : reviewDialog.action === 'approve'
                  ? 'อนุมัติและให้มีผล'
                  : reviewDialog.action === 'return'
                    ? 'ส่งกลับให้แก้ไข'
                    : 'ยืนยันไม่อนุมัติ'}
            </button>
          </footer>
        </section>
      </div>
    )}
  </section>;
}
