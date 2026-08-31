'use strict';

const prismaDefault = require('../config/prisma');
const auditDefault = require('./audit.service');
const HttpError = require('../utils/http-error');

const AUTO_SCHEDULE_PATTERN_MODES = Object.freeze(['WEEKLY', 'CYCLE']);
const AUTO_SCHEDULE_TARGET_GROUPS = Object.freeze(['SUPERVISOR', 'GENERAL', 'MANUAL']);

const CORE_AUTO_SCHEDULE_PATTERNS = Object.freeze([
  Object.freeze({
    id: 'core-auto-supervisor',
    code: 'SUPERVISOR',
    name: 'กะหัวหน้างาน',
    mode: 'WEEKLY',
    steps: Object.freeze([
      Object.freeze({ phaseCode: 'MON', shiftCode: 'D', label: 'วันจันทร์ · กะเช้า' }),
      Object.freeze({ phaseCode: 'TUE', shiftCode: 'D', label: 'วันอังคาร · กะเช้า' }),
      Object.freeze({ phaseCode: 'WED', shiftCode: 'D', label: 'วันพุธ · กะเช้า' }),
      Object.freeze({ phaseCode: 'THU', shiftCode: 'D', label: 'วันพฤหัสบดี · กะเช้า' }),
      Object.freeze({ phaseCode: 'FRI', shiftCode: 'D', label: 'วันศุกร์ · กะเช้า' }),
      Object.freeze({ phaseCode: 'SAT', shiftCode: 'D', label: 'วันเสาร์ · กะเช้า' }),
      Object.freeze({ phaseCode: 'SUN', shiftCode: 'OFF', label: 'วันอาทิตย์ · วันหยุด' })
    ]),
    isActive: true,
    isSystem: true,
    targetGroup: 'SUPERVISOR',
    sortOrder: 10
  }),
  Object.freeze({
    id: 'core-auto-rotate',
    code: 'ROTATE',
    name: 'กะพนักงานเวียน',
    mode: 'CYCLE',
    steps: Object.freeze([
      Object.freeze({ phaseCode: 'D1', shiftCode: 'D', label: 'กะเช้า วันที่ 1 (D1)' }),
      Object.freeze({ phaseCode: 'D2', shiftCode: 'D', label: 'กะเช้า วันที่ 2 (D2)' }),
      Object.freeze({ phaseCode: 'D3', shiftCode: 'D', label: 'กะเช้า วันที่ 3 (D3)' }),
      Object.freeze({ phaseCode: 'D4', shiftCode: 'D', label: 'กะเช้า วันที่ 4 (D4)' }),
      Object.freeze({ phaseCode: 'D5', shiftCode: 'D', label: 'กะเช้า วันที่ 5 (D5)' }),
      Object.freeze({ phaseCode: 'D6', shiftCode: 'D', label: 'กะเช้า วันที่ 6 (D6)' }),
      Object.freeze({ phaseCode: 'OFF-D', shiftCode: 'OFF', label: 'วันหยุดหลังรอบกะเช้า (OFF-D)' }),
      Object.freeze({ phaseCode: 'N1', shiftCode: 'N', label: 'กะดึก วันที่ 1 (N1)' }),
      Object.freeze({ phaseCode: 'N2', shiftCode: 'N', label: 'กะดึก วันที่ 2 (N2)' }),
      Object.freeze({ phaseCode: 'N3', shiftCode: 'N', label: 'กะดึก วันที่ 3 (N3)' }),
      Object.freeze({ phaseCode: 'N4', shiftCode: 'N', label: 'กะดึก วันที่ 4 (N4)' }),
      Object.freeze({ phaseCode: 'N5', shiftCode: 'N', label: 'กะดึก วันที่ 5 (N5)' }),
      Object.freeze({ phaseCode: 'N6', shiftCode: 'N', label: 'กะดึก วันที่ 6 (N6)' }),
      Object.freeze({ phaseCode: 'OFF-N', shiftCode: 'OFF', label: 'วันหยุดหลังรอบกะดึก (OFF-N)' })
    ]),
    isActive: true,
    isSystem: true,
    targetGroup: 'GENERAL',
    sortOrder: 20
  })
]);

