'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createPatrolService, bangkokWorkDate, buildCoverage, PATROL_QR_PREFIX } = require('../src/services/patrol.service');

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(400)]);

function fakeDb() {
  const checkpoints = [];
  const scans = [];
  const employees = [
    { id: 'emp-a', employeeCode: 'EMP001', firstName: 'A', lastName: 'One', displayName: null, department: 'ANO', isActive: true, deletedAt: null },
    { id: 'emp-b', employeeCode: 'EMP002', firstName: 'B', lastName: 'Two', displayName: 'B Two', department: 'WCS', isActive: true, deletedAt: null }
  ];
  const db = {
    checkpoints, scans, employees,
    patrolCheckpoint: {
      async findMany({ where = {} } = {}) {
        return checkpoints.filter((row) => (where.isActive === undefined || row.isActive === where.isActive) && (!where.department || row.department === where.department)).map((row) => ({ ...row }));
      },
      async findUnique({ where }) { return checkpoints.find((row) => (where.id && row.id === where.id) || (where.qrToken && row.qrToken === where.qrToken) || (where.code && row.code === where.code)) || null; },
      async create({ data }) {
        if (checkpoints.some((row) => row.code === data.code)) { const error = new Error('unique'); error.code = 'P2002'; error.meta = { target: ['code'] }; throw error; }
        const row = { id: crypto.randomUUID(), qrVersion: 1, sortOrder: 0, isActive: true, locationNote: null, createdAt: new Date(), updatedAt: new Date(), qrRotatedAt: new Date(), ...data };
        checkpoints.push(row); return { ...row };
      },
      async update({ where, data }) {
        const row = checkpoints.find((item) => item.id === where.id); if (!row) { const error = new Error('missing'); error.code = 'P2025'; throw error; }
        for (const [key, value] of Object.entries(data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : value;
        return { ...row };
      }
    },
    patrolScan: {
      async create({ data }) {
        if (scans.some((row) => row.clientScanId === data.clientScanId)) { const error = new Error('unique'); error.code = 'P2002'; error.meta = { target: ['client_scan_id'] }; throw error; }
        const row = { id: crypto.randomUUID(), createdAt: new Date(), ...data }; scans.push(row); return { ...row };
      },
      async findUnique({ where }) { return scans.find((row) => (where.id && row.id === where.id) || (where.clientScanId && row.clientScanId === where.clientScanId)) || null; },
      async findMany({ where = {} } = {}) {
        return scans.filter((row) => {
          if (where.workDate?.gte && row.workDate < where.workDate.gte) return false;
          if (where.workDate?.lte && row.workDate > where.workDate.lte) return false;
          if (where.checkpointDepartment && row.checkpointDepartment !== where.checkpointDepartment) return false;
          return true;
        }).map((row) => ({ ...row, employee: employees.find((employee) => employee.id === row.employeeId), checkpoint: checkpoints.find((checkpoint) => checkpoint.id === row.checkpointId) }));
      }
    },
    employee: { async findUnique({ where }) { return employees.find((row) => row.id === where.id) || null; } }
  };
  return db;
}

function fakeStorage() {
  const objects = new Map();
  return {
    objects,
    bucket: 'patrol-photos',
    provider: 's3',
    async put(key, file) { objects.set(key, file.buffer); return { provider: 's3', bucket: 'patrol-photos', objectKey: key, sha256: crypto.createHash('sha256').update(file.buffer).digest('hex'), sizeBytes: file.buffer.length }; },
    async remove(key) { objects.delete(key); },
    async get(key) { return objects.get(key); }
  };
}

const admin = { sub: 'user-admin', role: 'ADMIN', employeeAuthority: null };
const guardA = { sub: 'user-a', role: 'VIEWER', employeeAuthority: { id: 'emp-a', isActive: true, deletedAt: null } };
const unlinked = { sub: 'user-x', role: 'VIEWER', employeeAuthority: null };

function service(overrides = {}) {
  const db = fakeDb(); const storage = fakeStorage(); const audits = [];
  const clock = overrides.clock || (() => new Date('2026-10-30T03:00:00.000Z'));
  const svc = createPatrolService({ prisma: db, storage, audit: { log: async (entry) => { audits.push(entry); } }, clock, randomBytes: (n) => Buffer.alloc(n, 7), ...overrides });
  return { svc, db, storage, audits };
}

test('work date follows Asia/Bangkok, not UTC', () => {
  assert.equal(bangkokWorkDate(new Date('2026-10-29T18:30:00.000Z')), '2026-10-30');
  assert.equal(bangkokWorkDate(new Date('2026-10-30T16:59:00.000Z')), '2026-10-30');
});

test('only ADMIN may create checkpoints; QR payload carries a prefixed random token', async () => {
  const { svc, audits } = service();
  await assert.rejects(svc.createCheckpoint({ actor: guardA, input: { code: 'CP1', name: 'Gate', department: 'ANO' } }), (error) => error.statusCode === 403);
  const created = await svc.createCheckpoint({ actor: admin, input: { code: ' cp-01 ', name: 'ประตูหน้า', department: 'ANO', locationNote: 'ข้างป้อม' } });
  assert.equal(created.code, 'CP-01');
  assert.ok(created.qrPayload.startsWith(PATROL_QR_PREFIX));
  assert.equal(created.qrPayload.length, PATROL_QR_PREFIX.length + 43);
  assert.equal(audits.at(-1).metadata.event, 'PATROL_CHECKPOINT_CREATED');
  assert.equal(JSON.stringify(audits).includes(created.qrPayload), false, 'audit must not leak QR token');
  await assert.rejects(svc.createCheckpoint({ actor: admin, input: { code: 'cp-01', name: 'dup', department: 'ANO' } }), (error) => error.statusCode === 409);
});

test('rotating QR invalidates the previous token', async () => {
  const { svc } = service({ randomBytes: (n) => crypto.randomBytes(n) });
  const created = await svc.createCheckpoint({ actor: admin, input: { code: 'CP1', name: 'Gate', department: 'ANO' } });
  const rotated = await svc.rotateQr({ actor: admin, checkpointId: created.id });
  assert.notEqual(rotated.qrPayload, created.qrPayload);
  assert.equal(rotated.qrVersion, 2);
  await assert.rejects(svc.resolveQr({ actor: guardA, qrPayload: created.qrPayload }), (error) => error.statusCode === 404);
  assert.equal((await svc.resolveQr({ actor: guardA, qrPayload: rotated.qrPayload })).id, created.id);
});

test('any linked employee may scan a checkpoint of another department, with one photo per scan', async () => {
  const { svc, db, storage, audits } = service({ randomBytes: (n) => crypto.randomBytes(n) });
  const cp = await svc.createCheckpoint({ actor: admin, input: { code: 'CP-W1', name: 'คลัง WCS', department: 'WCS' } });
  const clientScanId = crypto.randomUUID();
  const scan = await svc.recordScan({ actor: guardA, input: { qrPayload: cp.qrPayload, clientScanId, latitude: 13.7, longitude: 100.5, accuracyMeters: 12 }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } });
  assert.equal(scan.checkpointDepartment, 'WCS');
  assert.equal(scan.employeeDepartment, 'ANO');
  assert.equal(scan.workDate, '2026-10-30');
  assert.equal(db.scans.length, 1);
  assert.equal(storage.objects.size, 1);
  assert.match(db.scans[0].photoObjectKey, /^patrol-scan\/2026-10\/[0-9a-f-]{36}\.jpg$/);
  assert.equal(db.scans[0].photoChecksum, crypto.createHash('sha256').update(JPEG).digest('hex'));
  assert.equal(audits.at(-1).metadata.event, 'PATROL_SCAN_RECORDED');

  const replay = await svc.recordScan({ actor: guardA, input: { qrPayload: cp.qrPayload, clientScanId }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } });
  assert.equal(replay.id, scan.id, 'same clientScanId is idempotent');
  assert.equal(replay.replayed, true);
  assert.equal(db.scans.length, 1);
  assert.equal(storage.objects.size, 1, 'replay must not leave a second object');
});

