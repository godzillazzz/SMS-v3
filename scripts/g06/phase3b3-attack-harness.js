'use strict';

const {
  PROVIDER_RUNTIME_STATE,
  scenarios,
  summarizeAttackMatrix,
  plannedEvidenceRows
} = require('./phase3b3-attack-matrix');

function assertMatrixIntegrity() {
  const ids = new Set();
  for (const scenario of scenarios) {
    if (!/^ATK-\d{2}$/.test(scenario.id)) throw new Error(`INVALID_SCENARIO_ID:${scenario.id}`);
    if (ids.has(scenario.id)) throw new Error(`DUPLICATE_SCENARIO_ID:${scenario.id}`);
    ids.add(scenario.id);
    if (!scenario.name || !scenario.requiredResult || !scenario.category || !scenario.backendContract) {
      throw new Error(`INCOMPLETE_SCENARIO:${scenario.id}`);
    }
    if (!Array.isArray(scenario.acceptedFailureCodes) || !Array.isArray(scenario.backendEvidence) || scenario.backendEvidence.length === 0) {
      throw new Error(`INCOMPLETE_BACKEND_EVIDENCE:${scenario.id}`);
    }
  }
  if (scenarios.length !== 17) throw new Error(`ATTACK_MATRIX_SIZE_MISMATCH:${scenarios.length}`);
  return true;
}

function createPlan() {
  assertMatrixIntegrity();
  return {
    summary: summarizeAttackMatrix(),
    rules: {
      providerCallsAllowed: false,
      biometricRuntimeMayBeEnabled: false,
      productionMutationAllowed: false,
      physicalAttackMediaRetentionAllowed: false,
      unexecutedEmpiricalCaseMayBeReportedAsPass: false,
      backendContractEvidenceIsNotProviderPADCertification: true
    },
    evidenceRows: plannedEvidenceRows()
  };
}

function main(argv = process.argv.slice(2)) {
  const mode = argv.find((arg) => arg.startsWith('--mode='))?.slice('--mode='.length) || 'plan';
  if (mode !== 'plan') {
    const error = new Error('PHASE3B3_PROVIDER_EXECUTION_NOT_AUTHORIZED');
    error.code = 'PHASE3B3_PROVIDER_EXECUTION_NOT_AUTHORIZED';
    throw error;
  }
  if (PROVIDER_RUNTIME_STATE !== 'PAUSED') throw new Error('PHASE3B3_PROVIDER_RUNTIME_STATE_UNEXPECTED');
  process.stdout.write(`${JSON.stringify(createPlan(), null, 2)}\n`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.code || error.message || 'PHASE3B3_HARNESS_FAILED'}\n`);
    process.exitCode = 2;
  }
}

module.exports = {
  assertMatrixIntegrity,
  createPlan,
  main
};
