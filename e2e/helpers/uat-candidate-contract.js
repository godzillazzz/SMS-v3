const candidateContract = require('../fixtures/candidate-contract.json');

function validateCandidateIdentity(applicationSha, deploymentId, targetUrl) {
  if (
    candidateContract.applicationSha !== applicationSha
    || candidateContract.deploymentId !== deploymentId
    || candidateContract.targetUrl !== targetUrl
  ) {
    const error = new Error('UAT_CANDIDATE_IDENTITY_MISMATCH');
    error.code = 'UAT_CANDIDATE_IDENTITY_MISMATCH';
    throw error;
  }
  return { valid: true };
}

if (require.main === module) {
  try {
    validateCandidateIdentity(...process.argv.slice(2, 5));
    process.stdout.write('UAT_CANDIDATE_IDENTITY=PASS\n');
  } catch {
    process.stderr.write('UAT_CANDIDATE_IDENTITY_MISMATCH\n');
    process.exitCode = 1;
  }
}

module.exports = { validateCandidateIdentity };
