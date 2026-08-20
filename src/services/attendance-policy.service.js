const HttpError = require('../utils/http-error');

const ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES = 'ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES';
const ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS = 'ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS';
const policyRanges = {
  [ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES]: { min: 5, max: 10080, defaultValue: 1440 },
  [ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS]: { min: 1, max: 30, defaultValue: 7 }
};

function validateAttendanceSystemSetting(key, value) {
  const range = policyRanges[key];
  if (!range) return value;
  if (!/^\d+$/.test(String(value))) throw new HttpError(400, `${key} must be an integer.`, { code: 'ATTENDANCE_POLICY_INVALID' });
  const parsed = Number(value);
  if (parsed < range.min || parsed > range.max) throw new HttpError(400, `${key} must be between ${range.min} and ${range.max}.`, { code: 'ATTENDANCE_POLICY_OUT_OF_RANGE' });
  return String(parsed);
}

async function getAttendancePolicy(client, key) {
  const range = policyRanges[key];
  if (!range) throw new Error(`Unknown attendance policy ${key}.`);
  const setting = await client.systemSetting.findUnique({ where: { key } });
  return setting ? Number(validateAttendanceSystemSetting(key, setting.value)) : range.defaultValue;
}

module.exports = {
  ATTENDANCE_OFFLINE_SYNC_MAX_AGE_MINUTES,
  ATTENDANCE_CLIENT_LOCAL_RETENTION_DAYS,
  getAttendancePolicy,
  policyRanges,
  validateAttendanceSystemSetting
};
