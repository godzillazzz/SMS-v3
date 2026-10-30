import { useEffect, useMemo, useState } from 'react';
import { flushSync } from 'react-dom';
import { api } from '../../api';
import { RequestErrorContent, toRequestErrorState, type RequestErrorInput } from '../../request-error';
import { printDocument } from '../../schedule-print';
import {
  ExecutiveReportCenterPage,
  ExecutiveReportPrint,
  monthNames,
  type ExecutiveReport,
  type ExecutiveReportFilters
} from '../executive-report/ExecutiveReportCenterPage';
import { AttendanceOfficialReportPanel } from './AttendanceOfficialReport';
import { EmployeeRegisterPrint, LicenseRegisterPrint, type LicenseRecord } from '../../components/personnel/PersonnelPrintForms';
import type { PersonnelRecord } from '../../components/personnel/types';
import { attendanceSupervisorMonthPrint } from '../attendance-supervisor/attendance-supervisor-client';
import { AttendanceMonthToDatePrint, attendanceMonthPrintRows, type AttendanceMonthPrintPayload, type AttendancePrintEmployee, type AttendancePrintRow } from '../attendance-supervisor/AttendanceMonthToDatePrint';
import { collectAllPages, EMPLOYEE_PAGE_SIZE, monthPrintTargetDate } from './report-center-export';
import { patrolApi } from '../patrol/patrol-client';
import { bangkokToday as patrolToday, patrolFetchRange, thaiDate as patrolThaiDate, type PatrolReport } from '../patrol/patrol-model';
import { PatrolReportPrint, type PatrolPrintKind } from '../patrol/PatrolPrint';
import '../patrol/patrol.css';
import '../../styles/personnel-directory.css';
import '../../styles/timesheet-print.css';
import { SmsIcon } from '../../components/SmsIcon';
import { activateTabFromKeyboard } from '../../components/AccessibleTabs';
import { PageHeader, SectionCard } from '../../components/layout';
import '../../styles/report-center.css';

type ReportTab = 'executive' | 'export';

const ATTENDANCE_OFFICIAL_REPORT_ENABLED = import.meta.env.VITE_ATTENDANCE_GOVERNANCE_REPORT_ENABLED === 'true';

function currentBangkokPeriod() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: 'numeric' }).formatToParts(new Date());
  return {
    year: Number(parts.find((part) => part.type === 'year')?.value),
    month: Number(parts.find((part) => part.type === 'month')?.value)
  };
}

function printableFilename(report?: ExecutiveReport, department = '') {
  if (!report) return 'SMS-Executive-Report.pdf';
  const suffix = department ? `-${department.replace(/[^a-zA-Z0-9_-]+/g, '-')}` : '';
  return `SMS-Executive-Report-${report.period.year}-${String(report.period.month).padStart(2, '0')}${suffix}.pdf`;
}

export const REPORT_DEPARTMENT_FILTER_ROLES = ['ADMIN', 'MANAGER', 'SUPERVISOR'];

