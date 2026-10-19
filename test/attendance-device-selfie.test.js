'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { normalizeSelfie, config, createSupabaseAttendanceDeviceSelfieStorage } = require('../src/services/attendance-device-selfie-storage.service');

const JPEG = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////2wBDAf//////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAH/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAEFAqf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEDAQE/AX//xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oACAEBAAY/Av/EABQQAQAAAAAAAAAAAAAAAAAAABD/2gAIAQEAAT8h/9k=', 'base64');
const selfie = () => ({ mimeType: 'image/jpeg', buffer: JPEG });

test('FOREIGN selfie storage requires configured private storage and validates JPEG/PNG bytes', () => {
  assert.throws(() => config({}), (error) => error.statusCode === 503 && error.details.code === 'ATTENDANCE_SELFIE_STORAGE_NOT_CONFIGURED');
  const normalized = normalizeSelfie(selfie());
  assert.equal(normalized.mimeType, 'image/jpeg');
  assert.equal(normalized.sizeBytes, JPEG.length);
  assert.equal(normalized.checksum, crypto.createHash('sha256').update(JPEG).digest('hex'));
  assert.throws(() => normalizeSelfie({ mimeType: 'image/png', buffer: JPEG }), (error) => error.statusCode === 415);
});

test('storage upload uses private bucket check, HMAC path, random suffix, and private service headers', async () => {
  const calls = [];
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret-not-logged', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret' },
    fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: true, status: 200, json: async () => ({ public: false }) }; }
  });
  const result = await storage.put({ employeeId: '11111111-1111-4111-8111-111111111111', captureId: '22222222-2222-4222-8222-222222222222', selfie: selfie() });
  assert.match(result.objectKey, /^attendance-selfie\/[a-f0-9]{64}\/22222222-2222-4222-8222-222222222222-[a-f0-9]{8}\.jpg$/);
  assert.doesNotMatch(result.objectKey, /11111111-1111-4111-8111-111111111111/);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options['x-upsert'], undefined);
  assert.equal(calls[1].options.headers['x-upsert'], 'false');
});

test('retention purge removes only expired selfies and marks purgedAt', async () => {
  const now = new Date('2027-01-01T00:00:00.000Z');
  const expired = { id: 'expired', employeeId: 'employee-1', storageObjectKey: 'expired.jpg', retentionUntil: new Date('2026-12-31T23:59:59.000Z'), purgedAt: null };
  const current = { id: 'current', employeeId: 'employee-1', storageObjectKey: 'current.jpg', retentionUntil: new Date('2027-01-02T00:00:00.000Z'), purgedAt: null };
  const removed = [];
  const updates = [];
  const prisma = { attendanceDeviceSelfie: {
    findMany: async ({ where }) => { assert.deepEqual(where, { retentionUntil: { lt: now }, purgedAt: null }); return [expired]; },
    update: async ({ where, data }) => { updates.push({ where, data }); expired.purgedAt = data.purgedAt; return expired; }
  } };
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret' },
    prisma,
    fetchImpl: async (url, options) => { if (options?.method === 'DELETE') removed.push(url); return { ok: true, status: 200, json: async () => ({ public: false }) }; },
    clock: () => now
  });
  const result = await storage.purgeExpiredSelfies({ now });
  assert.deepEqual(result, { inspected: 1, purged: 1, failed: 0 });
  assert.equal(removed.length, 1);
  assert.equal(updates.length, 1);
  assert.deepEqual(updates[0], { where: { id: 'expired' }, data: { purgedAt: now } });
  assert.equal(current.purgedAt, null);
});

test('private bucket check fails closed when bucket is public or unavailable', async () => {
  for (const body of [{ public: true }, null]) {
    const storage = createSupabaseAttendanceDeviceSelfieStorage({
      environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret' },
      fetchImpl: async () => ({ ok: body !== null, status: body ? 200 : 500, json: async () => body })
    });
    await assert.rejects(() => storage.put({ employeeId: '11111111-1111-4111-8111-111111111111', captureId: '22222222-2222-4222-8222-222222222222', selfie: selfie() }), (error) => error.statusCode === 503 && error.details.code === 'ATTENDANCE_SELFIE_BUCKET_NOT_PRIVATE');
  }
});

test('device transfer routes are authenticated and ADMIN-only for list/approve/reject', () => {
  const source = fs.readFileSync('src/routes/attendance-device-transfer.routes.js', 'utf8');
  assert.match(source, /router\.use\(authenticate, authorize\('ADMIN'\)\)/);
  assert.match(source, /router\.get\('\/'/);
  assert.match(source, /router\.post\('\/:id\/approve'/);
  assert.match(source, /router\.post\('\/:id\/reject'/);
});

test('selfie migration is additive and has no data mutation or destructive SQL', () => {
  const migration = fs.readFileSync('prisma/migrations/202610190001_attendance_device_selfie/migration.sql', 'utf8');
  assert.match(migration, /CREATE TABLE "attendance_device_selfies"/);
  assert.match(migration, /CREATE (UNIQUE )?INDEX/);
  assert.match(migration, /FOREIGN KEY/);
  assert.doesNotMatch(migration, /^\s*(INSERT|UPDATE|DELETE|TRUNCATE|DROP)\b/im);
});

test('device transfer API is mounted under the admin attendance namespace', () => {
  const source = fs.readFileSync('src/routes/index.js', 'utf8');
  assert.match(source, /router\.use\('\/admin\/attendance\/device-transfers', attendanceDeviceTransferRoutes\)/);
});
