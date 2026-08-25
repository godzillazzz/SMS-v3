'use strict';

const core = require('./attendance-site-evidence-core.service');
const { detectWrongShiftForAssignment } = require('./attendance-shift-runtime.service');

function addRisk(result, flag) {
  if (!flag) return result;
  const evidenceFlags = new Set(Array.isArray(result?.evidenceRef?.riskFlags) ? result.evidenceRef.riskFlags : []);
  const decisionFlags = new Set(Array.isArray(result?.decision?.riskFlags) ? result.decision.riskFlags : []);
  evidenceFlags.add(flag);
  decisionFlags.add(flag);
  return {
    ...result,
    evidenceRef: { ...result.evidenceRef, riskFlags: [...evidenceFlags] },
    decision: { ...result.decision, riskFlags: [...decisionFlags] }
  };
}

function createAttendanceSiteEvidenceService(options = {}) {
  const base = core.createAttendanceSiteEvidenceService(options);
  return {
    async validateForAssignment(input, client) {
      const result = await base.validateForAssignment(input, client);
      const wrongShift = await detectWrongShiftForAssignment({ assignment: input.assignment, eventAt: input.location?.capturedAt }, client || options.prisma);
      return addRisk(result, wrongShift?.flag || null);
    },
    async revalidateRef(input, client) {
      const result = await base.revalidateRef(input, client);
      const preserved = Array.isArray(input?.ref?.riskFlags) && input.ref.riskFlags.includes('WRONG_SHIFT');
      return preserved ? addRisk(result, 'WRONG_SHIFT') : result;
    }
  };
}

module.exports = { ...core, createAttendanceSiteEvidenceService };
