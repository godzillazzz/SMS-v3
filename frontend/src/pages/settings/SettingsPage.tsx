import React, { useEffect, useState } from 'react';
import { DataTableState } from '../../components/ResponsiveDataTable';
import { RequestErrorContent, formatRequestErrorMessage, type RequestErrorInput } from '../../request-error';
import { createLeaveType, updateLeaveType, type LeaveTypeMaster } from '../../leave-type-client';
import { attendancePolicyKeys, type AttendancePolicyForm } from '../../components/attendance-policy-contract';
import { leavePolicyKeys, type LeavePolicyForm } from '../../components/leave-policy-contract';
import { SmsIcon } from '../../components/SmsIcon';
import { SETTINGS_SECTIONS, type SettingsSectionId } from '../../routing';
import { PageHeader, SectionCard } from '../../components/layout';
import '../../styles/settings-page.css';

const AttendancePolicySettingsCard = React.lazy(() => import('../../components/AttendancePolicySettingsCard').then((module) => ({ default: module.AttendancePolicySettingsCard })));
const AttendanceTimePolicySettingsCard = React.lazy(() => import('../../components/AttendanceTimePolicySettingsCard').then((module) => ({ default: module.AttendanceTimePolicySettingsCard })));
const LeavePolicySettingsCard = React.lazy(() => import('../../components/LeavePolicySettingsCard').then((module) => ({ default: module.LeavePolicySettingsCard })));
const LeaveTypeMasterPanel = React.lazy(() => import('../../components/LeaveTypeMasterPanel').then((module) => ({ default: module.LeaveTypeMasterPanel })));
const AutoSchedulePatternPanel = React.lazy(() => import('../../components/AutoSchedulePatternPanel').then((module) => ({ default: module.AutoSchedulePatternPanel })));
const ApprovalAuthorityMatrixPanel = React.lazy(() => import('../../components/ApprovalAuthorityMatrixPanel').then((module) => ({ default: module.ApprovalAuthorityMatrixPanel })));
const PersonnelMasterPanel = React.lazy(() => import('../../components/PersonnelMasterPanel').then((module) => ({ default: module.PersonnelMasterPanel })));
const DataRetentionCenterPanel = React.lazy(() => import('../../components/DataRetentionCenterPanel').then((module) => ({ default: module.DataRetentionCenterPanel })));
const ConfigurationRegistryPanel = React.lazy(() => import('../../components/ConfigurationRegistryPanel').then((module) => ({ default: module.ConfigurationRegistryPanel })));
const NotificationCenterPanel = React.lazy(() => import('../../components/NotificationCenterPanel').then((module) => ({ default: module.NotificationCenterPanel })));

type DataRow = Record<string, unknown>;
type CreateLeaveTypeInput = { code: string; name: string; quotaBucket: LeaveTypeMaster['quotaBucket']; isActive?: boolean; sortOrder?: number };
type UpdateLeaveTypeInput = Partial<Pick<LeaveTypeMaster, 'name' | 'quotaBucket' | 'isActive' | 'sortOrder'>>;

const defaultNewLeaveTemplate = `🔔 [คำขอลางานใหม่] รอตรวจรับเอกสาร
--------------------------------
👤 พนักงาน: {Name}
📍 แผนก/พื้นที่: {Department}
📋 ประเภท: {Type} ({Days} วัน)
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}
📎 ไฟล์แนบ: {FileUrl}
--------------------------------
⚙️ จัดการใบลาคลิกที่ระบบ Security Management System`;
const defaultLeaveStatusTemplate = `📢 [อัปเดตสถานะใบลาจากระบบ]
--------------------------------
👤 พนักงาน: {Name}
📋 ประเภท: {Type} ({Days} วัน)
🔄 ผลการตรวจรับ: {Status}
📅 วันที่: {StartDate} ถึง {EndDate}
📝 เหตุผล: {Reason}`;

function csvValue(value: unknown) {
  return `"${(value && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '')).replace(/"/g, '""')}"`;
}