const AUDIT_FIELDS = ['code', 'name', 'mode', 'steps', 'isActive', 'isSystem', 'targetGroup', 'sortOrder'];

function canonicalPatternCode(value) {
  const code = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9_-]{1,40}$/.test(code)) {
    throw new HttpError(400, 'Pattern code must use A-Z, 0-9, underscore, or hyphen.', { code: 'AUTO_SCHEDULE_PATTERN_CODE_INVALID' });
  }
  return code;
}

function canonicalMode(value) {
  const mode = String(value ?? '').trim().toUpperCase();
  if (!AUTO_SCHEDULE_PATTERN_MODES.includes(mode)) {
    throw new HttpError(400, 'Pattern mode must be WEEKLY or CYCLE.', { code: 'AUTO_SCHEDULE_PATTERN_MODE_INVALID' });
  }
  return mode;
}

function canonicalTargetGroup(value) {
  const group = String(value ?? '').trim().toUpperCase();
  if (!AUTO_SCHEDULE_TARGET_GROUPS.includes(group)) {
    throw new HttpError(400, 'Unsupported Auto Schedule target group.', { code: 'AUTO_SCHEDULE_PATTERN_TARGET_INVALID' });
  }
  return group;
}

function normalizePatternSteps(input, modeInput) {
  const mode = canonicalMode(modeInput);
  if (!Array.isArray(input)) {
    throw new HttpError(400, 'Pattern steps must be an array.', { code: 'AUTO_SCHEDULE_PATTERN_STEPS_INVALID' });
  }
  if (mode === 'WEEKLY' && input.length !== 7) {
    throw new HttpError(400, 'WEEKLY pattern must contain exactly 7 steps (Monday-Sunday).', { code: 'AUTO_SCHEDULE_PATTERN_WEEKLY_LENGTH_INVALID' });
  }
  if (mode === 'CYCLE' && (input.length < 1 || input.length > 31)) {
    throw new HttpError(400, 'CYCLE pattern must contain 1-31 steps.', { code: 'AUTO_SCHEDULE_PATTERN_CYCLE_LENGTH_INVALID' });
  }

  const phaseCodes = new Set();
  return input.map((item, index) => {
    const phaseCode = String(item?.phaseCode ?? '').trim().toUpperCase();
    const shiftCode = String(item?.shiftCode ?? '').trim().toUpperCase();
    const label = String(item?.label ?? '').trim();

    if (!/^[A-Z0-9_-]{1,20}$/.test(phaseCode)) {
      throw new HttpError(400, `Invalid phase code at step ${index + 1}.`, { code: 'AUTO_SCHEDULE_PHASE_CODE_INVALID' });
    }
    if (phaseCodes.has(phaseCode)) {
      throw new HttpError(400, `Duplicate phase code: ${phaseCode}.`, { code: 'AUTO_SCHEDULE_PHASE_CODE_DUPLICATE' });
    }
    phaseCodes.add(phaseCode);

    if (!/^[A-Z0-9_-]{1,12}$/.test(shiftCode) || shiftCode === 'AL') {
      throw new HttpError(400, `Invalid shift code at phase ${phaseCode}.`, { code: 'AUTO_SCHEDULE_PATTERN_SHIFT_CODE_INVALID' });
    }
    if (!label || label.length > 100) {
      throw new HttpError(400, `Phase label is required and must not exceed 100 characters at ${phaseCode}.`, { code: 'AUTO_SCHEDULE_PHASE_LABEL_INVALID' });
    }

    return { phaseCode, shiftCode, label };
  });
}

function safeRecord(record) {
  return Object.fromEntries(AUDIT_FIELDS.map((field) => [field, record?.[field]]));
}

function clonePattern(pattern) {
  return {
    ...pattern,
    steps: Array.isArray(pattern?.steps) ? pattern.steps.map((step) => ({ ...step })) : []
  };
}

async function ensurePatternShiftTypes(client, steps) {
  if (!client?.shiftType?.findMany) return;
  const codes = [...new Set(steps.map((step) => step.shiftCode))];
  const found = await client.shiftType.findMany({
    where: { code: { in: codes }, isActive: true },
    select: { code: true }
  });
  const available = new Set(found.map((row) => String(row.code).toUpperCase()));
  const missing = codes.filter((code) => !available.has(code));
  if (missing.length) {
    throw new HttpError(409, `Pattern references inactive or missing Shift Type: ${missing.join(', ')}.`, {
      code: 'AUTO_SCHEDULE_PATTERN_SHIFT_TYPE_UNAVAILABLE',
      shiftCodes: missing
    });
  }
}

