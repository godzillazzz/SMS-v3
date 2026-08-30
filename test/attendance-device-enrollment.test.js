process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { createAttendanceDeviceService, challengeHash } = require('../src/services/attendance-device.service');

const ids = {
  employee: '11111111-1111-4111-8111-111111111111', employeeUser: '22222222-2222-4222-8222-222222222222',
  admin: '33333333-3333-4333-8333-333333333333', manager: '44444444-4444-4444-8444-444444444444',
  active: '55555555-5555-4555-8555-555555555555', candidate: '66666666-6666-4666-8666-666666666666',
  request: '77777777-7777-4777-8777-777777777777', challenge: '88888888-8888-4888-8888-888888888888'
};
const now = new Date('2026-08-23T14:00:00.000Z');
const employeeActor = { sub: ids.employeeUser, role: 'VIEWER' };
const adminActor = { sub: ids.admin, role: 'ADMIN' };
const managerActor = { sub: ids.manager, role: 'MANAGER' };

function keyMaterial() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { publicKey, privateKey, spki: publicKey.export({ type: 'spki', format: 'der' }) };
}
function clone(value) { return structuredClone(value); }

function harness({ activeDevice = null, inactive = false, failCandidateActivation = false, delayIndependentReads = false, cancelAfterChallengeConsume = false } = {}) {
  const metrics = {
    userFindUnique: 0,
    attendanceRequestFindFirst: 0,
    enrollmentFindFirst: 0,
    attendanceRequestFindUnique: 0,
    challengeFindUnique: 0,
    enrollmentUpdateMany: 0,
    activeIndependentReads: 0,
    maxIndependentReads: 0
  };
  let independentReadsStarted = 0;
  let releaseIndependentReads;
  const independentReadGate = new Promise((resolve) => { releaseIndependentReads = resolve; });
  async function trackIndependentRead(run) {
    metrics.activeIndependentReads += 1;
    metrics.maxIndependentReads = Math.max(metrics.maxIndependentReads, metrics.activeIndependentReads);
    independentReadsStarted += 1;
    if (delayIndependentReads) {
      if (independentReadsStarted >= 2) releaseIndependentReads();
      await independentReadGate;
    }
    try { return run(); }
    finally { metrics.activeIndependentReads -= 1; }
  }
  const state = {
    employee: { id: ids.employee, isActive: !inactive, deletedAt: null },
    users: new Map([[ids.employeeUser, { id: ids.employeeUser, employeeId: ids.employee, employee: null }], [ids.admin, { id: ids.admin, employeeId: null, employee: null }], [ids.manager, { id: ids.manager, employeeId: null, employee: null }]]),
    enrollments: activeDevice ? [{ ...activeDevice }] : [], requests: [], challenges: [], audits: []
  };
  state.users.get(ids.employeeUser).employee = state.employee;
  let enrollmentSeq = 0, requestSeq = 0, challengeSeq = 0;
  function enrollmentById(id) { return state.enrollments.find((row) => row.id === id); }
  function requestById(id) { return state.requests.find((row) => row.id === id); }
  const tx = {
    user: { findUnique: async ({ where }) => { metrics.userFindUnique += 1; return state.users.get(where.id) ? clone(state.users.get(where.id)) : null; } },
    attendanceDeviceEnrollment: {
      findFirst: async ({ where }) => {
        metrics.enrollmentFindFirst += 1;
        return trackIndependentRead(() => clone(state.enrollments.filter((row) => row.employeeId === where.employeeId && row.status === where.status).sort((a,b) => new Date(b.activatedAt || 0) - new Date(a.activatedAt || 0))[0] || null));
      },
      create: async ({ data }) => { const row = { id: enrollmentSeq++ ? crypto.randomUUID() : ids.candidate, proofVerifiedAt: null, enrolledAt: now, activatedAt: null, revokedAt: null, revokedReason: null, createdAt: now, updatedAt: now, ...data }; state.enrollments.push(row); return clone(row); },
      update: async ({ where, data }) => { const row = enrollmentById(where.id); if (!row) throw new Error('missing enrollment'); if (failCandidateActivation && where.id === ids.candidate && data.status === 'ACTIVE') throw new Error('candidate activation failure'); Object.assign(row, data, { updatedAt: now }); return clone(row); },
      updateMany: async ({ where, data }) => {
        metrics.enrollmentUpdateMany += 1;
        let count = 0;
        for (const row of state.enrollments) {
          const request = state.requests.find((candidateRequest) => candidateRequest.candidateDeviceEnrollmentId === row.id);
          const relation = where.candidateForRequest?.is;
          const relationMatches = !relation || (
            request
            && (!relation.id || request.id === relation.id)
            && (!relation.employeeId || request.employeeId === relation.employeeId)
            && (!relation.requestedByUserId || request.requestedByUserId === relation.requestedByUserId)
            && (!relation.status?.in || relation.status.in.includes(request.status))
          );
          const matches = (!where.id || row.id === where.id)
            && (!where.employeeId || row.employeeId === where.employeeId)
            && (!where.status || row.status === where.status)
            && relationMatches;
          if (matches) { Object.assign(row, data, { updatedAt: now }); count += 1; }
        }
        return { count };
      }
    },
    attendanceDeviceChangeRequest: {
      findFirst: async ({ where }) => {
        metrics.attendanceRequestFindFirst += 1;
        return trackIndependentRead(() => clone(state.requests.find((row) => row.employeeId === where.employeeId && (!where.status?.in || where.status.in.includes(row.status))) || null));
      },
      create: async ({ data, include }) => { const row = { id: requestSeq++ ? crypto.randomUUID() : ids.request, status: 'PENDING_APPROVAL', reviewerComment: null, reviewedByUserId: null, reviewedAt: null, returnedAt: null, cancelledAt: null, createdAt: now, updatedAt: now, ...data }; state.requests.push(row); return include?.candidateDevice ? { ...clone(row), candidateDevice: clone(enrollmentById(row.candidateDeviceEnrollmentId)) } : clone(row); },
      findUnique: async ({ where, include }) => { metrics.attendanceRequestFindUnique += 1; const row = requestById(where.id); if (!row) return null; const out = clone(row); if (include?.candidateDevice) out.candidateDevice = clone(enrollmentById(row.candidateDeviceEnrollmentId)); if (include?.employee) out.employee = clone(state.employee); return out; },
      update: async ({ where, data, include }) => { const row = requestById(where.id); Object.assign(row, data, { updatedAt: now }); const out = clone(row); if (include?.candidateDevice) out.candidateDevice = clone(enrollmentById(row.candidateDeviceEnrollmentId)); return out; },
      updateMany: async ({ where, data }) => { let count = 0; for (const row of state.requests) { const statusMatch = !where.status || (typeof where.status === 'string' ? row.status === where.status : where.status.in?.includes(row.status)); const matches = (!where.id || row.id === where.id) && (!where.requestedByUserId || row.requestedByUserId === where.requestedByUserId) && statusMatch; if (matches) { Object.assign(row, data, { updatedAt: now }); count++; } } return { count }; },
      findMany: async ({ where }) => state.requests.filter((row) => !where.status || row.status === where.status).map((row) => ({ ...clone(row), candidateDevice: clone(enrollmentById(row.candidateDeviceEnrollmentId)) }))
    },
    attendanceDeviceChallenge: {
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state.challenges) {
          const matches = (!where.id || row.id === where.id)
            && (!where.employeeId || row.employeeId === where.employeeId)
            && (!where.deviceEnrollmentId || row.deviceEnrollmentId === where.deviceEnrollmentId)
            && (!where.purpose || row.purpose === where.purpose)
            && (where.consumedAt !== null || row.consumedAt === null)
            && (!where.expiresAt?.gt || row.expiresAt > where.expiresAt.gt);
          if (matches) { Object.assign(row, data); count += 1; }
        }
        if (count === 1 && where.id && cancelAfterChallengeConsume && data.consumedAt) {
          const challenge = state.challenges.find((row) => row.id === where.id);
          const request = state.requests.find((row) => row.candidateDeviceEnrollmentId === challenge?.deviceEnrollmentId);
          if (request) request.status = 'CANCELLED';
        }
        return { count };
      },
      create: async ({ data }) => { const row = { id: challengeSeq++ ? crypto.randomUUID() : ids.challenge, consumedAt: null, createdAt: now, ...data }; state.challenges.push(row); return clone(row); },
      findUnique: async ({ where }) => { metrics.challengeFindUnique += 1; return clone(state.challenges.find((row) => row.id === where.id) || null); }
    }
  };
  const prisma = { ...tx, $transaction: async (fn) => {
    const snapshot = clone({ enrollments: state.enrollments, requests: state.requests, challenges: state.challenges, audits: state.audits });
    try { return await fn(tx); } catch (error) { state.enrollments.splice(0,state.enrollments.length,...snapshot.enrollments); state.requests.splice(0,state.requests.length,...snapshot.requests); state.challenges.splice(0,state.challenges.length,...snapshot.challenges); state.audits.splice(0,state.audits.length,...snapshot.audits); throw error; }
  } };
  const audit = { log: async (entry) => { state.audits.push(clone(entry)); return entry; } };
  const service = createAttendanceDeviceService({ prisma, audit, clock: () => now, randomBytes: () => Buffer.alloc(32, 7) });
  return { state, service, metrics };
}

