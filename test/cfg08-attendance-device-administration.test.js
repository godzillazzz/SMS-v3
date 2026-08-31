'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAttendanceDeviceService } = require('../src/services/attendance-device.service');

const admin = { sub: '00000000-0000-4000-8000-000000000001', role: 'ADMIN' };
const viewer = { sub: '00000000-0000-4000-8000-000000000002', role: 'VIEWER' };
const employeeId = '00000000-0000-4000-8000-000000000010';
const activeId = '00000000-0000-4000-8000-000000000011';
const candidateId = '00000000-0000-4000-8000-000000000012';
const requestId = '00000000-0000-4000-8000-000000000013';
const now = new Date('2026-08-31T15:00:00.000Z');

function revokeHarness() {
  const active = { id: activeId, employeeId, displayName: 'Current Phone', keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: 'a'.repeat(64), platformHint: 'Web', status: 'ACTIVE', proofVerifiedAt: now, enrolledAt: now, activatedAt: now, revokedAt: null, revokedReason: null, createdAt: now };
  const candidate = { id: candidateId, employeeId, displayName: 'Candidate Phone', keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: 'b'.repeat(64), platformHint: 'Web', status: 'PENDING_APPROVAL', proofVerifiedAt: now, enrolledAt: now, activatedAt: null, revokedAt: null, revokedReason: null, createdAt: now };
  const request = { id: requestId, employeeId, status: 'PENDING_APPROVAL', requestType: 'REPLACEMENT', candidateDeviceEnrollmentId: candidateId, currentDeviceEnrollmentId: activeId, candidateDevice: candidate, createdAt: now };
  const audits = [];
  const tx = {
    attendanceDeviceEnrollment: {
      findUnique: async ({ where }) => where.id === activeId ? { ...active } : where.id === candidateId ? { ...candidate } : null,
      updateMany: async ({ where, data }) => {
        const target = where.id === activeId ? active : where.id === candidateId ? candidate : null;
        if (!target || (where.employeeId && target.employeeId !== where.employeeId) || (where.status && target.status !== where.status)) return { count: 0 };
        Object.assign(target, data); return { count: 1 };
      }
    },
    attendanceDeviceChangeRequest: {
      findFirst: async () => request.status === 'PENDING_APPROVAL' ? { ...request, candidateDevice: { ...candidate } } : null,
      updateMany: async ({ where, data }) => {
        const allowed = Array.isArray(where.status?.in) ? where.status.in.includes(request.status) : where.status === request.status;
        if (where.id !== request.id || !allowed) return { count: 0 };
        Object.assign(request, data); return { count: 1 };
      }
    }
  };
  const prisma = { ...tx, $transaction: async (fn) => fn(tx) };
  const audit = { log: async (entry) => { audits.push(entry); return entry; } };
  return { active, candidate, request, audits, service: createAttendanceDeviceService({ prisma, audit, clock: () => now }) };
}

test('CFG-08 route exposes Admin-only overview and current-device revoke with required reason', () => {
  const route = require('fs').readFileSync('src/routes/attendance-device.routes.js', 'utf8');
  assert.match(route, /router\.get\('\/admin\/overview', authorize\('ADMIN'\)/);
  assert.match(route, /router\.post\('\/admin\/employees\/:employeeId\/current\/:deviceId\/revoke', authorize\('ADMIN'\)/);
  assert.match(route, /adminRevokeInput[\s\S]*min\(3\)/);
});

test('CFG-08 Admin revoke is transactional, requires reason, cancels pending replacement, and never activates another device', async () => {
  const { active, candidate, request, audits, service } = revokeHarness();
  await assert.rejects(() => service.revokeCurrent({ actor: viewer, employeeId, deviceEnrollmentId: activeId, reason: 'lost' }), (error) => error.statusCode === 403);
  await assert.rejects(() => service.revokeCurrent({ actor: admin, employeeId, deviceEnrollmentId: activeId, reason: 'x' }), (error) => error.statusCode === 400 && error.details.code === 'ATTENDANCE_DEVICE_REVOKE_REASON_REQUIRED');

  const result = await service.revokeCurrent({ actor: admin, employeeId, deviceEnrollmentId: activeId, reason: 'Device lost' });
  assert.equal(active.status, 'REVOKED');
  assert.equal(active.revokedReason, 'Device lost');
  assert.equal(candidate.status, 'CANCELLED');
  assert.equal(request.status, 'CANCELLED');
  assert.equal(result.cancelledRequestId, requestId);
  assert.equal([active, candidate].filter((row) => row.status === 'ACTIVE').length, 0);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].metadata.event, 'ADMIN_REVOKE_CURRENT');
  assert.equal(audits[0].metadata.reason, 'Device lost');
  assert.equal(audits[0].actorUserId, admin.sub);
});

test('CFG-08 Admin overview exposes governed history and sanitized audit context only', async () => {
  const employee = { id: employeeId, displayName: 'Employee A', firstName: 'A', lastName: 'One', department: 'PS' };
  const active = { id: activeId, employeeId, employee, displayName: 'Current Phone', keyAlgorithm: 'ECDSA_P256_SHA256', credentialFingerprint: 'c'.repeat(64), platformHint: 'Informational only', status: 'ACTIVE', proofVerifiedAt: now, enrolledAt: now, activatedAt: now, revokedAt: null, revokedReason: null, createdAt: now };
  const old = { ...active, id: candidateId, displayName: 'Old Phone', status: 'REVOKED', revokedAt: now, revokedReason: 'Replaced', createdAt: new Date(now.getTime() - 1000) };
  const prisma = {
    attendanceDeviceEnrollment: { findMany: async () => [active, old] },
    attendanceDeviceChangeRequest: { findMany: async () => [] },
    auditLog: { findMany: async () => [{ id: 'audit-1', actorUserId: admin.sub, action: 'UPDATE', entityType: 'AttendanceDeviceEnrollment', entityId: activeId, metadata: { event: 'ADMIN_REVOKE_CURRENT', employeeId, reason: 'example', challenge: 'MUST_NOT_LEAK', userAgentSnapshot: 'MUST_NOT_LEAK' }, createdAt: now, actor: { id: admin.sub, displayName: 'Admin' } }] }
  };
  const service = createAttendanceDeviceService({ prisma, audit: { log: async () => undefined } });
  const overview = await service.listAdminOverview({ actor: admin });
  assert.equal(overview.length, 1);
  assert.equal(overview[0].activeDevice.id, activeId);
  assert.equal(overview[0].history.length, 2);
  assert.equal(overview[0].history[1].revokedReason, 'Replaced');
  assert.equal(overview[0].recentAudit[0].metadata.reason, 'example');
  assert.equal(Object.hasOwn(overview[0].recentAudit[0].metadata, 'challenge'), false);
  assert.equal(Object.hasOwn(overview[0].recentAudit[0].metadata, 'userAgentSnapshot'), false);
});