export function ReportCenterPage({ token, role, onNavigate, initialTab = 'executive', initialEmployeeId }: { token: string; role: string; onNavigate(page: string): void; initialTab?: ReportTab; initialEmployeeId?: string }) {
  const current = currentBangkokPeriod();
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [filters, setFilters] = useState<ExecutiveReportFilters>({ year: current.year, month: current.month, department: '' });
  const [executiveReport, setExecutiveReport] = useState<ExecutiveReport>();
  const [refreshSignal, setRefreshSignal] = useState(0);
  const years = useMemo(() => Array.from({ length: 4 }, (_, index) => current.year - index), [current.year]);
  const departmentOptions = executiveReport?.scope.availableDepartments || [];
  const pdfFilename = printableFilename(executiveReport, filters.department);
  const attendanceMonth = `${filters.year}-${String(filters.month).padStart(2, '0')}`;
  const attendanceMonthLabel = `${monthNames[filters.month - 1] || ''} ${filters.year + 543}`.trim();

  useEffect(() => {
    setExecutiveReport(undefined);
  }, [token]);

  useEffect(() => {
    setExecutiveReport(undefined);
  }, [filters.year, filters.month, filters.department]);

  const [exportBusy, setExportBusy] = useState<string>();
  const [exportNotice, setExportNotice] = useState<RequestErrorInput>();
  const [printEmployees, setPrintEmployees] = useState<PersonnelRecord[]>([]);
  const [printLicenses, setPrintLicenses] = useState<LicenseRecord[]>([]);
  const [printAttendanceRows, setPrintAttendanceRows] = useState<AttendancePrintRow[]>([]);
  const [printAttendanceEmployees, setPrintAttendanceEmployees] = useState<AttendancePrintEmployee[]>([]);
  const [printAttendanceDate, setPrintAttendanceDate] = useState('');
  const [timesheetEmployees, setTimesheetEmployees] = useState<PersonnelRecord[]>([]);
  const [timesheetEmployeeId, setTimesheetEmployeeId] = useState('');
  const [timesheetEmployeesLoaded, setTimesheetEmployeesLoaded] = useState(false);
  const canPatrol = ['ADMIN', 'MANAGER', 'SUPERVISOR'].includes(role);
  // OWNER policy 2026-10-30: MANAGER/SUPERVISOR supervise every department, so they get the same free department filter as ADMIN.
  const canFilterDepartment = REPORT_DEPARTMENT_FILTER_ROLES.includes(role);
  const [patrolDate, setPatrolDate] = useState(() => patrolToday());
  const [patrolDepartment, setPatrolDepartment] = useState('');
  const [patrolDepartments, setPatrolDepartments] = useState<string[]>([]);
  const [patrolPrintJob, setPatrolPrintJob] = useState<{ kind: PatrolPrintKind; report: PatrolReport }>();

  useEffect(() => {
    if (activeTab !== 'export' || !canPatrol) return;
    let active = true;
    patrolApi.checkpoints(token)
      .then((rows) => { if (active) setPatrolDepartments([...new Set(rows.map((row) => row.department))].sort((a, b) => a.localeCompare(b, 'th'))); })
      .catch((reason) => { if (active) setExportNotice(toRequestErrorState(reason, 'ไม่สามารถโหลดรายชื่อแผนกจุดตรวจได้')); });
    return () => { active = false; };
  }, [activeTab, token, canPatrol]);

  const printPatrolAction = async (kind: PatrolPrintKind) => {
    if (kind === 'department' && !patrolDepartment) return;
    const monthFrom = `${patrolDate.slice(0, 8)}01`;
    const from = kind === 'daily' ? patrolDate : monthFrom;
    setExportBusy(`patrol-${kind}`);
    setExportNotice(undefined);
    try {
      const fetched = await patrolApi.report(token, { ...patrolFetchRange(from, patrolDate), department: kind === 'all' ? undefined : patrolDepartment || undefined });
      flushSync(() => setPatrolPrintJob({ kind, report: { ...fetched, from, to: patrolDate } }));
      const label = kind === 'daily' ? 'รายงานการตรวจประจำวัน' : kind === 'department' ? `รายงานการตรวจ-${patrolDepartment}` : 'รายงานการตรวจทุกแผนก';
      await printDocument('.patrol-report-print', `${label}-${from}${from === patrolDate ? '' : `_${patrolDate}`}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch (reason) {
      setExportNotice(toRequestErrorState(reason, 'ไม่สามารถพิมพ์รายงานการตรวจจุดได้'));
    } finally {
      setPatrolPrintJob(undefined);
      setExportBusy(undefined);
    }
  };

  useEffect(() => {
    if (activeTab !== 'export' || timesheetEmployeesLoaded) return;
    let active = true;
    collectAllPages<PersonnelRecord>((pageNumber) => api.employees(token, { page: pageNumber, pageSize: EMPLOYEE_PAGE_SIZE, isActive: true }))
      .then((rows) => { if (active) { setTimesheetEmployees(rows); setTimesheetEmployeesLoaded(true); } })
      .catch((reason) => { if (active) { setTimesheetEmployeesLoaded(true); setExportNotice(toRequestErrorState(reason, 'ไม่สามารถโหลดรายชื่อพนักงานสำหรับพิมพ์ได้')); } });
    return () => { active = false; };
  }, [activeTab, token, timesheetEmployeesLoaded]);

  const timesheetEmployeeOptions = useMemo(() => timesheetEmployees
    .filter((employee) => !filters.department || employee.department === filters.department)
    .sort((left, right) => String(left.employeeCode || '').localeCompare(String(right.employeeCode || ''))), [timesheetEmployees, filters.department]);

  const exportScheduleExcelAction = async () => {
    setExportBusy('schedule');
    setExportNotice(undefined);
    try {
      const result = await api.exportScheduleExcel(token, {
        month: attendanceMonth,
        scope: filters.department ? 'selected' : 'all',
        departments: filters.department ? [filters.department] : []
      });
      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName || `SMS-Schedule-${attendanceMonth}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setExportNotice(toRequestErrorState(reason, 'ไม่สามารถส่งออกตารางกะได้'));
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportPersonnelRegisterAction = async () => {
    setExportBusy('personnel');
    setExportNotice(undefined);
    try {
      const raw = await collectAllPages<PersonnelRecord>((pageNumber) => api.employees(token, { page: pageNumber, pageSize: EMPLOYEE_PAGE_SIZE, department: filters.department || undefined }));
      if (!raw.length) { setExportNotice('ไม่พบข้อมูลพนักงานสำหรับพิมพ์'); return; }
      flushSync(() => setPrintEmployees(raw));
      await printDocument('#personnel-register-print', `ทะเบียนรายชื่อพนักงาน-${attendanceMonth}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch (reason) {
      setExportNotice(toRequestErrorState(reason, 'ไม่สามารถพิมพ์ทะเบียนพนักงานได้'));
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportLicenseRegisterAction = async () => {
    setExportBusy('licenses');
    setExportNotice(undefined);
    try {
      const allLicenses = await collectAllPages<LicenseRecord>((pageNumber) => api.licenses(token, pageNumber, 'ACTIVE'));
      const raw = filters.department ? allLicenses.filter((license) => license.employee?.department === filters.department) : allLicenses;
      if (!raw.length) { setExportNotice('ไม่พบข้อมูลใบอนุญาตสำหรับพิมพ์'); return; }
      flushSync(() => setPrintLicenses(raw));
      await printDocument('#license-register-print', `ทะเบียนใบอนุญาต-รปภ-${attendanceMonth}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch (reason) {
      setExportNotice(toRequestErrorState(reason, 'ไม่สามารถพิมพ์ทะเบียนใบอนุญาตได้'));
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportAttendanceTimesheetAction = async (singleEmployeeOnly: boolean) => {
    if (singleEmployeeOnly && !timesheetEmployeeId) { setExportNotice('กรุณาเลือกพนักงานก่อนพิมพ์รายบุคคล'); return; }
    const targetDate = monthPrintTargetDate(filters.year, filters.month);
    if (!targetDate) { setExportNotice('เดือนที่เลือกยังไม่เริ่ม จึงยังไม่มีข้อมูลการลงเวลา'); return; }
    setExportBusy(singleEmployeeOnly ? 'timesheet-single' : 'timesheet-all');
    setExportNotice(undefined);
    try {
      const response = await (singleEmployeeOnly
        ? attendanceSupervisorMonthPrint(token, targetDate, timesheetEmployeeId)
        : attendanceSupervisorMonthPrint(token, targetDate)) as { data?: AttendanceMonthPrintPayload };
      if (!response.data || !Array.isArray(response.data.employees)) throw new Error('invalid month print payload');
      let sourceEmployees = response.data.employees;
      if (singleEmployeeOnly) sourceEmployees = sourceEmployees.filter((employee) => employee.id === timesheetEmployeeId);
      else if (filters.department) sourceEmployees = sourceEmployees.filter((employee) => employee.department === filters.department);
      if (!sourceEmployees.length) { setExportNotice('ไม่พบพนักงานในขอบเขตที่เลือกสำหรับพิมพ์'); return; }
      const targetEmployees: AttendancePrintEmployee[] = sourceEmployees.map((employee) => ({
        id: employee.id,
        employeeCode: employee.employeeCode,
        displayName: employee.employeeName,
        department: employee.department,
        isActive: true
      }));
      flushSync(() => {
        setPrintAttendanceDate(targetDate);
        setPrintAttendanceRows(attendanceMonthPrintRows({ ...response.data!, employees: sourceEmployees }));
        setPrintAttendanceEmployees(targetEmployees);
      });
      await printDocument(
        '.attendance-supervisor-print',
        singleEmployeeOnly ? `ใบลงเวลารายบุคคล-${sourceEmployees[0]?.employeeCode || 'staff'}-${attendanceMonth}.pdf` : `ใบลงเวลารายบุคคลทั้งหมด-${attendanceMonth}.pdf`,
        { orientation: 'portrait', margin: '0' }
      );
    } catch (reason) {
      setExportNotice(toRequestErrorState(reason, 'ไม่สามารถพิมพ์ใบลงเวลารายบุคคลได้'));
    } finally {
      setPrintAttendanceRows([]);
      setPrintAttendanceEmployees([]);
      setExportBusy(undefined);
    }
  };

  const exportPdf = () => {
    if (!executiveReport) return;
    void printDocument('.executive-report-print', pdfFilename, { orientation: 'landscape', margin: '12mm' });
  };

  return <section className="report-center-page view-pane nexus-report-intelligence layout-page-surface" aria-label="รายงานและวิเคราะห์">
    <PageHeader kicker="ศูนย์รายงาน" title="รายงานและวิเคราะห์" description="ภาพรวมผลปฏิบัติงานและรายการที่ต้องติดตาม" className="report-center-heading" actions={<div className="report-center-quick-export" aria-label="ส่งออกด่วน"><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></div>} />

    <SectionCard kicker="ตัวกรองรายงาน" title="ช่วงข้อมูล" description="ใช้ช่วงข้อมูลเดียวกันทั้งแท็บภาพรวมและส่งออก" className="report-center-filter-card" aria-label="ตัวกรองรายงาน" actions={<button type="button" className="btn-neutral small-action" onClick={() => { setExecutiveReport(undefined); setRefreshSignal((value) => value + 1); }}><SmsIcon name="refresh" size={16} />รีเฟรชข้อมูล</button>}>
      <div className="report-center-filters">
        <label><span>เดือน</span><select value={filters.month} onChange={(event) => setFilters((value) => ({ ...value, month: Number(event.target.value) }))}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
        <label><span>ปี</span><select value={filters.year} onChange={(event) => setFilters((value) => ({ ...value, year: Number(event.target.value) }))}>{years.map((item) => <option key={item} value={item}>พ.ศ. {item + 543}</option>)}</select></label>
        {canFilterDepartment && <label><span>หน่วยงาน</span><select value={filters.department} onChange={(event) => setFilters((value) => ({ ...value, department: event.target.value }))}><option value="">ทุกหน่วยงาน</option>{departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
      </div>
      {!canFilterDepartment && <p className="report-center-filter-note">ขอบเขตข้อมูลกำหนดโดยเซิร์ฟเวอร์ตามสิทธิ์ของบัญชีของคุณ</p>}
      {activeTab === 'export' && ['ADMIN', 'SUPERVISOR'].includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED && <p className="report-center-filter-note">ใบลงเวลาใช้ Certified Snapshot ตามสิทธิ์ผู้ใช้; SUPERVISOR เห็นข้อมูลเฉพาะแผนกที่ผูกกับบัญชี</p>}
    </SectionCard>

    <div className="report-center-tabs" role="tablist" aria-label="ประเภทรายงาน" onKeyDown={activateTabFromKeyboard}>
      <button id="report-tab-executive" type="button" role="tab" aria-selected={activeTab === 'executive'} aria-controls="report-panel-executive" tabIndex={activeTab === 'executive' ? 0 : -1} className={activeTab === 'executive' ? 'active' : ''} onClick={() => setActiveTab('executive')}>ภาพรวม</button>
      <button id="report-tab-export" type="button" role="tab" aria-selected={activeTab === 'export'} aria-controls="report-panel-export" tabIndex={activeTab === 'export' ? 0 : -1} className={activeTab === 'export' ? 'active' : ''} onClick={() => setActiveTab('export')}>ส่งออก</button>
    </div>

    <div id="report-panel-executive" role="tabpanel" aria-labelledby="report-tab-executive" hidden={activeTab !== 'executive'} className="report-center-tab-panel">
      <ExecutiveReportCenterPage token={token} role={role} onNavigate={onNavigate} filters={filters} onFiltersChange={setFilters} embedded includePrint={false} onReportChange={setExecutiveReport} fetchEnabled={activeTab === 'executive' || activeTab === 'export'} refreshSignal={refreshSignal} />
    </div>

    <div id="report-panel-export" role="tabpanel" aria-labelledby="report-tab-export" hidden={activeTab !== 'export'} className="report-center-tab-panel">
      <SectionCard kicker="ส่งออกรายงาน" title="รูปแบบที่รองรับ" description="เลือกส่งออกจากข้อมูลและรูปแบบที่ระบบรองรับในปัจจุบัน" className="report-center-export-section">
      {exportNotice && <div className="report-center-state report-center-state--error report-center-export-alert" role="alert"><strong>แจ้งเตือนการส่งออก</strong><RequestErrorContent error={exportNotice} /></div>}
      <div className="report-center-export-groups">
        <section className="report-center-export-group" aria-labelledby="export-group-schedule">
          <header className="report-center-export-group__head"><h3 id="export-group-schedule">ตารางกะ</h3><span>ไฟล์ข้อมูลสำหรับวางแผนกำลังพล</span></header>
          <div className="report-center-export-grid">
            <article className="report-center-export-card report-center-export-card--schedule">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="calendar" size={22} /></div>
              <div className="report-center-export-body">
                <h3>ส่งออกตารางกะ</h3>
                <p>ตารางกะประจำเดือน{attendanceMonthLabel} {filters.department ? `หน่วยงาน ${filters.department}` : 'ทุกหน่วยงาน'}</p>
                <small className="report-center-export-format">Excel (.xlsx)</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'schedule' || undefined} onClick={() => void exportScheduleExcelAction()}>
                {exportBusy === 'schedule' ? 'กำลังส่งออก…' : 'ส่งออกตารางกะ'}
              </button>
            </article>
          </div>
        </section>

        <section className="report-center-export-group" aria-labelledby="export-group-personnel">
          <header className="report-center-export-group__head"><h3 id="export-group-personnel">ทะเบียนบุคลากร</h3><span>เอกสารพิมพ์พร้อมหัวกระดาษมาตรฐาน</span></header>
          <div className="report-center-export-grid">
            <article className="report-center-export-card report-center-export-card--personnel">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="employees" size={22} /></div>
              <div className="report-center-export-body">
                <h3>พิมพ์ทะเบียนพนักงาน</h3>
                <p>รายชื่อพนักงานทั้งหมด พร้อมสรุปสถานะบุคลากร</p>
                <small className="report-center-export-format">PDF · A4 แนวนอน</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'personnel' || undefined} onClick={() => void exportPersonnelRegisterAction()}>
                {exportBusy === 'personnel' ? 'กำลังเตรียม…' : 'พิมพ์ทะเบียนพนักงาน'}
              </button>
            </article>
            <article className="report-center-export-card report-center-export-card--personnel">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="license" size={22} /></div>
              <div className="report-center-export-body">
                <h3>พิมพ์ทะเบียนใบอนุญาต รปภ.</h3>
                <p>เลขที่บัตร วันออกบัตร วันหมดอายุ และสถานะของพนักงานที่ปฏิบัติงาน</p>
                <small className="report-center-export-format">PDF · A4 แนวนอน</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'licenses' || undefined} onClick={() => void exportLicenseRegisterAction()}>
                {exportBusy === 'licenses' ? 'กำลังเตรียม…' : 'พิมพ์ทะเบียนใบอนุญาต'}
              </button>
            </article>
          </div>
        </section>

        <section className="report-center-export-group" aria-labelledby="export-group-attendance">
          <header className="report-center-export-group__head"><h3 id="export-group-attendance">การลงเวลา</h3><span>ใบลงเวลาทำงานรายเดือน 1 คนต่อ 1 หน้า</span></header>
          <div className="report-center-export-grid">
            <article className="report-center-export-card report-center-export-card--attendance">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="attendance" size={22} /></div>
              <div className="report-center-export-body">
                <h3>รายงานการลงเวลารายบุคคลของ รปภ.</h3>
                <p>ใบลงเวลาประจำวันของพนักงานที่เลือก เดือน{attendanceMonthLabel}</p>
                <label className="report-center-export-select"><span>พนักงาน</span><select aria-label="เลือกพนักงานสำหรับพิมพ์รายบุคคล" value={timesheetEmployeeId} disabled={!timesheetEmployeesLoaded} onChange={(event) => setTimesheetEmployeeId(event.target.value)}>
                  <option value="">{timesheetEmployeesLoaded ? `เลือกพนักงาน (${timesheetEmployeeOptions.length} คน)` : 'กำลังโหลดรายชื่อ…'}</option>
                  {timesheetEmployeeOptions.map((employee) => <option key={employee.id} value={employee.id}>{`${employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()} (${employee.employeeCode}${employee.department ? ` · ${employee.department}` : ''})`}</option>)}
                </select></label>
                <small className="report-center-export-format">PDF · A4 แนวตั้ง</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy) || !timesheetEmployeeId} aria-busy={exportBusy === 'timesheet-single' || undefined} onClick={() => void exportAttendanceTimesheetAction(true)}>
                {exportBusy === 'timesheet-single' ? 'กำลังเตรียม…' : 'พิมพ์รายบุคคล'}
              </button>
            </article>
            <article className="report-center-export-card report-center-export-card--attendance">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="history" size={22} /></div>
              <div className="report-center-export-body">
                <h3>รายงานการลงเวลารายบุคคลทั้งหมด</h3>
                <p>ใบลงเวลาของพนักงาน Active ทุกคน{filters.department ? ` หน่วยงาน ${filters.department}` : ''} เดือน{attendanceMonthLabel}</p>
                <small className="report-center-export-format">PDF · A4 แนวตั้ง</small>
                <small className="report-center-export-hint">อาจใช้เวลาประมวลผล 20–30 วินาที</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'timesheet-all' || undefined} onClick={() => void exportAttendanceTimesheetAction(false)}>
                {exportBusy === 'timesheet-all' ? 'กำลังเตรียม…' : 'พิมพ์ทั้งหมด'}
              </button>
            </article>
          </div>
        </section>

        {canPatrol && <section className="report-center-export-group" aria-labelledby="export-group-patrol">
          <header className="report-center-export-group__head"><h3 id="export-group-patrol">การตรวจจุด</h3><span>วันละ 8 รอบ รอบละ 3 ชั่วโมง · หัวกระดาษมาตรฐาน</span></header>
          <div className="report-center-patrol-filters">
            <label className="report-center-export-select"><span>วันที่</span><input type="date" aria-label="วันที่รายงานการตรวจจุด" value={patrolDate} max={patrolToday()} onChange={(event) => event.target.value && setPatrolDate(event.target.value)} /></label>
            <label className="report-center-export-select"><span>แผนก</span><select aria-label="แผนกสำหรับรายงานการตรวจจุด" value={patrolDepartment} onChange={(event) => setPatrolDepartment(event.target.value)}><option value="">ทุกแผนก</option>{patrolDepartments.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
          </div>
          <div className="report-center-export-grid">
            <article className="report-center-export-card report-center-export-card--patrol">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="clock" size={22} /></div>
              <div className="report-center-export-body">
                <h3>รายงานการตรวจจุดประจำวัน</h3>
                <p>วันที่ {patrolThaiDate(patrolDate)} {patrolDepartment ? `แผนก ${patrolDepartment}` : 'ทุกแผนก'} · ตาราง 8 รอบและรายการสแกนตามเวลา</p>
                <small className="report-center-export-format">PDF · A4 แนวนอน</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'patrol-daily' || undefined} onClick={() => void printPatrolAction('daily')}>{exportBusy === 'patrol-daily' ? 'กำลังเตรียม…' : 'พิมพ์ประจำวัน'}</button>
            </article>
            <article className="report-center-export-card report-center-export-card--patrol">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="employees" size={22} /></div>
              <div className="report-center-export-body">
                <h3>รายงานการตรวจจุดรายแผนก</h3>
                <p>{patrolDepartment ? `แผนก ${patrolDepartment} · ตั้งแต่ต้นเดือนถึง ${patrolThaiDate(patrolDate)}` : 'เลือกแผนกด้านบนก่อน'}</p>
                <small className="report-center-export-format">PDF · A4 แนวนอน</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy) || !patrolDepartment} aria-busy={exportBusy === 'patrol-department' || undefined} onClick={() => void printPatrolAction('department')}>{exportBusy === 'patrol-department' ? 'กำลังเตรียม…' : 'พิมพ์รายแผนก'}</button>
            </article>
            <article className="report-center-export-card report-center-export-card--patrol">
              <div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="report" size={22} /></div>
              <div className="report-center-export-body">
                <h3>รายงานการตรวจจุดทุกแผนก</h3>
                <p>สรุปรอบที่ตรวจครบแยกแผนก ตั้งแต่ต้นเดือนถึง {patrolThaiDate(patrolDate)}</p>
                <small className="report-center-export-format">PDF · A4 แนวนอน</small>
              </div>
              <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} aria-busy={exportBusy === 'patrol-all' || undefined} onClick={() => void printPatrolAction('all')}>{exportBusy === 'patrol-all' ? 'กำลังเตรียม…' : 'พิมพ์ทุกแผนก'}</button>
            </article>
          </div>
        </section>}

        <section className="report-center-export-group" aria-labelledby="export-group-executive">
          <header className="report-center-export-group__head"><h3 id="export-group-executive">ผู้บริหาร</h3><span>สรุปภาพรวมตามตัวกรองด้านบน</span></header>
          <div className="report-center-export-grid">
            <article className="report-center-export-card report-center-export-card--executive"><div className="report-center-export-icon" aria-hidden="true"><SmsIcon name="report" size={22} /></div><div className="report-center-export-body"><h3>รายงานผู้บริหาร PDF</h3><p>ใช้ข้อมูลและตัวกรองเดียวกับแท็บภาพรวม พร้อมรูปแบบเอกสาร A4 ที่มีอยู่เดิม</p><small className="report-center-export-format">PDF · A4</small></div><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></article>
            {['ADMIN', 'SUPERVISOR'].includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED && <AttendanceOfficialReportPanel token={token} month={attendanceMonth} role={role} enabled={activeTab === 'export'} initialEmployeeId={initialEmployeeId} />}
          </div>
        </section>
      </div>
      {!executiveReport && <div className="report-center-state" role="status"><strong>กำลังเตรียมข้อมูลสำหรับส่งออก</strong><span>รอข้อมูล Executive Report จาก API เดิม</span></div>}
      </SectionCard>
    </div>

    {printEmployees.length > 0 && <div className="personnel-print-source"><EmployeeRegisterPrint rows={printEmployees} /></div>}
    {printLicenses.length > 0 && <div className="personnel-print-source"><LicenseRegisterPrint rows={printLicenses} /></div>}
    {printAttendanceEmployees.length > 0 && printAttendanceDate && <AttendanceMonthToDatePrint date={printAttendanceDate} employees={printAttendanceEmployees} rows={printAttendanceRows} />}
    {executiveReport && <ExecutiveReportPrint report={executiveReport} />}
    {patrolPrintJob && <PatrolReportPrint kind={patrolPrintJob.kind} report={patrolPrintJob.report} />}
  </section>;
}