test('scan is rejected without a valid photo, for an unknown QR, an inactive checkpoint, or an unlinked account', async () => {
  const { svc, db, storage } = service({ randomBytes: (n) => crypto.randomBytes(n) });
  const cp = await svc.createCheckpoint({ actor: admin, input: { code: 'CP1', name: 'Gate', department: 'ANO' } });
  const base = { qrPayload: cp.qrPayload, clientScanId: crypto.randomUUID() };
  await assert.rejects(svc.recordScan({ actor: guardA, input: base, photo: null }), (error) => error.details?.code === 'PATROL_PHOTO_REQUIRED');
  await assert.rejects(svc.recordScan({ actor: guardA, input: base, photo: { buffer: Buffer.from('GIF89a-not-a-photo'), mimetype: 'image/gif' } }), (error) => error.details?.code === 'PATROL_PHOTO_INVALID');
  await assert.rejects(svc.recordScan({ actor: guardA, input: { ...base, qrPayload: `${PATROL_QR_PREFIX}unknown-token-unknown-token-unknown-token-x` }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } }), (error) => error.statusCode === 404);
  await assert.rejects(svc.recordScan({ actor: unlinked, input: base, photo: { buffer: JPEG, mimetype: 'image/jpeg' } }), (error) => error.statusCode === 403);
  await svc.updateCheckpoint({ actor: admin, checkpointId: cp.id, input: { isActive: false } });
  await assert.rejects(svc.recordScan({ actor: guardA, input: base, photo: { buffer: JPEG, mimetype: 'image/jpeg' } }), (error) => error.details?.code === 'PATROL_CHECKPOINT_INACTIVE');
  assert.equal(db.scans.length, 0);
  assert.equal(storage.objects.size, 0);
});

