'use strict';

const { ATTENDANCE_POLICY_KEYS, ATTENDANCE_QR_POLICIES, validateAttendancePolicySetting } = require('./attendance-policy.service');
const { LEAVE_POLICY_KEYS, validateLeavePolicySetting } = require('./leave-policy.service');
const { isReservedOperationalSettingKey } = require('./g03-1-multi-year-activation.service');

const SENSITIVE_SETTING_KEY_PATTERN = /secret|token|password|credential|database|smtp|webhook|channel|access[_-]?key/i;

const GROUPS = Object.freeze({
  ATTENDANCE: Object.freeze({ id: 'ATTENDANCE', label: 'Attendance & Location', order: 10 }),
  LEAVE: Object.freeze({ id: 'LEAVE', label: 'Leave Policy', order: 20 }),
  NOTIFICATIONS: Object.freeze({ id: 'NOTIFICATIONS', label: 'Notifications', order: 30 }),
  LEGACY: Object.freeze({ id: 'LEGACY', label: 'Legacy / Read only', order: 90 }),
  PROTECTED: Object.freeze({ id: 'PROTECTED', label: 'Protected Operations', order: 99 })
});

function frozenDefinition(definition) {
  return Object.freeze({
    editable: true,
    authority: 'ADMIN_GOVERNED',
    source: 'SYSTEM_SETTING',
    ...definition,
    constraints: Object.freeze({ ...(definition.constraints || {}) })
  });
}

const DEFINITIONS = Object.freeze([
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.qrPolicy,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'Attendance QR policy',
    valueType: 'ENUM',
    description: 'Attendance QR policy: ADAPTIVE / REQUIRED / DISABLED',
    constraints: { allowedValues: ATTENDANCE_QR_POLICIES }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.maxAccuracyMeters,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'GPS max accuracy',
    valueType: 'NUMBER',
    description: 'GPS accuracy สูงสุดที่ Attendance ยอมรับ (เมตร)',
    constraints: { min: 5, max: 100, unit: 'meters' }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.maxAgeSeconds,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'GPS sample max age',
    valueType: 'NUMBER',
    description: 'อายุ GPS sample สูงสุด (วินาที)',
    constraints: { min: 30, max: 600, unit: 'seconds' }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.futureSkewSeconds,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'GPS future skew',
    valueType: 'NUMBER',
    description: 'GPS future clock skew สูงสุด (วินาที)',
    constraints: { min: 5, max: 120, unit: 'seconds' }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.autoPassAccuracyMeters,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'Adaptive QR auto-pass accuracy',
    valueType: 'NUMBER',
    description: 'GPS accuracy สำหรับข้าม QR ใน Adaptive mode (เมตร)',
    constraints: { min: 3, max: 50, unit: 'meters' }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.innerMarginMeters,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'Geofence inner margin',
    valueType: 'NUMBER',
    description: 'ระยะจากขอบ geofence ที่ใช้ตัดสิน QR Step-up (เมตร)',
    constraints: { min: 0, max: 100, unit: 'meters' }
  }),
  frozenDefinition({
    key: ATTENDANCE_POLICY_KEYS.stepUpOnSiteOverlap,
    group: GROUPS.ATTENDANCE.id,
    groupLabel: GROUPS.ATTENDANCE.label,
    groupOrder: GROUPS.ATTENDANCE.order,
    label: 'QR step-up on site overlap',
    valueType: 'BOOLEAN',
    description: 'ขอ QR Step-up เมื่อ GPS อยู่ในหลาย Site พร้อมกัน'
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.defaultSickDays,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Default sick leave entitlement',
    valueType: 'NUMBER',
    description: 'สิทธิ์ลาป่วยเริ่มต้นสำหรับโควตารายปีที่สร้างใหม่',
    constraints: { min: 0, max: 999, unit: 'days' }
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.defaultPersonalDays,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Default personal leave entitlement',
    valueType: 'NUMBER',
    description: 'สิทธิ์ลากิจเริ่มต้นสำหรับโควตารายปีที่สร้างใหม่',
    constraints: { min: 0, max: 999, unit: 'days' }
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.defaultVacationDays,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Default vacation leave entitlement',
    valueType: 'NUMBER',
    description: 'สิทธิ์ลาพักร้อนเริ่มต้นสำหรับโควตารายปีที่สร้างใหม่',
    constraints: { min: 0, max: 999, unit: 'days' }
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.sickAttachmentRequiredAfterDays,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Sick leave attachment threshold',
    valueType: 'NUMBER',
    description: 'บังคับแนบเอกสารเมื่อลาป่วยเกินจำนวนวันที่กำหนด',
    constraints: { min: 0, max: 30, unit: 'days' }
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.managerRetroactiveOnBehalfEnabled,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Manager retroactive on-behalf entry',
    valueType: 'BOOLEAN',
    description: 'อนุญาต Manager บันทึกการลาย้อนหลังแทนพนักงานอื่น',
    constraints: {}
  }),
  frozenDefinition({
    key: LEAVE_POLICY_KEYS.managerRetroactiveMaxDaysBack,
    group: GROUPS.LEAVE.id,
    groupLabel: GROUPS.LEAVE.label,
    groupOrder: GROUPS.LEAVE.order,
    label: 'Manager retroactive lookback limit',
    valueType: 'NUMBER',
    description: 'จำนวนวันย้อนหลังสูงสุดสำหรับ Manager; 0 หมายถึงไม่จำกัด',
    constraints: { min: 0, max: 3650, unit: 'days', zeroMeans: 'unlimited' }
  }),
  frozenDefinition({
    key: 'LINE_TEMPLATE_NEW_LEAVE',
    group: GROUPS.NOTIFICATIONS.id,
    groupLabel: GROUPS.NOTIFICATIONS.label,
    groupOrder: GROUPS.NOTIFICATIONS.order,
    label: 'New leave request template',
    valueType: 'TEXT',
    description: 'เทมเพลตข้อความคำขอลาใหม่ (รูปแบบเดิม)',
    constraints: { maxLength: 2000 }
  }),
  frozenDefinition({
    key: 'LINE_TEMPLATE_LEAVE_STATUS',
    group: GROUPS.NOTIFICATIONS.id,
    groupLabel: GROUPS.NOTIFICATIONS.label,
    groupOrder: GROUPS.NOTIFICATIONS.order,
    label: 'Leave status update template',
    valueType: 'TEXT',
    description: 'เทมเพลตข้อความอัปเดตสถานะการลา (รูปแบบเดิม)',
    constraints: { maxLength: 2000 }
  })
]);

