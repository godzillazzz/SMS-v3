import type { AuditEvent } from './audit-types';

const sensitiveFragments = ['password', 'secret', 'token', 'authorization', 'cookie', 'otp', 'apikey', 'jwt', 'refresh', 'access', 'database', 'connection', 'storagekey', 'signedurl'];
const actionLabels: Record<string, string> = {
  CREATE: 'สร้างรายการ', UPDATE: 'แก้ไขรายการ', DELETE: 'ลบรายการ', LOGIN: 'เข้าสู่ระบบ', LOGIN_FAILED: 'เข้าสู่ระบบไม่สำเร็จ',
  REFRESH: 'ต่ออายุเซสชัน', LOGOUT: 'ออกจากระบบ', LOGOUT_ALL: 'ออกจากทุกอุปกรณ์', TOKEN_REUSE: 'ตรวจพบการใช้โทเค็นซ้ำ',
  PASSKEY_REGISTERED: 'ลงทะเบียนกุญแจผ่าน', PASSKEY_LOGIN_FAILED: 'เข้าสู่ระบบด้วยกุญแจไม่สำเร็จ', PASSKEY_REVOKED: 'ยกเลิกกุญแจผ่าน',
  APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', SUBMITTED: 'ส่งคำขอแล้ว', RETURNED: 'ส่งกลับแก้ไข', CANCEL: 'ยกเลิกคำขอ'
};
const moduleLabels: Record<string, string> = { LEAVE: 'การลา', LICENSE: 'ใบอนุญาต', SCHEDULE: 'ตารางกะ', USER_ACCESS: 'ผู้ใช้และสิทธิ์', QUOTA: 'โควต้าวันลา', SYSTEM: 'ระบบ', OTHER: 'อื่น ๆ' };
const entityLabels: Record<string, string> = {
  ApprovalAuthorityPolicy: 'นโยบายสิทธิ์อนุมัติ', AttendanceAdjustmentRequest: 'คำขอแก้ไขเวลา', AttendanceCorrection: 'รายการแก้ไขเวลา',
  AttendanceDeviceChangeRequest: 'คำขออุปกรณ์ลงเวลา', AttendanceDeviceEnrollment: 'อุปกรณ์ลงเวลา', AttendanceEvent: 'เหตุการณ์ลงเวลา',
  AttendanceEvidence: 'หลักฐานการลงเวลา', AttendanceMonthCertification: 'การรับรองรอบลงเวลา', AttendancePendingEvent: 'รายการลงเวลารอตรวจ',
  AttendanceTimePolicy: 'นโยบายเวลาเข้างาน', AuthOtpChallenge: 'การยืนยันรหัส OTP', AutoSchedule: 'การจัดกะอัตโนมัติ',
  AutoSchedulePattern: 'รูปแบบจัดกะอัตโนมัติ', DataRetentionCleanupRun: 'รอบลบข้อมูลตามอายุ', DepartmentMaster: 'ข้อมูลแผนก', Employee: 'พนักงาน',
  EmployeeAutoSchedule: 'การจัดกะรายบุคคล', EmployeeChangeRequest: 'คำขอแก้ไขข้อมูลพนักงาน',
  EmployeeChangeRequestRevision: 'ฉบับแก้ไขข้อมูลพนักงาน', EmployeeLicense: 'ใบอนุญาตพนักงาน',
  EmployeeLicenseDocument: 'เอกสารใบอนุญาต', EmployeeLifecycleEvent: 'ประวัติพนักงาน', EmployeeReferencePhoto: 'รูปอ้างอิงพนักงาน',
  FaceVerificationSession: 'การตรวจสอบใบหน้า', G06UatProvisioning: 'การเตรียมบัญชีทดสอบ', LeaveQuota: 'โควต้าวันลา',
  LeaveQuotaLink: 'การเชื่อมโควต้าวันลา', LeaveRequest: 'คำขอลา', LeaveTypeMaster: 'ประเภทการลา', LegacyMigration: 'การย้ายข้อมูลเดิม',
  LicenseOverride: 'การยกเว้นข้อกำหนดใบอนุญาต', LicenseScheduleReconciliation: 'การปรับกะตามใบอนุญาต', PositionMaster: 'ข้อมูลตำแหน่ง',
  NotificationEventPolicy: 'นโยบายการแจ้งเตือน', NotificationTestSend: 'การทดสอบส่งอีเมล', RefreshSession: 'เซสชันเข้าสู่ระบบ',
  RegistrationRequest: 'คำขอลงทะเบียน', RetentionPolicyChange: 'การเปลี่ยนนโยบายเก็บข้อมูล', ScheduleApproval: 'การอนุมัติตารางกะ',
  ScheduleExport: 'การส่งออกตารางกะ', SchedulingRule: 'กฎการจัดกะ', SecuritySite: 'จุดปฏิบัติงาน',
  SecuritySiteDepartment: 'แผนกประจำจุดปฏิบัติงาน', SecuritySiteQrCredential: 'ข้อมูล QR จุดปฏิบัติงาน',
  ShiftAssignment: 'รายการกะ', ShiftType: 'ประเภทกะ', SystemSetting: 'การตั้งค่าระบบ', User: 'ผู้ใช้',
  UserAccessMutation: 'การเปลี่ยนสิทธิ์ผู้ใช้', UserCredential: 'ข้อมูลรับรองผู้ใช้', ViewAsSession: 'เซสชันดูแทนผู้ใช้',
  WebAuthnCredential: 'กุญแจผ่าน'
};
const roleLabels: Record<string, string> = { ADMIN: 'ผู้ดูแลระบบ', MANAGER: 'ผู้จัดการ', SUPERVISOR: 'หัวหน้างาน', VIEWER: 'ผู้ใช้งาน' };
const enumValueLabels: Record<string, string> = {
  ...actionLabels, ...roleLabels,
  ACTIVE: 'ใช้งานอยู่', PENDING: 'รอพิจารณา', PENDING_APPROVAL: 'รออนุมัติ', RETURNED_FOR_CORRECTION: 'ส่งกลับแก้ไข',
  APPROVED: 'อนุมัติแล้ว', REJECTED: 'ไม่อนุมัติ', CANCELLED: 'ยกเลิกแล้ว', REVOKED: 'ยกเลิกการใช้งาน', SUPERSEDED: 'มีฉบับใหม่แทนแล้ว',
  INITIAL: 'ลงทะเบียนอุปกรณ์เครื่องแรก', REPLACEMENT: 'เปลี่ยนอุปกรณ์',
  NOT_REQUIRED: 'ไม่จำเป็น', EXPIRED: 'หมดอายุ', MISSING: 'ไม่พบข้อมูล', INVALID: 'ข้อมูลไม่ถูกต้อง',
  VERIFIED: 'ยืนยันแล้ว', FAILED: 'ไม่สำเร็จ', SECURITY: 'ความปลอดภัย', BUSINESS: 'ธุรกิจ', TECHNICAL: 'ระบบ',
  EMAIL: 'อีเมล', LINE: 'LINE', WEB: 'เว็บเบราว์เซอร์', MOBILE: 'โทรศัพท์มือถือ', DESKTOP: 'คอมพิวเตอร์',
  PASSWORD: 'รหัสผ่าน', OTP: 'รหัส OTP', PASSKEY: 'กุญแจผ่าน', EMAIL_OTP: 'รหัส OTP ทางอีเมล',
  FACE_MATCH_ONLY: 'ตรวจสอบใบหน้า', GEOFENCE_ONLY: 'ตรวจสอบพื้นที่', GEOFENCE_AND_QR: 'ตรวจสอบพื้นที่และ QR',
  ADAPTIVE: 'ปรับตามเงื่อนไข', REQUIRED: 'บังคับใช้', DISABLED: 'ปิดใช้งาน', ENABLED: 'เปิดใช้งาน'
};
const auditEventLabels: Record<string, string> = {
  ADMIN_ANNUAL_QUOTA_CLASSIFIED: 'จัดประเภทโควต้าประจำปี', ADMIN_ANNUAL_QUOTA_CREATED: 'สร้างโควต้าประจำปี', ADMIN_ANNUAL_QUOTA_UPDATED: 'ปรับโควต้าประจำปี',
  ADMIN_REVOKE_CURRENT: 'ผู้ดูแลยกเลิกอุปกรณ์ปัจจุบัน', APPLY_EFFECTIVE: 'เริ่มใช้การเปลี่ยนแปลง', APPROVED: 'อนุมัติแล้ว',
  ATTENDANCE_SIMPLE_ACCEPTED: 'รับข้อมูลลงเวลา', ATTENDANCE_TIME_POLICY_VERSION_CREATED: 'สร้างฉบับนโยบายเวลาเข้างาน',
  AUTO_ANNUAL_QUOTA_PROVISIONED: 'จัดเตรียมโควต้าประจำปีอัตโนมัติ', AUTO_BIND_FIRST_DEVICE: 'ผูกอุปกรณ์เครื่องแรกอัตโนมัติ',
  CANCEL: 'ยกเลิกคำขอ', CONFIRM_DELAYED_OFFLINE_ATTENDANCE: 'ยืนยันรายการลงเวลาออฟไลน์ที่ล่าช้า', DEVICE_PROOF_VERIFIED: 'ยืนยันอุปกรณ์แล้ว',
  EMPLOYEE_MASTER_EDIT: 'แก้ไขข้อมูลพนักงาน', EXPIRE: 'หมดอายุ', FINAL_APPROVE: 'อนุมัติขั้นสุดท้าย',
  GEOFENCE_ONLY_UAT_RECEIPT_ISSUED: 'ออกใบรับรองทดสอบเฉพาะพื้นที่', NOTIFICATION_EMAIL_POLICY_CHANGED: 'เปลี่ยนนโยบายอีเมลแจ้งเตือน',
  NOTIFICATION_TEST_EMAIL_SENT: 'ส่งอีเมลทดสอบ', OBSERVED_FOREIGN_ATTENDANCE_DEVICE: 'พบอุปกรณ์ลงเวลาที่ไม่ได้ผูกไว้',
  OFFLINE_DELAYED_PENDING_CONFIRMATION: 'รายการลงเวลาออฟไลน์รอยืนยัน', OTP_CHALLENGE_CREATED: 'สร้างรหัส OTP', OTP_CHALLENGE_SUPERSEDED: 'แทนที่รหัส OTP',
  PERMANENT_DELETE: 'ลบข้อมูลถาวร', PRIVATE_EVIDENCE_PURGED: 'ลบหลักฐานส่วนบุคคลแล้ว', PRIVATE_EVIDENCE_PURGE_RETRY_REQUIRED: 'ต้องลองลบหลักฐานส่วนบุคคลอีกครั้ง',
  PRIVATE_EVIDENCE_STORED: 'จัดเก็บหลักฐานส่วนบุคคล', PRIVATE_EVIDENCE_VIEW: 'ดูหลักฐานส่วนบุคคล', PROVIDER_SESSION_BOUND: 'เชื่อมเซสชันผู้ให้บริการ',
  REGISTRATION_DUPLICATE_ACCOUNT_BLOCKED: 'ระงับคำขอบัญชีซ้ำ', REGISTRATION_OTP_RESENT: 'ส่งรหัส OTP ใหม่', REGISTRATION_REQUEST_APPROVED: 'อนุมัติคำขอลงทะเบียน',
  REGISTRATION_REQUEST_EMAIL_VERIFIED: 'ยืนยันอีเมลลงทะเบียน', REGISTRATION_REQUEST_MATCHED: 'จับคู่คำขอลงทะเบียนแล้ว', REGISTRATION_REQUEST_REJECTED: 'ไม่อนุมัติคำขอลงทะเบียน',
  REGISTRATION_REQUEST_SUBMITTED: 'ส่งคำขอลงทะเบียน', REJECT: 'ไม่อนุมัติ', REJECTED: 'ไม่อนุมัติ', REJECT_DELAYED_OFFLINE_ATTENDANCE: 'ไม่อนุมัติรายการลงเวลาออฟไลน์ที่ล่าช้า',
  REQUEST_PRIMARY_DEVICE_MOVE: 'ขอย้ายอุปกรณ์หลัก', RESUBMIT: 'ส่งคำขออีกครั้ง', RETENTION_CHANGE_CANCELLED: 'ยกเลิกการเปลี่ยนนโยบายเก็บข้อมูล',
  RETENTION_CHANGE_EFFECTIVE: 'เริ่มใช้นโยบายเก็บข้อมูล', RETURNED: 'ส่งกลับแก้ไข', RETURN_FOR_CORRECTION: 'ส่งกลับแก้ไข', REVISED: 'แก้ไขฉบับข้อมูล',
  SESSION_CREATED: 'สร้างเซสชัน', STORAGE_DELETE_COMPLETE: 'ลบไฟล์จากพื้นที่จัดเก็บแล้ว', STORAGE_DELETE_RETRY_REQUIRED: 'ต้องลองลบไฟล์อีกครั้ง',
  SUBMIT: 'ส่งคำขอ', SUBMITTED: 'ส่งคำขอแล้ว', SUPERSEDE: 'แทนที่ด้วยรายการใหม่', SYSTEM_SETTING_RESTORED: 'คืนค่าการตั้งค่าระบบ', UAT_PROVISION: 'จัดเตรียมข้อมูลทดสอบ',
  VERIFICATION_EXPIRED: 'การตรวจสอบหมดอายุ', VERIFICATION_FAILED: 'การตรวจสอบไม่สำเร็จ', VERIFICATION_RECEIPT_CONSUMED: 'ใช้ผลการตรวจสอบแล้ว',
  VERIFICATION_SUPERSEDED: 'แทนที่ผลการตรวจสอบเดิม', VERIFICATION_VERIFIED: 'ยืนยันการตรวจสอบแล้ว', VIEW: 'ดูรายการ'
};