test('a database failure after upload removes the orphaned photo', async () => {
  const { svc, db, storage } = service({ randomBytes: (n) => crypto.randomBytes(n) });
  const cp = await svc.createCheckpoint({ actor: admin, input: { code: 'CP1', name: 'Gate', department: 'ANO' } });
  db.patrolScan.create = async () => { throw new Error('db down'); };
  await assert.rejects(svc.recordScan({ actor: guardA, input: { qrPayload: cp.qrPayload, clientScanId: crypto.randomUUID() }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } }));
  assert.equal(storage.objects.size, 0);
});

test('coverage marks each checkpoint scanned or pending for the day, grouped by department', async () => {
  const checkpoints = [
    { id: 'c1', code: 'A1', name: 'A1', department: 'ANO', sortOrder: 1, isActive: true },
    { id: 'c2', code: 'A2', name: 'A2', department: 'ANO', sortOrder: 2, isActive: true },
    { id: 'c3', code: 'W1', name: 'W1', department: 'WCS', sortOrder: 1, isActive: true }
  ];
  const scans = [
    { id: 's1', checkpointId: 'c1', scannedAt: new Date('2026-10-30T01:00:00Z'), workDate: new Date('2026-10-30T00:00:00Z'), employee: { employeeCode: 'EMP002', displayName: 'B Two' } },
    { id: 's2', checkpointId: 'c1', scannedAt: new Date('2026-10-30T05:00:00Z'), workDate: new Date('2026-10-30T00:00:00Z'), employee: { employeeCode: 'EMP001', firstName: 'A', lastName: 'One' } }
  ];
  const coverage = buildCoverage({ checkpoints, scans, dates: ['2026-10-30'] });
  assert.deepEqual(coverage.summary, { checkpoints: 3, scanned: 1, pending: 2, scans: 2, percent: 33 });
  const ano = coverage.departments.find((item) => item.department === 'ANO');
  assert.equal(ano.checkpoints[0].days['2026-10-30'].count, 2);
  assert.equal(ano.checkpoints[0].days['2026-10-30'].lastScanAt, '2026-10-30T05:00:00.000Z');
  assert.equal(ano.checkpoints[1].days['2026-10-30'].count, 0);
  assert.equal(coverage.departments.find((item) => item.department === 'WCS').scanned, 0);
});