const BY_KEY = new Map(DEFINITIONS.map((definition) => [definition.key, definition]));

function getSystemSettingDefinition(key) {
  return BY_KEY.get(String(key || '').trim()) || null;
}

function isSensitiveSystemSettingKey(key) {
  return SENSITIVE_SETTING_KEY_PATTERN.test(String(key || ''));
}

function normalizeRegisteredSystemSettingValue(key, value) {
  const definition = getSystemSettingDefinition(key);
  if (!definition) {
    const error = new Error('System setting key is not registered for Admin configuration.');
    error.code = 'SYSTEM_SETTING_NOT_REGISTERED';
    throw error;
  }

  if (definition.group === GROUPS.ATTENDANCE.id) {
    const normalized = validateAttendancePolicySetting(definition.key, value);
    if (normalized == null) {
      const error = new Error('Attendance policy setting is invalid.');
      error.code = 'SYSTEM_SETTING_VALUE_INVALID';
      throw error;
    }
    return normalized;
  }

  if (definition.group === GROUPS.LEAVE.id) {
    const normalized = validateLeavePolicySetting(definition.key, value);
    if (normalized == null) {
      const error = new Error('Leave policy setting is invalid.');
      error.code = 'SYSTEM_SETTING_VALUE_INVALID';
      throw error;
    }
    return normalized;
  }

  if (definition.valueType === 'TEXT') {
    const text = String(value ?? '');
    const maxLength = Number(definition.constraints.maxLength || 2000);
    if (text.length > maxLength) {
      const error = new Error(`${definition.key} must not exceed ${maxLength} characters.`);
      error.code = 'SYSTEM_SETTING_VALUE_INVALID';
      throw error;
    }
    return text;
  }

  const error = new Error('Unsupported system setting value type.');
  error.code = 'SYSTEM_SETTING_VALUE_INVALID';
  throw error;
}

function registryRow(definition, stored) {
  return {
    key: definition.key,
    value: stored?.value,
    configured: Boolean(stored),
    description: definition.description,
    updatedAt: stored?.updatedAt || null,
    group: definition.group,
    groupLabel: definition.groupLabel,
    groupOrder: definition.groupOrder,
    label: definition.label,
    valueType: definition.valueType,
    editable: true,
    authority: definition.authority,
    source: definition.source,
    registryStatus: 'REGISTERED',
    constraints: definition.constraints
  };
}

function presentRegisteredSystemSetting(row) {
  const definition = getSystemSettingDefinition(row?.key);
  if (!definition) return null;
  return registryRow(definition, row);
}

function protectedOrLegacyRow(row) {
  const key = String(row.key || '');
  const sensitive = isSensitiveSystemSettingKey(key);
  const reserved = isReservedOperationalSettingKey(key);
  return {
    key,
    value: sensitive ? undefined : row.value,
    configured: Boolean(row.value),
    description: row.description,
    updatedAt: row.updatedAt || null,
    group: reserved ? GROUPS.PROTECTED.id : GROUPS.LEGACY.id,
    groupLabel: reserved ? GROUPS.PROTECTED.label : GROUPS.LEGACY.label,
    groupOrder: reserved ? GROUPS.PROTECTED.order : GROUPS.LEGACY.order,
    label: key,
    valueType: sensitive ? 'PROTECTED' : 'LEGACY_TEXT',
    editable: false,
    authority: reserved ? 'PROTECTED_RELEASE_OPERATION' : (sensitive ? 'ENVIRONMENT_ONLY' : 'LEGACY_READ_ONLY'),
    source: reserved ? 'PROTECTED_OPERATIONAL_SETTING' : 'LEGACY_SYSTEM_SETTING',
    registryStatus: reserved ? 'PROTECTED' : 'UNREGISTERED',
    constraints: {}
  };
}

function presentSystemSettings(rows = []) {
  const storedByKey = new Map(rows.map((row) => [String(row.key || ''), row]));
  const registered = DEFINITIONS.map((definition) => registryRow(definition, storedByKey.get(definition.key)));
  const extras = rows
    .filter((row) => !BY_KEY.has(String(row.key || '')))
    .map(protectedOrLegacyRow);

  return [...registered, ...extras].sort((a, b) =>
    Number(a.groupOrder || 999) - Number(b.groupOrder || 999)
    || String(a.label || a.key).localeCompare(String(b.label || b.key))
  );
}

function registeredSystemSettingGroups() {
  return [GROUPS.ATTENDANCE, GROUPS.LEAVE, GROUPS.NOTIFICATIONS].map((group) => ({ ...group }));
}

module.exports = {
  DEFINITIONS,
  GROUPS,
  SENSITIVE_SETTING_KEY_PATTERN,
  getSystemSettingDefinition,
  isSensitiveSystemSettingKey,
  normalizeRegisteredSystemSettingValue,
  presentRegisteredSystemSetting,
  presentSystemSettings,
  registeredSystemSettingGroups
};