async function listAutoSchedulePatterns(client = prismaDefault, { includeInactive = false } = {}) {
  if (!client?.autoSchedulePattern?.findMany) {
    throw new HttpError(503, 'Auto Schedule Pattern Master is unavailable.', {
      code: 'AUTO_SCHEDULE_PATTERN_MASTER_UNAVAILABLE'
    });
  }
  return client.autoSchedulePattern.findMany({
    where: includeInactive ? undefined : { isActive: true },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: {
      id: true,
      code: true,
      name: true,
      mode: true,
      steps: true,
      isActive: true,
      isSystem: true,
      targetGroup: true,
      sortOrder: true,
      createdAt: true,
      updatedAt: true
    }
  });
}

async function resolveAutoSchedulePattern(client, codeInput, { includeInactive = false } = {}) {
  const code = canonicalPatternCode(codeInput);
  if (!client?.autoSchedulePattern?.findUnique) {
    throw new HttpError(503, 'Auto Schedule Pattern Master is unavailable.', {
      code: 'AUTO_SCHEDULE_PATTERN_MASTER_UNAVAILABLE'
    });
  }
  const row = await client.autoSchedulePattern.findUnique({
    where: { code },
    select: {
      id: true,
      code: true,
      name: true,
      mode: true,
      steps: true,
      isActive: true,
      isSystem: true,
      targetGroup: true,
      sortOrder: true
    }
  });
  if (!row) throw new HttpError(404, 'Auto Schedule pattern was not found.', { code: 'AUTO_SCHEDULE_PATTERN_NOT_FOUND' });
  if (!row.isActive && !includeInactive) {
    throw new HttpError(409, 'Auto Schedule pattern is inactive.', { code: 'AUTO_SCHEDULE_PATTERN_INACTIVE', patternCode: code });
  }
  const mode = canonicalMode(row.mode);
  return { ...row, mode, targetGroup: canonicalTargetGroup(row.targetGroup), steps: normalizePatternSteps(row.steps, mode) };
}

function patternForTargetGroup(patterns, targetGroup) {
  const group = canonicalTargetGroup(targetGroup);
  const pattern = patterns.find((item) => item.isActive !== false && String(item.targetGroup || '').toUpperCase() === group);
  if (!pattern) {
    throw new HttpError(409, `Active Auto Schedule pattern for ${group} is required.`, {
      code: 'AUTO_SCHEDULE_DEFAULT_PATTERN_MISSING',
      targetGroup: group
    });
  }
  return pattern;
}

