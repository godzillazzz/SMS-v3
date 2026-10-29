'use strict';
const HttpError = require('../utils/http-error');
function assertRetroactiveLeaveAllowed({ policy, actorRole, actorEmployeeId, employeeId, daysBack, correction = false }) {
  const prefix = correction ? 'LEAVE_CORRECTION_' : 'LEAVE_';
  const fail = (code, message, status = 400, details = {}) => { throw new HttpError(status, message, { code: `${prefix}${code}`, ...details }); };
  if (actorRole === 'ADMIN') return;
  if (actorRole === 'VIEWER') {
    if (!actorEmployeeId || actorEmployeeId !== employeeId || !policy.viewerRetroactiveSelfEnabled) fail('RETROACTIVE_NOT_ALLOWED', 'พนักงานทั่วไปไม่สามารถบันทึกการลาย้อนหลังได้');
    const max = Number(policy.viewerRetroactiveMaxDaysBack || 0);
    if (max > 0 && daysBack > max) fail('VIEWER_RETROACTIVE_LIMIT_EXCEEDED', `บันทึกการลาย้อนหลังได้สูงสุด ${max} วัน`, 400, { daysBack, maxDaysBack: max });
    return;
  }
  if (actorRole === 'MANAGER' || actorRole === 'SUPERVISOR') {
    if (actorEmployeeId && actorEmployeeId === employeeId) fail('MANAGER_RETROACTIVE_SELF_NOT_ALLOWED', 'ไม่สามารถบันทึกการลาย้อนหลังให้ตนเองได้');
    const supervisor = actorRole === 'SUPERVISOR';
    const enabled = supervisor ? policy.supervisorRetroactiveOnBehalfEnabled : policy.managerRetroactiveOnBehalfEnabled;
    const max = Number((supervisor ? policy.supervisorRetroactiveMaxDaysBack : policy.managerRetroactiveMaxDaysBack) || 0);
    if (!enabled) fail(`${actorRole}_RETROACTIVE_DISABLED`, 'นโยบายปัจจุบันไม่อนุญาตให้บันทึกการลาย้อนหลังแทนพนักงาน', 403);
    if (max > 0 && daysBack > max) fail(`${actorRole}_RETROACTIVE_LIMIT_EXCEEDED`, `บันทึกการลาย้อนหลังได้สูงสุด ${max} วัน`, 400, { daysBack, maxDaysBack: max });
    return;
  }
  fail('RETROACTIVE_NOT_ALLOWED', 'ไม่มีสิทธิ์บันทึกการลาย้อนหลัง', 403);
}
module.exports = { assertRetroactiveLeaveAllowed };
