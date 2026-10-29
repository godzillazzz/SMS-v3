import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const main = read('./main.tsx');
const routing = read('./routing.ts');
const client = read('./pages/attendance-supervisor/attendance-supervisor-client.ts');
const page = read('./pages/attendance-supervisor/AttendanceSupervisorPage.tsx');
const css = read('./pages/attendance-supervisor/attendance-supervisor-v4.css');
const adjustmentClient = read('./pages/attendance-supervisor/attendance-adjustment-client.ts');
const attendanceClient = read('./pages/attendance/attendance-client.ts');
const attendanceAuth = read('./attendance-auth-request.ts');
const schedulePrint = read('./schedule-print.ts');

describe('Attendance Supervisor UX V4', () => {
  it('restores a dedicated governed on-behalf Attendance destination for Manager/Admin', () => {
    expect(main).toContain("{ id: 'attendanceSupervisor', icon: 'dashboard', label: 'ศูนย์ควบคุมการลงเวลา' }");
    expect(routing).toContain("if (page === 'leavePending') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '') && !auth.isViewingAs");
    expect(routing).toContain("if (page === 'attendanceSupervisor') return ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || '')");
    expect(main).toContain("activePage === 'attendanceSupervisor' && auth.token && ['ADMIN', 'MANAGER', 'SUPERVISOR', 'VIEWER'].includes(auth.user?.role || '') && !auth.isViewingAs");
    expect(main).toContain('<AttendanceSupervisorPage');
    expect(main).toContain("activePage === 'attendance' && auth.token");
    expect(main).not.toContain("if (!pwaShell && ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(auth.user?.role || ''))");
  });

  it('keeps ADMIN Void strictly on desktop web and out of PWA/mobile surfaces', () => {
    expect(page).toContain('desktopWeb?: boolean');
    expect(page).toContain("admin && desktopWeb && detail.sessionState !== 'VOIDED' && detail.sessionId");
    expect(page).toContain("detail.sessionState === 'VOIDED'");
    expect(client).toContain("/attendance/admin/sessions/");
    expect(client).toContain("voidAttendanceSession");
    expect(main).toContain("desktopWeb={!pwaShell && auth.user?.role === 'ADMIN' && desktopVoidAvailable}");
    expect(page).not.toContain('pwa-bottom-nav');
    expect(page).not.toContain('AttendanceSimplePage');
  });

  it('keeps Official monthly Attendance export Admin-only while restoring a direct Supervisor entry point', () => {
    expect(page).toContain('onOpenAttendanceReport?: () => void');
    expect(page).toContain('ส่งออกรายงาน');
    expect(main).toContain("onOpenAttendanceReport={!pwaShell && auth.user?.role === 'ADMIN' ? () => setActivePage('attendanceReport') : undefined}");
    expect(routing).toContain("if (page === 'attendanceReport') return auth.user?.role === 'ADMIN'");
    expect(main).toContain("activePage === 'attendanceReport' ? 'export'");
  });

  it('isolates daily history and detail clients from the locked core API surface', () => {
    expect(client).toContain('/attendance/supervisor/daily');
    expect(client).toContain('/attendance/supervisor/history');
    expect(client).toContain('/attendance/supervisor/assignments/');
    expect(client).toContain('/detail');
  });

  it('routes Attendance V4 requests through the central token refresh/retry path', () => {
    for (const source of [attendanceClient, client, adjustmentClient]) {
      expect(source).toContain('attendanceAuthenticatedRequest');
      expect(source).not.toContain('fetch(');
    }
    expect(attendanceAuth).toContain('export async function attendanceAuthenticatedRequest');
    expect(attendanceAuth).toContain('refreshAuth()');
    expect(attendanceAuth).toContain("import { api, refreshAuth } from './api'");
    expect(attendanceAuth).not.toContain('refreshPromise');
    expect(attendanceAuth).toContain('onAttendanceTokenRefreshed');
    expect(attendanceAuth).not.toContain("headers.set('Content-Type'");
  });

  it('implements approved dashboard filters and KPI/read-model fields', () => {
    for (const label of ['หน่วยงาน', 'จุดปฏิบัติงาน', 'กะ', 'พนักงาน', 'สถานะ']) expect(page).toContain(label);
    for (const label of ['ต้องตรวจสอบ', 'มีตาราง', 'ลงเวลาแล้ว', 'กำลังปฏิบัติงาน', 'ยังไม่ลงเวลา', 'มาสาย', 'ออกก่อนเวลา', 'ผิดกะ', 'ช่วยจุดอื่น', 'นอกพื้นที่', 'ลา', 'ขาด', 'เวลาผิดปกติ']) {
      expect(page).toContain(label);
    }
    expect(page).toContain("['REQUIRES_ATTENTION', 'ต้องตรวจสอบ']");
    expect(page).toContain("onClick={() => setStatus('REQUIRES_ATTENTION')}");
    expect(page).toContain("onClick={() => setStatus('WRONG_SHIFT')}");
    expect(page).toContain("onClick={() => setStatus('COMPLETE')}");
    expect(page).toContain("onClick={() => setStatus('CURRENTLY_WORKING')}");
    expect(page).toContain("role={onClick ? 'button' : undefined}");
  });

  it('offers daily, all-active-employee, and per-row month-to-date print actions', () => {
    expect(page).toContain('attendanceSupervisorMonthPrint(token, date)');
    expect(page).toContain('response.data.employees.filter((employee) => employee.id === nextEmployeeId)');
    expect(page).toContain('attendanceMonthPrintRows({ ...response.data, employees: sourceEmployees })');
    expect(page).toContain('รายงานวันนี้');
    expect(page).toContain('พิมพ์ทั้งหมด');
    expect(page).toContain('aria-label={`พิมพ์ ${row.employeeName}`}');
    expect(page).toContain('<SmsIcon name="report" size={18} />');
    expect(page).toContain("printDocument('.attendance-supervisor-print'");
    expect(page).toContain('<AttendanceMonthToDatePrint date={date} employees={printEmployees} rows={printRows} />');
    expect(page).not.toContain('AttendanceSupervisorPrint');
    expect(schedulePrint).toContain('.attendance-supervisor-print-page:not(.timesheet-sheet) table');
    expect(schedulePrint).toContain('.attendance-supervisor-print-page:not(.timesheet-sheet) th');
    expect(schedulePrint).not.toContain('.attendance-supervisor-print-page table {');
  });

  it('keeps report controls together and supports per-person print in daily mode', () => {
    expect(css).toContain('.attendance-supervisor-v4__print-actions { display: flex; flex-wrap: nowrap;');
    expect(page).toContain("if (mode !== 'daily' || printLoading) return;");
    expect(page).toContain('void printAttendance(row.employeeId)');
    expect(page).toContain('const openDetail = async (assignmentId: string, row?: AttendanceRow)');
    expect(page).toContain('setDetailRow(row);');
    expect(page).toContain('onOpenDetail={(r) => void openDetail(r.assignmentId, r)}');
    expect(page).toContain('detailRow.assignmentId === detail.assignmentId');
  });

  it('implements the reduced owner supervisor table columns', () => {
    for (const column of ['สถานที่ตามตาราง', 'สถานที่ลงเวลาจริง', 'เวลาปฏิบัติงาน', 'ข้อสังเกต', 'จัดการ']) expect(page).toContain(column);
    expect(page).not.toContain('<th scope="col">เวลาตามกะ</th>');
    expect(page).not.toContain('<th scope="col">ประเภท</th>');
    expect(page).not.toContain('<th scope="col">การทำงาน</th>');
  });

  it('opens Attendance Detail as a centered accessible modal with standard typography', () => {
    expect(page).toContain('className="attendance-supervisor-v4__detail-backdrop"');
    expect(page).toContain('className="attendance-supervisor-v4__detail-modal" role="dialog" aria-modal="true"');
    expect(css).toContain('.attendance-supervisor-v4__detail-backdrop {');
    expect(css).toContain('place-items: center;');
    expect(css).toContain('.attendance-supervisor-v4__detail-modal {');
    expect(css).toContain('max-height: min(88vh, 880px);');
    expect(css).toContain('font-family: inherit;');
    expect(css).toContain('overflow-y: auto;');
    expect(css).not.toContain('.attendance-supervisor-v4__drawer-backdrop {');
  });

  it('shows original versus effective Attendance and immutable raw events in the detail modal', () => {
    expect(page).toContain('Original → Effective');
    expect(page).toContain('Immutable Attendance Events');
    expect(page).toContain('originalCheckInAt');
    expect(page).toContain('originalCheckOutAt');
    expect(page).toContain('rawEvents');
    expect(page).toContain('EFFECTIVE_ATTENDANCE_CORRECTION');
    expect(page).not.toContain('Legacy correction overlay');
  });

  it('shows governed request history inside Attendance detail without making pending values effective', () => {
    expect(page).toContain('Adjustment Request History');
    expect(page).toContain('detailRequests');
    expect(page).toContain('listAttendanceAdjustments(token, { assignmentId, page: 1, pageSize: 10 })');
    expect(page).toContain('requestStatusLabel(request.status)');
  });

  it('wires governed Manager/Admin request creation without direct Attendance mutation', () => {
    expect(page).toContain('ยืนยันปฏิบัติงาน');
    expect(page).toContain('แก้ไขเวลาปฏิบัติงาน');
    expect(page).toContain("openNewAdjustment('CONFIRM_WORK_PERFORMED')");
    expect(page).toContain("openNewAdjustment('ADJUST_WORK_TIME')");
    expect(page).toContain('ส่งคำขอให้ ADMIN พิจารณา');
    expect(page).toContain('Pending ไม่มีผลต่อ Attendance');
    expect(adjustmentClient).toContain('/attendance/adjustment-requests');
    expect(adjustmentClient).not.toContain('/attendance/governance/assignments/');
  });

  it('keeps on-behalf keying one click away in the row details dialog (owner issue 8)', () => {
    expect(page).toContain('ลงเวลาแทน');
    expect(page).toContain('onClick={() => { setDetailRow(row); void openDetail(row.assignmentId, row); }}');
    expect(page).toContain('openRowAdjustment(row); }}><SmsIcon name="clock" size={16} />ลงเวลาแทน</button>');
    expect(page).toContain("type: 'CONFIRM_WORK_PERFORMED'");
    expect(page).toContain("checkInAt: bangkokInput(row.checkInAt || row.originalCheckInAt || '')");
    expect(page).toContain("checkOutAt: bangkokInput(row.checkOutAt || row.originalCheckOutAt || '')");
    expect(page).not.toContain("bangkokInput(row.expectedStartAt");
    expect(page).not.toContain("bangkokInput(row.expectedEndAt");
    expect(css).toContain('.attendance-supervisor-v4__row-actions');
    expect(css).toContain('.attendance-supervisor-v4__onbehalf-btn');
  });

  it('supports retrospective manual Attendance confirmation by Employee and Work Date', () => {
    expect(page).toContain('type ManualConfirmationDialog');
    expect(page).toContain('คีย์ยืนยันมาปฏิบัติงานย้อนหลัง');
    expect(page).toContain('openManualConfirmation');
    expect(page).toContain('saveManualConfirmation');
    expect(page).toContain('date: manualDialog.workDate');
    expect(page).toContain('employeeId: manualDialog.employeeId');
    expect(page).toContain("requestType: 'CONFIRM_WORK_PERFORMED'");
    expect(page).toContain("manualDialog.workDate > today");
    expect(page).toContain('shiftDate(manualDialog.workDate, 1)');
    expect(page).toContain('ไม่พบตารางงานของพนักงานในวันที่เลือก');
    expect(page).toContain('รอ ADMIN อนุมัติเป็นขั้นสุดท้าย');
    expect(page).toContain('await approveAttendanceAdjustment(token, requestId)');
    expect(page).toContain('บันทึกและอนุมัติ');
    expect(css).toContain('.attendance-supervisor-v4__manual-btn');
  });

  it('adds a dedicated approval queue with explicit ADMIN approve return and reject actions', () => {
    expect(page).toContain("type Mode = 'daily' | 'history' | 'requests'");
    expect(page).toContain('คำขอแก้ไข');
    expect(page).toContain("admin ? 'คิวอนุมัติการลงเวลา' : 'คำขอแก้ไขการลงเวลา'");
    expect(page).toContain('Before');
    expect(page).toContain('After');
    expect(page).toContain('อนุมัติและให้มีผล');
    expect(page).toContain('ส่งกลับให้แก้ไข');
    expect(page).toContain('ยืนยันไม่อนุมัติ');
    expect(page).toContain("admin && ['PENDING_ADMIN', 'PENDING_APPROVAL'].includes(request.status)");
    expect(page).toContain('openQueueDetail');
    expect(page).toContain('ไทม์ไลน์การอนุมัติ');
    expect(page).toContain("REVIEWED: 'ตรวจและส่งต่อ'");
    expect(page).toContain('ส่งต่อผู้จัดการ');
    expect(page).toContain('ส่งต่อ ADMIN');
  });

  it('keeps ordinary adjustment review explicit while allowing Admin to finalize manual retrospective confirmation', () => {
    expect(page).toContain('await createAttendanceAdjustment');
    expect(page).toContain('await submitAttendanceAdjustment');
    expect(page).toContain('ยังไม่มีผลต่อ Attendance จนกว่าจะกดอนุมัติแยกต่างหาก');
    expect(page).toContain('if (admin)');
    expect(page).toContain('await approveAttendanceAdjustment(token, requestId)');
    expect(page).toContain("setRequestStatus('APPROVED')");
  });

  it('exposes private Attendance evidence only through the authenticated scoped viewer path', () => {
    expect(client).toContain('/attendance/evidence/');
    expect(client).toContain('/view');
    expect(page).toContain('attendanceEvidenceView');
    expect(page).toContain('ดูหลักฐาน');
    expect(page).toContain('event.evidence?.purgedAt');
    expect(page).not.toContain('storageObjectKey');
    expect(page).not.toContain('checksum');
    expect(css).toContain('.attendance-supervisor-v4__evidence-view');
  });

  it('uses a responsive corporate control-center visual system', () => {
    expect(css).toContain('.attendance-supervisor-v4__kpis');
    expect(css).toContain('grid-template-columns: repeat(6, minmax(120px, 1fr));');
    expect(css).toContain('.attendance-supervisor-v4__workflow-modal');
    expect(css).toContain('.attendance-supervisor-v4__request-card');
    expect(css).toContain('.attendance-supervisor-v4__detail-modal');
    expect(css).toContain('@media (max-width: 820px)');
    expect(css).toContain('@media (max-width: 520px)');
  });
});
