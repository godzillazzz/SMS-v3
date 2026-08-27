'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  EVIDENCE_STORAGE_STATUS,
  ATTENDANCE_EVIDENCE_RETENTION_DAYS,
  createNoopAttendanceFaceEvidenceStorage,
  createSupabaseAttendanceFaceEvidenceStorage,
  assertAttendanceFaceEvidenceStorage
} = require('../src/services/attendance-face-evidence-storage.service');

const env = {
  SUPABASE_URL: 'https://preview-project.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'preview-service-key',
  ATTENDANCE_FACE_EVIDENCE_BUCKET: 'attendance-face-evidence'
};

test('no-op storage never claims private evidence was persisted', async () => {
  const storage = createNoopAttendanceFaceEvidenceStorage();
  const result = await storage.store({});
  assert.equal(storage.provider, 'none');
  assert.equal(storage.storesBytes, false);
  assert.equal(result.storageStatus, EVIDENCE_STORAGE_STATUS.NOT_STORED);
  assert.equal(result.stored, false);
});

test('private adapter stores metadata with one-year rolling retention without exposing object key', async () => {
  const calls = [];
  const capturedAt = new Date('2026-08-27T10:00:00.000Z');
  let created;
  const prisma = {
    attendanceEvidence: {
      async create({ data }) {
        created = { id: 'evidence-1', ...data, purgedAt: null };
        return created;
      }
    }
  };
  const storage = createSupabaseAttendanceFaceEvidenceStorage({
    environment: env,
    prisma,
    audit: { async log(input) { calls.push(['audit', input]); } },
    fetchImpl: async (url, options) => {
      calls.push(['fetch', url, options.method]);
      return { ok: true, status: 200, async json() { return {}; } };
    },
    clock: () => capturedAt,
    randomUUID: () => 'object-1'
  });
  const bytes = Buffer.alloc(128, 7);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
  const result = await storage.store({
    sessionId: '33333333-3333-4333-8333-333333333333',
    employeeId: '11111111-1111-4111-8111-111111111111',
    referencePhotoId: '22222222-2222-4222-8222-222222222222',
    livePhotoBytes: bytes,
    mimeType: 'image/jpeg',
    capturedAt,
    verificationPassed: true
  });

  assert.equal(result.storageStatus, 'STORED');
  assert.equal(result.stored, true);
  assert.equal(result.id, 'evidence-1');
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'storageObjectKey'), false);
  assert.equal(created.storageBucket, 'attendance-face-evidence');
  assert.equal(created.retentionUntil.getTime() - capturedAt.getTime(), ATTENDANCE_EVIDENCE_RETENTION_DAYS * 86400000);
  assert.match(created.checksum, /^[0-9a-f]{64}$/);
  assert.ok(calls.some((call) => call[0] === 'fetch' && call[2] === 'POST'));
});

test('expired purge deletes bytes but preserves metadata and audit history', async () => {
  const calls = [];
  const now = new Date('2027-08-28T00:00:00.000Z');
  const row = {
    id: 'evidence-1',
    faceVerificationSessionId: 'session-1',
    employeeId: 'employee-1',
    storageProvider: 'supabase',
    storageObjectKey: 'attendance-face-evidence/employee-1/private.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 128,
    capturedAt: new Date('2026-08-27T00:00:00.000Z'),
    retentionUntil: new Date('2027-08-27T00:00:00.000Z'),
    purgeRequestedAt: null,
    purgedAt: null
  };
  const prisma = {
    attendanceEvidence: {
      async findMany() { return [row]; },
      async update({ data }) {
        return data.purgedAt
          ? { ...row, purgeRequestedAt: now, purgedAt: now }
          : { ...row, purgeRequestedAt: now };
      }
    }
  };
  const storage = createSupabaseAttendanceFaceEvidenceStorage({
    environment: env,
    prisma,
    audit: { async log(input) { calls.push(['audit', input]); } },
    fetchImpl: async (_url, options) => {
      calls.push(['fetch', options.method]);
      return { ok: true, status: 200, async json() { return {}; } };
    },
    clock: () => now
  });
  const result = await storage.purgeExpired();
  assert.deepEqual(result, { inspected: 1, purged: 1, failed: 0, retentionDays: 365 });
  assert.ok(calls.some((call) => call[0] === 'fetch' && call[1] === 'DELETE'));
  assert.ok(calls.some((call) => call[0] === 'audit' && call[1].metadata.event === 'PRIVATE_EVIDENCE_PURGED'));
});

test('storage abstraction requires store/remove so verifier compensation cannot be omitted', () => {
  const adapter = { async store() {}, async remove() {} };
  assert.equal(assertAttendanceFaceEvidenceStorage(adapter), adapter);
  assert.throws(() => assertAttendanceFaceEvidenceStorage({ async store() {} }), /store\(\) and remove\(\)/);
});

test('private evidence metadata migration enables RLS and revokes browser Data API roles', () => {
  const migration = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/202608270004_attendance_face_evidence_rls_v1/migration.sql'), 'utf8');
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /pg_roles/);
  assert.match(migration, /REVOKE ALL ON TABLE public\."attendance_evidence" FROM anon/);
  assert.match(migration, /REVOKE ALL ON TABLE public\."attendance_evidence" FROM authenticated/);
});
