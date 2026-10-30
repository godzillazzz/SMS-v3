'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
const configured = process.env.RUN_INTEGRATION_TESTS === 'true'
  && ['docker-container-network', 'local-isolated'].includes(process.env.TEST_DATABASE_RUNNER)
  && target.hostname === '127.0.0.1'
  && target.port === '5432'
  && ['sms_v3_test', 'forge_patrol_test'].includes(target.pathname.replace(/^\//, ''));

if (!configured) {
  test('patrol integration requires the isolated test PostgreSQL target', { skip: true }, () => {});
} else {
  const { PrismaClient } = require('@prisma/client');
  const { createPatrolService } = require('../../src/services/patrol.service');
  const prisma = new PrismaClient();
  const marker = crypto.randomUUID().slice(0, 8).toUpperCase();
  const employeeId = crypto.randomUUID();
  const objects = new Map();
  const storage = {
    provider: 's3', bucket: 'it-bucket',
    async put(key, file) { objects.set(key, file.buffer); return { provider: 's3', bucket: 'it-bucket', sha256: crypto.createHash('sha256').update(file.buffer).digest('hex') }; },
    async remove(key) { objects.delete(key); },
    async get(key) { return objects.get(key); }
  };
  const service = createPatrolService({ prisma, storage, audit: { log: async () => {} }, clock: () => new Date('2026-10-30T02:00:00.000Z') });
  const admin = { sub: crypto.randomUUID(), role: 'ADMIN' };
  const managerId = crypto.randomUUID();
  const manager = { sub: managerId, role: 'MANAGER' };
  const guard = { sub: crypto.randomUUID(), role: 'VIEWER', employeeAuthority: { id: employeeId, isActive: true, deletedAt: null } };
  const photo = { buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(256)]), mimetype: 'image/jpeg' };

  async function cleanup() {
    await prisma.patrolScan.deleteMany({ where: { employeeId } });
    await prisma.patrolCheckpoint.deleteMany({ where: { code: { startsWith: `IT-${marker}` } } });
    await prisma.employee.deleteMany({ where: { id: employeeId } });
    await prisma.user.deleteMany({ where: { id: managerId } });
  }

  test.before(async () => {
    await cleanup();
    await prisma.employee.create({ data: { id: employeeId, employeeCode: `IT${marker}`, firstName: 'Patrol', lastName: 'Guard', department: `ANO-${marker}` } });
    await prisma.user.create({ data: { id: managerId, email: `patrol-manager-${marker.toLowerCase()}@example.test`, passwordHash: 'synthetic-integration-hash-not-a-credential', displayName: 'Patrol Manager', role: 'MANAGER', department: `ANO-${marker}` } });
  });
  test.after(async () => { await cleanup(); await prisma.$disconnect(); });

  test('checkpoint, cross-department scan, idempotent replay and coverage persist through Prisma', async () => {
    const own = await service.createCheckpoint({ actor: admin, input: { code: `IT-${marker}-A`, name: 'Own dept', department: `ANO-${marker}` } });
    const other = await service.createCheckpoint({ actor: admin, input: { code: `IT-${marker}-B`, name: 'Other dept', department: `WCS-${marker}` } });
    await assert.rejects(service.createCheckpoint({ actor: admin, input: { code: `it-${marker}-a`, name: 'dup', department: 'X' } }), (error) => error.statusCode === 409);

    const clientScanId = crypto.randomUUID();
    const scan = await service.recordScan({ actor: guard, input: { qrPayload: other.qrPayload, clientScanId, latitude: '13.75', longitude: '100.5', accuracyMeters: '8' }, photo });
    assert.equal(scan.checkpointDepartment, `WCS-${marker}`);
    assert.equal(scan.employeeDepartment, `ANO-${marker}`);
    assert.equal(scan.workDate, '2026-10-30');
    const replay = await service.recordScan({ actor: guard, input: { qrPayload: other.qrPayload, clientScanId }, photo });
    assert.equal(replay.id, scan.id);
    assert.equal(await prisma.patrolScan.count({ where: { employeeId } }), 1);
    assert.equal(objects.size, 1);

    // ADMIN sees every department, including the cross-department scan.
    const report = await service.report({ actor: admin, from: '2026-10-30', to: '2026-10-30' });
    const ours = report.coverage.departments.filter((group) => group.department.endsWith(marker));
    assert.equal(ours.length, 2);
    assert.equal(ours.find((group) => group.department === `WCS-${marker}`).scanned, 1);
    assert.equal(ours.find((group) => group.department === `ANO-${marker}`).scanned, 0);
    assert.ok(report.scans.some((row) => row.id === scan.id && row.employeeCode === `IT${marker}` && row.checkpointCode === `IT-${marker}-B`));

    // OWNER policy 2026-10-30: MANAGER/SUPERVISOR are cross-department supervisors, so a real MANAGER in
    // ANO sees every department and may filter to WCS (previously pinned to ANO / 403).
    const managed = await service.report({ actor: manager, from: '2026-10-30', to: '2026-10-30' });
    assert.equal(managed.department, null);
    const managedOurs = managed.coverage.departments.filter((group) => group.department.endsWith(marker));
    assert.equal(managedOurs.length, 2);
    assert.ok(managed.scans.some((row) => row.id === scan.id), 'the WCS checkpoint scan is visible to the ANO manager');
    const crossDepartment = await service.report({ actor: manager, from: '2026-10-30', to: '2026-10-30', department: `WCS-${marker}` });
    assert.deepEqual(crossDepartment.coverage.departments.map((group) => group.department), [`WCS-${marker}`]);
    assert.ok(crossDepartment.scans.some((row) => row.id === scan.id));
    // Non-UUID or unknown subjects never reach the uuid column (no 500).
    for (const sub of ['m', crypto.randomUUID()]) {
      const report = await service.report({ actor: { sub, role: 'MANAGER' }, from: '2026-10-30', to: '2026-10-30', department: `ANO-${marker}` });
      assert.equal(report.department, `ANO-${marker}`);
    }
    await assert.rejects(service.report({ actor: guard, from: '2026-10-30', to: '2026-10-30' }), (error) => error.statusCode === 403);

    const filtered = await service.report({ actor: admin, from: '2026-10-30', to: '2026-10-30', department: `ANO-${marker}` });
    assert.equal(filtered.scans.length, 0);
    assert.equal(filtered.coverage.summary.checkpoints, 1);

    const rotated = await service.rotateQr({ actor: admin, checkpointId: own.id });
    await assert.rejects(service.resolveQr({ actor: guard, qrPayload: own.qrPayload }), (error) => error.statusCode === 404);
    assert.equal((await service.resolveQr({ actor: guard, qrPayload: rotated.qrPayload })).id, own.id);

    const bytes = await service.photo({ actor: guard, scanId: scan.id });
    assert.equal(bytes.mimeType, 'image/jpeg');
    assert.equal((await service.myScans({ actor: guard, date: '2026-10-30' })).length, 1);
  });
}