function createAutoSchedulePatternService({ prisma = prismaDefault, audit = auditDefault } = {}) {
  async function create(data, actorUserId) {
    const code = canonicalPatternCode(data.code);
    const name = String(data.name ?? '').trim();
    if (!name || name.length > 150) throw new HttpError(400, 'Pattern name is required and must not exceed 150 characters.', { code: 'AUTO_SCHEDULE_PATTERN_NAME_INVALID' });
    const mode = canonicalMode(data.mode);
    const steps = normalizePatternSteps(data.steps, mode);
    const sortOrder = Number.isInteger(Number(data.sortOrder)) ? Number(data.sortOrder) : 100;
    const isActive = data.isActive !== false;
    if (data.targetGroup !== undefined && canonicalTargetGroup(data.targetGroup) !== 'MANUAL') {
      throw new HttpError(409, 'Custom patterns are manual-select only. System default target groups are protected.', { code: 'AUTO_SCHEDULE_PATTERN_TARGET_PROTECTED' });
    }

    return prisma.$transaction(async (tx) => {
      const existing = await tx.autoSchedulePattern.findUnique({ where: { code } });
      if (existing) throw new HttpError(409, 'Pattern code already exists.', { code: 'AUTO_SCHEDULE_PATTERN_CODE_EXISTS' });
      await ensurePatternShiftTypes(tx, steps);
      const created = await tx.autoSchedulePattern.create({
        data: { code, name, mode, steps, isActive, isSystem: false, targetGroup: 'MANUAL', sortOrder }
      });
      await audit.log({
        actorUserId,
        action: 'CREATE',
        entityType: 'AutoSchedulePattern',
        entityId: created.id,
        metadata: { after: safeRecord(created) }
      }, tx);
      return created;
    });
  }

  async function update(id, data, actorUserId) {
    return prisma.$transaction(async (tx) => {
      const before = await tx.autoSchedulePattern.findUnique({ where: { id } });
      if (!before) throw new HttpError(404, 'Auto Schedule pattern not found.', { code: 'AUTO_SCHEDULE_PATTERN_NOT_FOUND' });

      if (Object.hasOwn(data, 'code') && canonicalPatternCode(data.code) !== before.code) {
        throw new HttpError(409, 'Pattern code is immutable after creation.', { code: 'AUTO_SCHEDULE_PATTERN_CODE_IMMUTABLE' });
      }

      const next = {};
      if (Object.hasOwn(data, 'name')) {
        const name = String(data.name ?? '').trim();
        if (!name || name.length > 150) throw new HttpError(400, 'Pattern name is required and must not exceed 150 characters.', { code: 'AUTO_SCHEDULE_PATTERN_NAME_INVALID' });
        next.name = name;
      }

      let nextMode = before.mode;
      if (Object.hasOwn(data, 'mode')) {
        const mode = canonicalMode(data.mode);
        if (before.isSystem && mode !== before.mode) {
          throw new HttpError(409, 'Core Auto Schedule pattern mode cannot be changed.', { code: 'CORE_AUTO_SCHEDULE_PATTERN_MODE_IMMUTABLE' });
        }
        next.mode = mode;
        nextMode = mode;
      }

      if (Object.hasOwn(data, 'targetGroup')) {
        const targetGroup = canonicalTargetGroup(data.targetGroup);
        if (targetGroup !== before.targetGroup) {
          throw new HttpError(409, 'Auto Schedule pattern target group is protected.', { code: 'AUTO_SCHEDULE_PATTERN_TARGET_PROTECTED' });
        }
      }

      if (Object.hasOwn(data, 'isActive')) {
        const isActive = Boolean(data.isActive);
        if (before.isSystem && !isActive) {
          throw new HttpError(409, 'Core Auto Schedule patterns cannot be deactivated.', { code: 'CORE_AUTO_SCHEDULE_PATTERN_ACTIVE_REQUIRED' });
        }
        next.isActive = isActive;
      }

      if (Object.hasOwn(data, 'steps')) {
        const steps = normalizePatternSteps(data.steps, nextMode);
        await ensurePatternShiftTypes(tx, steps);
        next.steps = steps;
      } else if (Object.hasOwn(data, 'mode') && nextMode !== before.mode) {
        next.steps = normalizePatternSteps(before.steps, nextMode);
      }

      if (Object.hasOwn(data, 'sortOrder')) {
        const sortOrder = Number(data.sortOrder);
        if (!Number.isInteger(sortOrder) || sortOrder < 0 || sortOrder > 9999) {
          throw new HttpError(400, 'Pattern sort order must be an integer from 0 to 9999.', { code: 'AUTO_SCHEDULE_PATTERN_SORT_ORDER_INVALID' });
        }
        next.sortOrder = sortOrder;
      }

      if (!Object.keys(next).length) return before;
      const updated = await tx.autoSchedulePattern.update({ where: { id }, data: next });
      await audit.log({
        actorUserId,
        action: 'UPDATE',
        entityType: 'AutoSchedulePattern',
        entityId: id,
        metadata: { before: safeRecord(before), after: safeRecord(updated) }
      }, tx);
      return updated;
    });
  }

  async function list(options) {
    return listAutoSchedulePatterns(prisma, options);
  }

  return { list, create, update };
}

module.exports = {
  AUTO_SCHEDULE_PATTERN_MODES,
  AUTO_SCHEDULE_TARGET_GROUPS,
  CORE_AUTO_SCHEDULE_PATTERNS,
  canonicalPatternCode,
  canonicalMode,
  canonicalTargetGroup,
  normalizePatternSteps,
  listAutoSchedulePatterns,
  resolveAutoSchedulePattern,
  patternForTargetGroup,
  createAutoSchedulePatternService
};