test('report access: VIEWER is limited to own scans; MANAGER/SUPERVISOR/ADMIN see all departments', async () => {
  const { svc } = service({ randomBytes: (n) => crypto.randomBytes(n) });
  const cp = await svc.createCheckpoint({ actor: admin, input: { code: 'CP1', name: 'Gate', department: 'ANO' } });
  await svc.recordScan({ actor: guardA, input: { qrPayload: cp.qrPayload, clientScanId: crypto.randomUUID() }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } });
  await assert.rejects(svc.report({ actor: guardA, from: '2026-10-30', to: '2026-10-30' }), (error) => error.statusCode === 403);
  const report = await svc.report({ actor: { sub: 'm', role: 'MANAGER' }, from: '2026-10-30', to: '2026-10-30' });
  assert.equal(report.scans.length, 1);
  assert.equal(report.scans[0].photoUrl, `/api/v1/patrol/scans/${report.scans[0].id}/photo`);
  assert.equal('photoObjectKey' in report.scans[0], false, 'storage keys are never exposed');
  await assert.rejects(svc.report({ actor: admin, from: '2026-10-01', to: '2027-01-30' }), (error) => error.details?.code === 'PATROL_RANGE_TOO_LARGE');
  const mine = await svc.myScans({ actor: guardA, date: '2026-10-30' });
  assert.equal(mine.length, 1);
});

test('report carries round coverage: 8 rounds x 3h from 07:00 Bangkok, after-midnight scans belong to the previous patrol day', async () => {
  const times = ['2026-10-30T00:10:00.000Z', '2026-10-30T00:40:00.000Z', '2026-10-30T06:30:00.000Z', '2026-10-30T20:00:00.000Z', '2026-10-31T00:05:00.000Z'];
  let index = 0;
  const { svc } = service({ randomBytes: (n) => crypto.randomBytes(n), clock: () => new Date(times[Math.min(index, times.length - 1)]) });
  const cp = await svc.createCheckpoint({ actor: admin, input: { code: 'CP1', name: 'Gate', department: 'ANO' } });
  for (index = 0; index < times.length; index += 1) {
    await svc.recordScan({ actor: guardA, input: { qrPayload: cp.qrPayload, clientScanId: crypto.randomUUID() }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } });
  }
  const report = await svc.report({ actor: admin, from: '2026-10-30', to: '2026-10-30' });
  assert.deepEqual(report.rounds.config, { perDay: 8, hours: 3, startHour: 7, timeZone: 'Asia/Bangkok' });
  // 07:10 and 07:40 -> round 1 (once), 13:30 -> round 3, 03:00 next calendar day -> round 7; 07:05 on 31 Oct is the next patrol day
  assert.deepEqual(report.rounds.byCheckpoint[cp.id]['2026-10-30'], [1, 3, 7]);
  assert.equal(report.rounds.byCheckpoint[cp.id]['2026-10-31'], undefined);
});

test('progress lets a linked guard see the current round for a department without QR tokens or other guards\' identities', async () => {
  const { svc } = service({ randomBytes: (n) => crypto.randomBytes(n), clock: () => new Date('2026-10-30T06:30:00.000Z') });
  const a = await svc.createCheckpoint({ actor: admin, input: { code: 'A1', name: 'Gate', department: 'ANO' } });
  await svc.createCheckpoint({ actor: admin, input: { code: 'A2', name: 'Yard', department: 'ANO' } });
  await svc.createCheckpoint({ actor: admin, input: { code: 'W1', name: 'Store', department: 'WCS' } });
  await svc.recordScan({ actor: guardA, input: { qrPayload: a.qrPayload, clientScanId: crypto.randomUUID() }, photo: { buffer: JPEG, mimetype: 'image/jpeg' } });
  const progress = await svc.progress({ actor: guardA });
  assert.equal(progress.department, 'ANO', 'defaults to the guard\'s own department');
  assert.deepEqual(progress.departments, ['ANO', 'WCS']);
  assert.equal(progress.patrolDay, '2026-10-30');
  assert.equal(progress.round, 3);
  assert.equal(progress.checkpoints.length, 2);
  assert.equal(progress.checkpoints.some((item) => 'qrPayload' in item || 'qrToken' in item), false);
  assert.deepEqual(progress.checkpoints.map((item) => [item.code, item.doneThisRound]), [['A1', true], ['A2', false]]);
  const other = await svc.progress({ actor: guardA, department: 'WCS' });
  assert.deepEqual(other.checkpoints.map((item) => item.code), ['W1']);
  await assert.rejects(svc.progress({ actor: unlinked }), (error) => error.statusCode === 403);
});