function downloadCsv(rows: DataRow[], filename: string) {
  if (!rows.length) return;
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const csv = [`\uFEFF${headers.map(csvValue).join(',')}`, ...rows.map((row) => headers.map((header) => csvValue(row[header])).join(','))].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${filename}.csv`; anchor.click(); URL.revokeObjectURL(url);
}

export function SettingsPage({ token, settings, leaveTypes, leaveTypesLoading, loading, error, section, onSectionChange, onRefresh, onSaveTemplates, onSaveAttendancePolicy, onSaveLeavePolicy, onCreateLeaveType, onUpdateLeaveType, onAudit }: {
  token: string;
  settings: DataRow[];
  leaveTypes: LeaveTypeMaster[];
  leaveTypesLoading: boolean;
  loading: boolean;
  error?: RequestErrorInput;
  section: SettingsSectionId;
  onSectionChange(section: SettingsSectionId): void;
  onRefresh(): void;
  onSaveTemplates(newLeave: string, leaveStatus: string): Promise<void>;
  onSaveAttendancePolicy(policy: AttendancePolicyForm): Promise<void>;
  onSaveLeavePolicy(policy: LeavePolicyForm): Promise<void>;
  onCreateLeaveType(input: CreateLeaveTypeInput): Promise<void>;
  onUpdateLeaveType(id: string, input: UpdateLeaveTypeInput): Promise<void>;
  onAudit(): void;
}) {
  const readSetting = (key: string, fallback: string) => String(settings.find((setting) => setting.key === key)?.value || fallback);
  const [newLeaveTemplate, setNewLeaveTemplate] = useState(defaultNewLeaveTemplate);
  const [leaveStatusTemplate, setLeaveStatusTemplate] = useState(defaultLeaveStatusTemplate);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string>();
  useEffect(() => {
    setNewLeaveTemplate(readSetting('LINE_TEMPLATE_NEW_LEAVE', defaultNewLeaveTemplate));
    setLeaveStatusTemplate(readSetting('LINE_TEMPLATE_LEAVE_STATUS', defaultLeaveStatusTemplate));
  }, [settings]);
  const exportableSettings = settings
    .filter((setting) => setting.registryStatus === 'REGISTERED' && Boolean(setting.configured))
    .map((setting) => ({
      key: setting.key,
      value: setting.value,
      group: setting.group,
      valueType: setting.valueType,
      configured: setting.configured,
      description: setting.description,
      updatedAt: setting.updatedAt
    }));
  const saveTemplates = async () => {
    setSaving(true); setNotice(undefined);
    try { await onSaveTemplates(newLeaveTemplate, leaveStatusTemplate); setNotice('บันทึกเทมเพลตการแจ้งเตือนสำเร็จแล้ว'); }
    catch (reason) { setNotice(formatRequestErrorMessage(reason, 'บันทึกเทมเพลตไม่สำเร็จ')); }
    finally { setSaving(false); }
  };
  const currentSection = SETTINGS_SECTIONS.find((item) => item.id === section) || SETTINGS_SECTIONS[0];
  const sectionContent = section === 'overview'
    ? loading ? <div className="loading-row" role="status">กำลังอ่านรายการตั้งค่าระบบ…</div> : <ConfigurationRegistryPanel settings={settings} />
    : section === 'attendance-location'
      ? loading ? <div className="loading-row" role="status">กำลังอ่านนโยบายการลงเวลา…</div> : <><AttendancePolicySettingsCard settings={settings} onSave={onSaveAttendancePolicy} onRefresh={onRefresh} /><AttendanceTimePolicySettingsCard token={token} /></>
      : section === 'leave-policy'
        ? loading ? <div className="loading-row" role="status">กำลังอ่านนโยบายการลา…</div> : <LeavePolicySettingsCard settings={settings} onSave={onSaveLeavePolicy} onRefresh={onRefresh} />
        : section === 'leave-types'
          ? <LeaveTypeMasterPanel items={leaveTypes} loading={leaveTypesLoading} onCreate={onCreateLeaveType} onUpdate={onUpdateLeaveType} onRefresh={onRefresh} />
          : section === 'auto-schedule'
            ? <AutoSchedulePatternPanel token={token} />
            : section === 'departments-positions'
              ? <PersonnelMasterPanel token={token} />
              : section === 'approval-permissions'
                ? <ApprovalAuthorityMatrixPanel token={token} />
                : section === 'data-retention'
                  ? <DataRetentionCenterPanel token={token} />
      : section === 'notifications' ? <><NotificationCenterPanel token={token} /><section className="line-settings-card">
      <div className="line-settings-title"><span aria-hidden="true"><SmsIcon name="bell" size={20} /></span><div><h2>ตั้งค่าการแจ้งเตือน LINE</h2><p>รูปแบบเดิมถูกคงไว้ แต่ credential ต้องตั้งค่าที่ Vercel Environment Variables เท่านั้น</p></div></div>
      <div className="line-secure-grid"><label className="field-group"><span>LINE Access Token / Channel Access Token</span><span className="line-secret-managed" role="status">จัดการผ่าน Vercel Environment Variables</span><small>ระบบไม่แสดงค่า credential ในหน้านี้</small></label><label className="field-group"><span>LINE Group ID / Target ID</span><input type="text" value="จัดการผ่าน deployment configuration" disabled /><small>ตั้งค่าจาก Vercel Environment Variables เมื่อเปิดใช้ provider ที่อนุมัติ</small></label></div>
      <div className="line-template-grid"><label className="field-group"><span>เทมเพลตคำขอลางานใหม่ (New Leave Request Template)</span><textarea rows={7} value={newLeaveTemplate} onChange={(event) => setNewLeaveTemplate(event.target.value)} maxLength={2000} /></label><label className="field-group"><span>เทมเพลตอัปเดตสถานะใบลา (Leave Status Update Template)</span><textarea rows={7} value={leaveStatusTemplate} onChange={(event) => setLeaveStatusTemplate(event.target.value)} maxLength={2000} /></label></div>
      <div className="template-help"><strong><SmsIcon name="quality" size={15} /> ตัวแปรที่ใช้ในข้อความได้</strong><span><code>{'{Name}'}</code> พนักงาน</span><span><code>{'{Department}'}</code> แผนก</span><span><code>{'{Type}'}</code> ประเภทการลา</span><span><code>{'{Days}'}</code> จำนวนวัน</span><span><code>{'{StartDate}'}</code> / <code>{'{EndDate}'}</code> วันที่ลา</span><span><code>{'{Reason}'}</code> เหตุผล</span><span><code>{'{FileUrl}'}</code> ไฟล์แนบ</span><span><code>{'{Status}'}</code> สถานะ</span></div>
      {notice && <div className={notice.includes('สำเร็จ') ? 'settings-notice success' : 'settings-notice error'}>{notice}</div>}
      <div className="line-settings-actions"><button type="button" className="btn-primary compact" disabled={saving} onClick={saveTemplates}><SmsIcon name="check" size={15} /> {saving ? 'กำลังบันทึก…' : 'บันทึกเทมเพลตการแจ้งเตือน'}</button><button type="button" className="btn-neutral small-action" disabled title="การส่ง LINE ยังไม่เปิดใช้ใน staging"><SmsIcon name="bell" size={15} /> ทดสอบส่งข้อความแจ้งเตือน</button><button type="button" className="btn-neutral small-action" onClick={onRefresh}><SmsIcon name="refresh" size={15} /> รีเฟรช</button></div>
      <p className="line-settings-footnote">สถานะปัจจุบัน: การส่ง LINE ยังไม่เปิดใช้งานใน staging — การบันทึกด้านบนเก็บเฉพาะเทมเพลตที่ไม่มีข้อมูลลับ</p>
    </section></> : <DataTableState variant="empty" title="ไม่พบหมวดตั้งค่า" description="เลือกหมวดตั้งค่าจากรายการด้านบน" />;
  return <section className="view-pane settings-page layout-page-surface">
    <PageHeader kicker="ตั้งค่าระบบ · ผู้ดูแลระบบ" title={currentSection.label} description={`${currentSection.description} · ค่าที่แก้ได้ถูกกำหนดและตรวจสอบโดยระบบ ส่วน secret และสิทธิ์เชิงปฏิบัติการแยกจาก SystemSetting`} className="settings-heading" actions={<div className="heading-actions">{section === 'overview' && <button type="button" className="btn-neutral small-action" disabled={!exportableSettings.length} onClick={() => downloadCsv(exportableSettings, 'smsv3-governed-settings')}><SmsIcon name="report" size={15} /> ส่งออกค่าที่กำหนด</button>}<button type="button" className="btn-neutral small-action" onClick={onAudit}><SmsIcon name="audit" size={15} /> บันทึกการใช้งาน</button></div>} />
    <SectionCard kicker="หมวดการตั้งค่า" title="เลือกหมวดที่ต้องการจัดการ" description="แต่ละหมวดแสดงเฉพาะการตั้งค่าที่อยู่ในขอบเขตสิทธิ์" className="settings-navigation-card">
      <nav className="settings-section-nav" aria-label="หมวดตั้งค่าระบบ">{SETTINGS_SECTIONS.map((item) => <a key={item.id} href={`/app/settings/${item.path}`} aria-current={item.id === section ? 'page' : undefined} onClick={(event) => { event.preventDefault(); onSectionChange(item.id); }}><strong>{item.label}</strong><small>{item.description}</small></a>)}</nav>
    </SectionCard>
    {error && <div className="alert alert-error"><RequestErrorContent error={error} /></div>}
    <SectionCard kicker="ค่าปัจจุบัน" title={currentSection.label} description={currentSection.description} className="settings-active-section">
      <div className="settings-section-content" data-settings-section={section}>{sectionContent}</div>
    </SectionCard>
  </section>;
}
