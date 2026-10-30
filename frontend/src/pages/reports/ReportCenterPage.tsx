import { useEffect, useMemo, useState } from 'react';
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
import { SmsIcon, type SmsIconName } from '../../components/SmsIcon';
import { activateTabFromKeyboard } from '../../components/AccessibleTabs';
import { PageHeader, SectionCard } from '../../components/layout';
import '../../styles/report-center.css';

type ReportTab = 'executive' | 'details' | 'export';
type ReportSummary = Record<string, unknown>;

const ATTENDANCE_OFFICIAL_REPORT_ENABLED = import.meta.env.VITE_ATTENDANCE_GOVERNANCE_REPORT_ENABLED === 'true';

const summaryCards: Array<[string, keyof ReportSummary, SmsIconName]> = [
  ['พนักงานทั้งหมด', 'employees', 'employees'],
  ['พนักงานที่ใช้งาน', 'activeEmployees', 'check'],
  ['ใบอนุญาต', 'licenses', 'license'],
  ['รายการกะ', 'shifts', 'calendar'],
  ['คำขอลา', 'leaveRequests', 'leave'],
  ['โควตาวันลา', 'leaveQuotas', 'quota'],
  ['บัญชีผู้ใช้', 'users', 'users']
];

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

export function ReportCenterPage({ token, role, onNavigate, initialTab = 'executive', initialEmployeeId }: { token: string; role: string; onNavigate(page: string): void; initialTab?: ReportTab; initialEmployeeId?: string }) {
  const current = currentBangkokPeriod();
  const [activeTab, setActiveTab] = useState<ReportTab>(initialTab);
  const [filters, setFilters] = useState<ExecutiveReportFilters>({ year: current.year, month: current.month, department: '' });
  const [executiveReport, setExecutiveReport] = useState<ExecutiveReport>();
  const [summary, setSummary] = useState<ReportSummary>();
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<RequestErrorInput>();
  const [summaryRefresh, setSummaryRefresh] = useState(0);
  const [summaryLoaded, setSummaryLoaded] = useState(false);
  const years = useMemo(() => Array.from({ length: 4 }, (_, index) => current.year - index), [current.year]);
  const departmentOptions = executiveReport?.scope.availableDepartments || [];
  const pdfFilename = printableFilename(executiveReport, filters.department);
  const attendanceMonth = `${filters.year}-${String(filters.month).padStart(2, '0')}`;

  useEffect(() => {
    setSummary(undefined);
    setSummaryError(undefined);
    setSummaryLoaded(false);
    setExecutiveReport(undefined);
  }, [token]);

  useEffect(() => {
    setExecutiveReport(undefined);
  }, [filters.year, filters.month, filters.department]);

  useEffect(() => {
    setSummary(undefined);
    setSummaryError(undefined);
    setSummaryLoaded(false);
  }, [filters.year, filters.month, filters.department]);

  useEffect(() => {
    if (activeTab !== 'details' || summaryLoaded) return;
    let active = true;
    setSummaryLoading(true);
    setSummaryError(undefined);
    api.reportSummary(token, { year: filters.year, month: filters.month, department: filters.department || undefined })
      .then((response) => { if (active) { setSummary((!Array.isArray(response.data) ? response.data : {}) as ReportSummary); setSummaryLoaded(true); } })
      .catch((reason) => { if (active) { setSummaryLoaded(true); setSummaryError(toRequestErrorState(reason, 'ไม่สามารถโหลดรายงานรายละเอียดได้ กรุณาลองใหม่อีกครั้ง')); } })
      .finally(() => { if (active) setSummaryLoading(false); });
    return () => { active = false; };
  }, [activeTab, token, summaryRefresh, summaryLoaded, filters.year, filters.month, filters.department]);

  const [exportBusy, setExportBusy] = useState<string>();
  const [exportNotice, setExportNotice] = useState<string>();
  const [printEmployees, setPrintEmployees] = useState<PersonnelRecord[]>([]);
  const [printLicenses, setPrintLicenses] = useState<LicenseRecord[]>([]);
  const [printAttendanceRows, setPrintAttendanceRows] = useState<AttendancePrintRow[]>([]);
  const [printAttendanceEmployees, setPrintAttendanceEmployees] = useState<AttendancePrintEmployee[]>([]);

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
    } catch {
      setExportNotice('ไม่สามารถส่งออกตารางกะได้');
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportPersonnelRegisterAction = async () => {
    setExportBusy('personnel');
    setExportNotice(undefined);
    try {
      const response = await api.employees(token, { page: 1, pageSize: 500, department: filters.department || undefined });
      const raw = Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.rows) ? response.data.rows : [];
      if (!raw.length) { setExportNotice('ไม่พบข้อมูลพนักงานสำหรับพิมพ์'); return; }
      setPrintEmployees(raw);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await printDocument('#personnel-register-print', `ทะเบียนรายชื่อพนักงาน-${attendanceMonth}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch {
      setExportNotice('ไม่สามารถพิมพ์ทะเบียนพนักงานได้');
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportLicenseRegisterAction = async () => {
    setExportBusy('licenses');
    setExportNotice(undefined);
    try {
      const response = await api.licenses(token, 1, 'ALL');
      const raw = Array.isArray(response?.data) ? response.data : Array.isArray(response?.data?.rows) ? response.data.rows : [];
      if (!raw.length) { setExportNotice('ไม่พบข้อมูลใบอนุญาตสำหรับพิมพ์'); return; }
      setPrintLicenses(raw);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      await printDocument('#license-register-print', `ทะเบียนใบอนุญาต-รปภ-${attendanceMonth}.pdf`, { orientation: 'landscape', margin: '10mm' });
    } catch {
      setExportNotice('ไม่สามารถพิมพ์ทะเบียนใบอนุญาตได้');
    } finally {
      setExportBusy(undefined);
    }
  };

  const exportAttendanceTimesheetAction = async (singleEmployeeOnly: boolean) => {
    setExportBusy(singleEmployeeOnly ? 'timesheet-single' : 'timesheet-all');
    setExportNotice(undefined);
    try {
      const todayText = `${filters.year}-${String(filters.month).padStart(2, '0')}-01`;
      // Use month end or current date
      const lastDay = new Date(Date.UTC(filters.year, filters.month, 0)).getUTCDate();
      const targetDate = `${filters.year}-${String(filters.month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
      const response = await attendanceSupervisorMonthPrint(token, targetDate) as { data?: AttendanceMonthPrintPayload };
      if (!response.data || !Array.isArray(response.data.employees) || !response.data.employees.length) {
        setExportNotice('ไม่พบข้อมูลการลงเวลาสำหรับพิมพ์');
        return;
      }
      let sourceEmployees = response.data.employees;
      if (filters.department) {
        sourceEmployees = sourceEmployees.filter((e) => e.department === filters.department);
      }
      if (singleEmployeeOnly) {
        sourceEmployees = sourceEmployees.slice(0, 1);
      }
      if (!sourceEmployees.length) {
        setExportNotice('ไม่พบพนักงานในขอบเขตที่เลือกสำหรับพิมพ์');
        return;
      }
      const targetEmployees: AttendancePrintEmployee[] = sourceEmployees.map((e) => ({
        id: e.id,
        employeeCode: e.employeeCode,
        displayName: e.employeeName,
        department: e.department,
        isActive: true
      }));
      setPrintAttendanceRows(attendanceMonthPrintRows({ ...response.data, employees: sourceEmployees }));
      setPrintAttendanceEmployees(targetEmployees);
      let ready = false;
      for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
        if (document.querySelector('.attendance-supervisor-print .attendance-supervisor-print-page')) {
          ready = true;
          break;
        }
      }
      if (!ready) throw new Error('ไม่สามารถเตรียมข้อมูลสำหรับพิมพ์ได้');
      await printDocument(
        '.attendance-supervisor-print',
        singleEmployeeOnly ? `ใบลงเวลารายบุคคล-${sourceEmployees[0]?.employeeCode || 'staff'}-${attendanceMonth}.pdf` : `ใบลงเวลารายบุคคลทั้งหมด-${attendanceMonth}.pdf`,
        { orientation: 'portrait', margin: '0' }
      );
    } catch {
      setExportNotice('ไม่สามารถพิมพ์ใบลงเวลารายบุคคลได้');
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
    <PageHeader kicker="ศูนย์รายงาน" title="รายงานและวิเคราะห์" description="สรุปข้อมูลปฏิบัติงานและส่งออกรายงานจากข้อมูล API ที่มีอยู่" className="report-center-heading" actions={(activeTab === 'executive' || activeTab === 'export') ? <div className="report-center-quick-export" aria-label="ส่งออกด่วน"><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></div> : undefined} />

    <SectionCard kicker="ตัวกรองรายงาน" title="ช่วงรายงาน" description="คงค่าตัวกรองไว้เมื่อสลับแท็บที่รองรับ" className="report-center-filter-card" aria-label="ตัวกรองรายงาน">
      <div className="report-center-filters">
        <label><span>เดือน</span><select value={filters.month} onChange={(event) => setFilters((value) => ({ ...value, month: Number(event.target.value) }))}>{monthNames.map((name, index) => <option value={index + 1} key={name}>{name}</option>)}</select></label>
        <label><span>ปี</span><select value={filters.year} onChange={(event) => setFilters((value) => ({ ...value, year: Number(event.target.value) }))}>{years.map((item) => <option key={item} value={item}>พ.ศ. {item + 543}</option>)}</select></label>
        {role === 'ADMIN' && <label><span>หน่วยงาน</span><select value={filters.department} onChange={(event) => setFilters((value) => ({ ...value, department: event.target.value }))}><option value="">ทุกหน่วยงาน</option>{departmentOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>}
      </div>
      {activeTab === 'details' && <p className="report-center-filter-note">รายงานรายละเอียดใช้ช่วงเดือน/ปีและขอบเขตหน่วยงานเดียวกับตัวกรองด้านบน โดยคำนวณจากข้อมูลฝั่งเซิร์ฟเวอร์</p>}
      {activeTab === 'export' && ['ADMIN', 'SUPERVISOR'].includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED && <p className="report-center-filter-note">ใบลงเวลาใช้ Certified Snapshot ตามสิทธิ์ผู้ใช้; SUPERVISOR เห็นข้อมูลเฉพาะแผนกที่ผูกกับบัญชี</p>}
    </SectionCard>

    <div className="report-center-tabs" role="tablist" aria-label="ประเภทรายงาน" onKeyDown={activateTabFromKeyboard}>
      <button id="report-tab-executive" type="button" role="tab" aria-selected={activeTab === 'executive'} aria-controls="report-panel-executive" tabIndex={activeTab === 'executive' ? 0 : -1} className={activeTab === 'executive' ? 'active' : ''} onClick={() => setActiveTab('executive')}>ภาพรวมผู้บริหาร</button>
      <button id="report-tab-details" type="button" role="tab" aria-selected={activeTab === 'details'} aria-controls="report-panel-details" tabIndex={activeTab === 'details' ? 0 : -1} className={activeTab === 'details' ? 'active' : ''} onClick={() => setActiveTab('details')}>รายงานรายละเอียด</button>
      <button id="report-tab-export" type="button" role="tab" aria-selected={activeTab === 'export'} aria-controls="report-panel-export" tabIndex={activeTab === 'export' ? 0 : -1} className={activeTab === 'export' ? 'active' : ''} onClick={() => setActiveTab('export')}>ส่งออก</button>
    </div>

    <div id="report-panel-executive" role="tabpanel" aria-labelledby="report-tab-executive" hidden={activeTab !== 'executive'} className="report-center-tab-panel">
      <ExecutiveReportCenterPage token={token} role={role} onNavigate={onNavigate} filters={filters} onFiltersChange={setFilters} embedded includePrint={false} onReportChange={setExecutiveReport} fetchEnabled={activeTab === 'executive' || activeTab === 'export'} />
    </div>

    <div id="report-panel-details" role="tabpanel" aria-labelledby="report-tab-details" hidden={activeTab !== 'details'} className="report-center-tab-panel">
      <SectionCard kicker="รายงานรายละเอียด" title="สรุปข้อมูลปฏิบัติงาน" description="ใช้ชุดข้อมูลและ API เดิม โดยไม่เปลี่ยนสูตรคำนวณ" className="report-center-section-heading" actions={<button type="button" className="btn-neutral small-action" disabled={summaryLoading} onClick={() => { setSummaryLoaded(false); setSummaryRefresh((value) => value + 1); }}><SmsIcon name="refresh" size={16} />รีเฟรช</button>}>
      {summaryLoading && <div className="report-center-state" role="status">กำลังสรุปข้อมูล…</div>}
      {summaryError && <div className="report-center-state report-center-state--error" role="alert"><strong>ไม่สามารถโหลดรายงานรายละเอียด</strong><RequestErrorContent error={summaryError} /></div>}
      {!summaryLoading && !summaryError && summary && <div className="metrics-grid report-grid">{summaryCards.map(([label, key, icon]) => <article className="metric-card" key={String(key)}><span className="metric-icon blue" aria-hidden="true"><SmsIcon name={icon} size={18} /></span><div><p>{label}</p><strong>{String(summary[key] ?? 0)}</strong><small>ตามช่วงและขอบเขตที่เลือก</small></div></article>)}</div>}
      {!summaryLoading && !summaryError && summary && summaryCards.every(([, key]) => Number(summary[key] || 0) === 0) && <div className="report-center-state"><strong>ยังไม่มีข้อมูลสรุป</strong><span>ไม่พบรายการในชุดข้อมูลรายงานปัจจุบัน</span></div>}
      </SectionCard>
    </div>

    <div id="report-panel-export" role="tabpanel" aria-labelledby="report-tab-export" hidden={activeTab !== 'export'} className="report-center-tab-panel">
      <SectionCard kicker="ส่งออกรายงาน" title="รูปแบบที่รองรับ" description="เลือกส่งออกจากข้อมูลและรูปแบบที่ระบบรองรับในปัจจุบัน" className="report-center-export-section">
      {exportNotice && <div className="report-center-state report-center-state--error" role="alert" style={{ marginBottom: '12px' }}><strong>แจ้งเตือนการส่งออก</strong><span>{exportNotice}</span></div>}
      <div className="report-center-export-grid">
        <article className="report-center-export-card">
          <div className="report-center-export-icon">XLS</div>
          <div>
            <h3>ส่งออกตารางกะ</h3>
            <p>ส่งออกตารางกะการทำงานประจำเดือน {attendanceMonth} ในรูปแบบ Excel (.xlsx) ตามตัวกรองหน่วยงานที่เลือก</p>
            <small>รูปแบบที่รองรับ: Excel (.xlsx)</small>
          </div>
          <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} onClick={() => void exportScheduleExcelAction()}>
            {exportBusy === 'schedule' ? 'กำลังส่งออก…' : 'ส่งออกตารางกะ'}
          </button>
        </article>

        <article className="report-center-export-card">
          <div className="report-center-export-icon">EMP</div>
          <div>
            <h3>พิมพ์ทะเบียนพนักงาน</h3>
            <p>พิมพ์ทะเบียนรายชื่อพนักงาน (EMPLOYEE REGISTER) พร้อมหัวเอกสารมาตรฐานและสรุปสถานะบุคลากร</p>
            <small>รูปแบบที่รองรับ: PDF / Print A4 แนวนอน</small>
          </div>
          <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} onClick={() => void exportPersonnelRegisterAction()}>
            {exportBusy === 'personnel' ? 'กำลังเตรียม…' : 'พิมพ์ทะเบียนพนักงาน'}
          </button>
        </article>

        <article className="report-center-export-card">
          <div className="report-center-export-icon">LIC</div>
          <div>
            <h3>พิมพ์ทะเบียนใบอนุญาต รปภ.</h3>
            <p>พิมพ์ทะเบียนใบอนุญาต รปภ. (ธภ.7) ทั้งหมด พร้อมเลขที่บัตร วันออกบัตร วันหมดอายุ และสถานะ</p>
            <small>รูปแบบที่รองรับ: PDF / Print A4 แนวนอน</small>
          </div>
          <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} onClick={() => void exportLicenseRegisterAction()}>
            {exportBusy === 'licenses' ? 'กำลังเตรียม…' : 'พิมพ์ทะเบียนใบอนุญาต รปภ.'}
          </button>
        </article>

        <article className="report-center-export-card">
          <div className="report-center-export-icon">ATT</div>
          <div>
            <h3>พิมพ์รายงานการลงเวลาประจำวันรายบุคคลของ รปภ.</h3>
            <p>พิมพ์ใบลงเวลาทำงานรายบุคคล (Monthly Timesheet) ตัดรอบประจำเดือน {attendanceMonth} (1 คน/เดือน/1 ใบ)</p>
            <small>รูปแบบที่รองรับ: PDF / Print A4 แนวตั้ง</small>
          </div>
          <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} onClick={() => void exportAttendanceTimesheetAction(true)}>
            {exportBusy === 'timesheet-single' ? 'กำลังเตรียม…' : 'พิมพ์รายงานประจำวันรายบุคคล'}
          </button>
        </article>

        <article className="report-center-export-card">
          <div className="report-center-export-icon">ALL</div>
          <div>
            <h3>พิมพ์รายงานการลงเวลารายบุคคลทั้งหมดของพนักงาน</h3>
            <p>พิมพ์ใบลงเวลาทำงานของพนักงานทุกคนที่ Active ในระบบ ประจำเดือน {attendanceMonth} (แยก 1 คน/เดือน/1 ใบ)</p>
            <small>รูปแบบที่รองรับ: PDF / Print A4 แนวตั้ง</small>
          </div>
          <button type="button" className="btn-primary" disabled={Boolean(exportBusy)} onClick={() => void exportAttendanceTimesheetAction(false)}>
            {exportBusy === 'timesheet-all' ? 'กำลังเตรียม…' : 'พิมพ์รายบุคคลทั้งหมด'}
          </button>
        </article>

        <article className="report-center-export-card"><div className="report-center-export-icon">PDF</div><div><h3>รายงานผู้บริหาร PDF</h3><p>ใช้ข้อมูลและตัวกรองเดียวกับแท็บภาพรวมผู้บริหาร พร้อมรูปแบบเอกสาร A4 ที่มีอยู่เดิม</p><small>รูปแบบที่รองรับ: PDF</small></div><button type="button" className="btn-primary" disabled={!executiveReport} onClick={exportPdf}>ส่งออก PDF</button></article>
        {['ADMIN', 'SUPERVISOR'].includes(role) && ATTENDANCE_OFFICIAL_REPORT_ENABLED && <AttendanceOfficialReportPanel token={token} month={attendanceMonth} role={role} enabled={activeTab === 'export'} initialEmployeeId={initialEmployeeId} />}
      </div>
      {!executiveReport && <div className="report-center-state" role="status"><strong>กำลังเตรียมข้อมูลสำหรับส่งออก</strong><span>รอข้อมูล Executive Report จาก API เดิม</span></div>}
      </SectionCard>
    </div>

    {printEmployees.length > 0 && <div className="print-only" style={{ display: 'none' }}><EmployeeRegisterPrint rows={printEmployees} /></div>}
    {printLicenses.length > 0 && <div className="print-only" style={{ display: 'none' }}><LicenseRegisterPrint rows={printLicenses} /></div>}
    {printAttendanceEmployees.length > 0 && <AttendanceMonthToDatePrint date={`${filters.year}-${String(filters.month).padStart(2, '0')}-${String(new Date(Date.UTC(filters.year, filters.month, 0)).getUTCDate()).padStart(2, '0')}`} employees={printAttendanceEmployees} rows={printAttendanceRows} />}
    {executiveReport && <ExecutiveReportPrint report={executiveReport} />}
  </section>;
}