async function createCandidate(service, material, actor = employeeActor) {
  return service.createRequest({ actor, displayName: 'Personal Phone', publicKeySpkiBase64: material.spki.toString('base64'), keyAlgorithm: 'ECDSA_P256_SHA256', platformHint: 'Android' });
}
async function proveCandidate(service, material) {
  const options = await service.createProofChallenge({ actor: employeeActor, requestId: ids.request });
  const signature = crypto.sign('sha256', Buffer.from(options.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
  await service.verifyProof({ actor: employeeActor, requestId: ids.request, challengeId: options.challengeId, challenge: options.challenge, signatureBase64: signature.toString('base64') });
  return options;
}

test('route contract authenticates every device endpoint and keeps review/final approval ADMIN-only', () => {
  const route = require('fs').readFileSync('src/routes/attendance-device.routes.js', 'utf8');
  const index = require('fs').readFileSync('src/routes/index.js', 'utf8');
  assert.ok(route.includes('router.use(authenticate);'));
  assert.ok(route.includes("router.get('/requests', authorize('ADMIN')"));
  assert.ok(route.includes("router.post('/requests/:id/approve', authorize('ADMIN')"));
  assert.ok(route.includes("router.post('/requests/:id/return-for-correction', authorize('ADMIN')"));
  assert.ok(route.includes("router.post('/requests/:id/reject', authorize('ADMIN')"));
  assert.ok(index.includes("router.use('/attendance/devices', attendanceDeviceRoutes);"));
  assert.equal(route.includes('employeeCode'), false);
  const authenticate = require('fs').readFileSync('src/middlewares/authenticate.js', 'utf8');
  assert.match(authenticate, /employee:\s*\{\s*select:\s*\{\s*id:\s*true,\s*isActive:\s*true,\s*deletedAt:\s*true\s*\}\s*\}/);
  assert.match(authenticate, /employeeAuthority:\s*user\.employee/);
});

test('migration/schema lock dedicated device identity without reusing employeeCode or WebAuthnCredential', () => {
  const schema = require('fs').readFileSync('prisma/schema.prisma','utf8');
  const migration = require('fs').readFileSync('prisma/migrations/202608230001_g06_personal_device_enrollment_v1/migration.sql','utf8');
  assert.match(schema, /model AttendanceDeviceEnrollment/); assert.match(schema, /model AttendanceDeviceChallenge/); assert.match(schema, /model AttendanceDeviceChangeRequest/);
  assert.match(migration, /attendance_device_enrollments_one_active_per_employee/);
  assert.match(migration, /WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /attendance_device_change_requests_one_actionable_per_employee/);
  assert.match(migration, /attendance_device_challenges_one_unconsumed_per_device_purpose/);
  const deviceBlock = schema.slice(schema.indexOf('model AttendanceDeviceEnrollment'), schema.indexOf('model RefreshSession'));
  assert.doesNotMatch(deviceBlock, /employeeCode|WebAuthnCredential/);
});

test('first device is always PENDING_APPROVAL INITIAL and cannot self-activate', async () => {
  const material = keyMaterial(); const { state, service } = harness();
  const request = await createCandidate(service, material);
  assert.equal(request.requestType, 'INITIAL'); assert.equal(request.status, 'PENDING_APPROVAL');
  assert.equal(state.enrollments[0].status, 'PENDING_APPROVAL'); assert.equal(state.enrollments[0].proofVerifiedAt, null);
  await assert.rejects(() => service.approve({ actor: employeeActor, requestId: ids.request }), (e) => e.statusCode === 403 && e.details.code === 'ATTENDANCE_DEVICE_ADMIN_REQUIRED');
  await assert.rejects(() => service.approve({ actor: managerActor, requestId: ids.request }), (e) => e.statusCode === 403 && e.details.code === 'ATTENDANCE_DEVICE_ADMIN_REQUIRED');
});

test('admin approval is blocked until candidate proves possession of private key', async () => {
  const material = keyMaterial(); const { service } = harness(); await createCandidate(service, material);
  await assert.rejects(() => service.approve({ actor: adminActor, requestId: ids.request }), (e) => e.statusCode === 409 && e.details.code === 'ATTENDANCE_DEVICE_PROOF_REQUIRED');
});

test('single-use proof challenge stores only hash and valid P-256 signature verifies candidate', async () => {
  const material = keyMaterial(); const { state, service } = harness(); await createCandidate(service, material);
  const options = await service.createProofChallenge({ actor: employeeActor, requestId: ids.request });
  assert.equal(state.challenges[0].challengeHash, challengeHash(options.challenge)); assert.equal(Object.hasOwn(state.challenges[0],'challenge'), false);
  const signature = crypto.sign('sha256', Buffer.from(options.challenge,'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });
  const verified = await service.verifyProof({ actor: employeeActor, requestId: ids.request, challengeId: options.challengeId, challenge: options.challenge, signatureBase64: signature.toString('base64') });
  assert.equal(verified.proofVerifiedAt.toISOString(), now.toISOString()); assert.ok(state.challenges[0].consumedAt);
  await assert.rejects(() => service.verifyProof({ actor: employeeActor, requestId: ids.request, challengeId: options.challengeId, challenge: options.challenge, signatureBase64: signature.toString('base64') }), (e) => e.statusCode === 400 && e.details.code === 'ATTENDANCE_DEVICE_CHALLENGE_INVALID');
  assert.equal(JSON.stringify(state.audits).includes(options.challenge), false);
});

test('wrong private key fails closed and consumes challenge', async () => {
  const material = keyMaterial(); const wrong = keyMaterial(); const { state, service } = harness(); await createCandidate(service, material);
  const options = await service.createProofChallenge({ actor: employeeActor, requestId: ids.request });
  const signature = crypto.sign('sha256', Buffer.from(options.challenge,'base64url'), { key: wrong.privateKey, dsaEncoding: 'ieee-p1363' });
  await assert.rejects(() => service.verifyProof({ actor: employeeActor, requestId: ids.request, challengeId: options.challengeId, challenge: options.challenge, signatureBase64: signature.toString('base64') }), (e) => e.statusCode === 400 && e.details.code === 'ATTENDANCE_DEVICE_PROOF_INVALID');
  assert.ok(state.challenges[0].consumedAt); assert.equal(state.enrollments[0].proofVerifiedAt, null);
});

test('admin final approval activates exactly the verified first device', async () => {
  const material = keyMaterial(); const { state, service } = harness(); await createCandidate(service, material); await proveCandidate(service, material);
  const approved = await service.approve({ actor: adminActor, requestId: ids.request });
  assert.equal(approved.status, 'APPROVED'); assert.equal(state.enrollments.filter((d) => d.status === 'ACTIVE').length, 1);
  assert.equal(state.enrollments[0].approvedByUserId, ids.admin); assert.equal(state.audits.at(-1).metadata.event, 'FINAL_APPROVE');
});

test('replacement revokes old device and activates candidate in one transaction', async () => {
  const active = { id: ids.active, employeeId: ids.employee, publicKey: Buffer.from('old'), keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: 'a'.repeat(64), displayName: 'Old Phone', status: 'ACTIVE', proofVerifiedAt: now, enrolledAt: now, activatedAt: new Date('2026-08-01T00:00:00Z'), revokedAt: null, revokedReason: null, createdByUserId: ids.employeeUser, approvedByUserId: ids.admin, createdAt: now, updatedAt: now };
  const material = keyMaterial(); const { state, service } = harness({ activeDevice: active }); await createCandidate(service, material); assert.equal(state.requests[0].requestType, 'REPLACEMENT'); assert.equal(state.requests[0].currentDeviceEnrollmentId, ids.active); await proveCandidate(service, material); await service.approve({ actor: adminActor, requestId: ids.request });
  assert.equal(state.enrollments.find((d) => d.id === ids.active).status, 'REVOKED'); assert.equal(state.enrollments.find((d) => d.id === ids.candidate).status, 'ACTIVE'); assert.equal(state.enrollments.filter((d) => d.status === 'ACTIVE').length, 1);
});

test('replacement activation failure rolls back old-device revocation', async () => {
  const active = { id: ids.active, employeeId: ids.employee, publicKey: Buffer.from('old'), keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: 'b'.repeat(64), displayName: 'Old Phone', status: 'ACTIVE', proofVerifiedAt: now, enrolledAt: now, activatedAt: new Date('2026-08-01T00:00:00Z'), revokedAt: null, revokedReason: null, createdByUserId: ids.employeeUser, approvedByUserId: ids.admin, createdAt: now, updatedAt: now };
  const material = keyMaterial(); const { state, service } = harness({ activeDevice: active, failCandidateActivation: true }); await createCandidate(service, material); await proveCandidate(service, material);
  await assert.rejects(() => service.approve({ actor: adminActor, requestId: ids.request }), /candidate activation failure/);
  assert.equal(state.enrollments.find((d) => d.id === ids.active).status, 'ACTIVE'); assert.equal(state.enrollments.find((d) => d.id === ids.candidate).status, 'PENDING_APPROVAL'); assert.equal(state.requests[0].status, 'PENDING_APPROVAL');
});

test('inactive employee and duplicate actionable request fail closed', async () => {
  const material = keyMaterial(); const inactive = harness({ inactive: true });
  await assert.rejects(() => createCandidate(inactive.service, material), (e) => e.statusCode === 409 && e.details.code === 'INACTIVE_EMPLOYEE_OPERATION');
  const live = harness(); await createCandidate(live.service, material);
  const second = keyMaterial(); await assert.rejects(() => createCandidate(live.service, second), (e) => e.statusCode === 409 && e.details.code === 'ATTENDANCE_DEVICE_REQUEST_ALREADY_ACTIVE');
});

test('return/resubmit/cancel preserve Admin review and request-owner boundaries', async () => {
  const material = keyMaterial(); const { state, service } = harness(); await createCandidate(service, material);
  await assert.rejects(() => service.returnForCorrection({ actor: managerActor, requestId: ids.request, comment: 'แก้ไข' }), { statusCode: 403 });
  await service.returnForCorrection({ actor: adminActor, requestId: ids.request, comment: 'กรุณาตรวจสอบชื่อเครื่อง' }); assert.equal(state.requests[0].status, 'RETURNED_FOR_CORRECTION');
  await assert.rejects(() => service.resubmit({ actor: managerActor, requestId: ids.request }), (e) => e.statusCode === 404);
  await service.resubmit({ actor: employeeActor, requestId: ids.request, reason: 'แก้ไขแล้ว' }); assert.equal(state.requests[0].status, 'PENDING_APPROVAL');
  await service.cancel({ actor: employeeActor, requestId: ids.request, reason: 'ไม่ใช้เครื่องนี้แล้ว' }); assert.equal(state.requests[0].status, 'CANCELLED'); assert.equal(state.enrollments[0].status, 'CANCELLED');
});


test('PERF-07 reuses authenticated employee authority without a duplicate User lookup', async () => {
  const material = keyMaterial();
  const actor = {
    ...employeeActor,
    employeeAuthority: { id: ids.employee, isActive: true, deletedAt: null }
  };
  const { service, metrics } = harness();
  const request = await createCandidate(service, material, actor);
  assert.equal(request.employeeId, ids.employee);
  assert.equal(metrics.userFindUnique, 0);

  const state = await service.getMyState({ actor });
  assert.equal(state.employeeId, ids.employee);
  assert.equal(metrics.userFindUnique, 0);
});

test('PERF-07 authenticated employee authority still fails closed for inactive or unlinked employees', async () => {
  const material = keyMaterial();
  const inactive = harness();
  await assert.rejects(
    () => createCandidate(inactive.service, material, {
      ...employeeActor,
      employeeAuthority: { id: ids.employee, isActive: false, deletedAt: null }
    }),
    (error) => error.statusCode === 409 && error.details.code === 'INACTIVE_EMPLOYEE_OPERATION'
  );
  assert.equal(inactive.metrics.userFindUnique, 0);

  const unlinked = harness();
  await assert.rejects(
    () => createCandidate(unlinked.service, material, { ...employeeActor, employeeAuthority: null }),
    (error) => error.statusCode === 403 && error.details.code === 'ATTENDANCE_DEVICE_EMPLOYEE_LINK_REQUIRED'
  );
  assert.equal(unlinked.metrics.userFindUnique, 0);
});

test('PERF-07 create request runs actionable-request and active-device reads concurrently', async () => {
  const material = keyMaterial();
  const { service, metrics } = harness({ delayIndependentReads: true });
  const request = await createCandidate(service, material);
  assert.equal(request.requestType, 'INITIAL');
  assert.equal(metrics.attendanceRequestFindFirst, 1);
  assert.equal(metrics.enrollmentFindFirst, 1);
  assert.equal(metrics.maxIndependentReads, 2);
});

test('PERF-07 proof verification avoids the post-signature request reread and uses one atomic candidate mark', async () => {
  const material = keyMaterial();
  const { service, metrics } = harness();
  await createCandidate(service, material);
  const options = await service.createProofChallenge({ actor: employeeActor, requestId: ids.request });
  const signature = crypto.sign('sha256', Buffer.from(options.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });

  metrics.attendanceRequestFindUnique = 0;
  metrics.challengeFindUnique = 0;
  metrics.enrollmentUpdateMany = 0;

  const verified = await service.verifyProof({
    actor: employeeActor,
    requestId: ids.request,
    challengeId: options.challengeId,
    challenge: options.challenge,
    signatureBase64: signature.toString('base64')
  });

  assert.equal(verified.proofVerifiedAt.toISOString(), now.toISOString());
  assert.equal(metrics.attendanceRequestFindUnique, 1, 'proof verification must load the request only once before signature verification');
  assert.equal(metrics.challengeFindUnique, 1);
  assert.equal(metrics.enrollmentUpdateMany, 1, 'post-signature state must be marked by one conditional update');
});

test('PERF-07 proof mark fails closed if request becomes non-actionable after challenge consumption', async () => {
  const material = keyMaterial();
  const { state, service } = harness({ cancelAfterChallengeConsume: true });
  await createCandidate(service, material);
  const options = await service.createProofChallenge({ actor: employeeActor, requestId: ids.request });
  const signature = crypto.sign('sha256', Buffer.from(options.challenge, 'base64url'), { key: material.privateKey, dsaEncoding: 'ieee-p1363' });

  await assert.rejects(
    () => service.verifyProof({
      actor: employeeActor,
      requestId: ids.request,
      challengeId: options.challengeId,
      challenge: options.challenge,
      signatureBase64: signature.toString('base64')
    }),
    (error) => error.statusCode === 409 && error.details.code === 'ATTENDANCE_DEVICE_REQUEST_NOT_ACTIONABLE'
  );
  assert.equal(state.challenges[0].consumedAt.toISOString(), now.toISOString());
  assert.equal(state.requests[0].status, 'CANCELLED');
  assert.equal(state.enrollments[0].proofVerifiedAt, null);
});
