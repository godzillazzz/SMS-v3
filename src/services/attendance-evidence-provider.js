const HttpError = require('../utils/http-error');

function calculateRetentionUntil(capturedAt) {
  const result = new Date(capturedAt);
  if (Number.isNaN(result.getTime())) throw new HttpError(400, 'Evidence capturedAt must be valid.', { code: 'ATTENDANCE_EVIDENCE_CAPTURED_AT_INVALID' });
  result.setUTCFullYear(result.getUTCFullYear() + 1);
  return result;
}

function assertIdempotentEvidence(existing, { objectReference, checksum }) {
  if (!existing) return { idempotent: false };
  if (existing.objectReference === objectReference && existing.checksum === checksum) return { idempotent: true, evidence: existing };
  throw new HttpError(409, 'Evidence identity conflicts with a different checksum.', { code: 'EVIDENCE_INTEGRITY_CONFLICT' });
}

function createAttendanceEvidenceProvider() {
  const unavailable = async () => { throw new HttpError(503, 'Attendance evidence storage is not configured.', { code: 'ATTENDANCE_EVIDENCE_PROVIDER_NOT_CONFIGURED' }); };
  return { putIfAbsent: unavailable, verify: unavailable, createReadHandle: unavailable, remove: unavailable, healthCheck: unavailable };
}

module.exports = { assertIdempotentEvidence, calculateRetentionUntil, createAttendanceEvidenceProvider };