export const safe = (value: unknown, fallback = 'ไม่ระบุ') => value === undefined || value === null || String(value).trim() === '' ? fallback : String(value);

export function formatAuditTime(value: unknown) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 'ไม่ระบุเวลา' : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(parsed);
}

export function actionLabel(value: unknown) { return actionLabels[safe(value, '')] || (safe(value, '') ? 'เหตุการณ์อื่น' : 'ไม่ระบุ'); }
export function moduleLabel(value: unknown) { return moduleLabels[safe(value, '')] || (safe(value, '') ? 'ระบบอื่น' : 'ไม่ระบุ'); }
export function entityLabel(value: unknown) { return entityLabels[safe(value, '')] || (safe(value, '') ? 'รายการระบบ' : 'ไม่ระบุ'); }
export function auditRoleLabel(value: unknown) { return roleLabels[safe(value, '')] || (safe(value, '') ? 'ผู้ใช้งาน' : 'ไม่ระบุบทบาท'); }
export function auditEventLabel(value: unknown) {
  const event = safe(value, '').trim().toUpperCase();
  return auditEventLabels[event] || enumValueLabels[event] || 'เหตุการณ์ในระบบ';
}

function localizedEnumValue(value: unknown) {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toUpperCase();
  return enumValueLabels[normalized]
    || auditEventLabels[normalized]
    || (/^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/.test(normalized) ? 'ค่าอื่นในระบบ' : undefined);
}

export function isSensitiveMetadataKey(key: unknown) {
  const normalized = String(key || '').toLowerCase().replace(/[_-]/g, '');
  return sensitiveFragments.some((fragment) => normalized.includes(fragment));
}

export function safeMetadataEntries(value: unknown, depth = 0): Array<[string, string]> {
  if (!value || typeof value !== 'object' || depth > 3) return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, nested]): Array<[string, string]> => {
    if (isSensitiveMetadataKey(key)) return [[key, '[REDACTED]']];
    if (nested && typeof nested === 'object') return safeMetadataEntries(nested, depth + 1).map(([childKey, childValue]): [string, string] => [`${key}.${childKey}`, childValue]);
    const rawText = safe(nested, '-');
    const text = localizedEnumValue(rawText) || rawText;
    return [[key, text.length > 180 ? `${text.slice(0, 180)}…` : text]];
  }).slice(0, 24);
}

export function eventLabel(row: AuditEvent) {
  const metadata = row.metadata && typeof row.metadata === 'object' ? row.metadata as Record<string, unknown> : {};
  const event = typeof metadata.event === 'string' ? auditEventLabel(metadata.event) : '';
  return event ? `${actionLabel(row.action)} · ${event}` : actionLabel(row.action);
}

export function metadataSummary(value: unknown) {
  const entries = safeMetadataEntries(value);
  if (!entries.length) return 'ไม่มีรายละเอียดเพิ่มเติม';
  return entries.slice(0, 2).map(([key, nested]) => `${key}: ${nested}`).join(' · ');
}

export function filterAuditEvents(rows: AuditEvent[], search: string) {
  const term = search.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter((row) => [row.action, row.entityType, row.entityId, row.module, row.actor?.displayName, row.actor?.role].map((value) => String(value ?? '')).join(' ').toLowerCase().includes(term));
}

export function summarizeAuditEvents(rows: AuditEvent[]) {
  return { categories: new Set(rows.map((row) => `${String(row.action || '')}:${String(row.entityType || '')}`)).size, actors: new Set(rows.map((row) => `${String(row.actor?.displayName || '')}:${String(row.actor?.role || '')}`)).size };
}
