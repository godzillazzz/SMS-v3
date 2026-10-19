'use strict';

process.env.NODE_ENV = 'test';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { normalizeSelfie, config, createSupabaseAttendanceDeviceSelfieStorage } = require('../src/services/attendance-device-selfie-storage.service');

const JPEG = Buffer.from('/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgj/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABykX//Z', 'base64');
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
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret-not-logged', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret-with-at-least-thirty-two-bytes' },
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
  const expired = { id: 'expired', employeeId: 'employee-1', storageObjectKey: 'attendance-selfie/hash/expired.jpg', retentionUntil: new Date('2026-12-31T23:59:59.000Z'), purgedAt: null };
  const current = { id: 'current', employeeId: 'employee-1', storageObjectKey: 'current.jpg', retentionUntil: new Date('2027-01-02T00:00:00.000Z'), purgedAt: null };
  const removed = [];
  const updates = [];
  const prisma = { attendanceDeviceSelfie: {
    findMany: async ({ where }) => { assert.deepEqual(where, { retentionUntil: { lt: now }, purgedAt: null }); return [expired]; },
    update: async ({ where, data }) => { updates.push({ where, data }); expired.purgedAt = data.purgedAt; return expired; }
  } };
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret-with-at-least-thirty-two-bytes' },
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
      environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'path-secret-with-at-least-thirty-two-bytes' },
      fetchImpl: async () => ({ ok: body !== null, status: body ? 200 : 500, json: async () => body })
    });
    await assert.rejects(() => storage.put({ employeeId: '11111111-1111-4111-8111-111111111111', captureId: '22222222-2222-4222-8222-222222222222', selfie: selfie() }), (error) => error.statusCode === 503 && error.details.code === 'ATTENDANCE_SELFIE_BUCKET_NOT_PRIVATE');
  }
});

test('SELFIE_PATH_SECRET fails closed for weak values and accepts strong entropy', async () => {
  for (const secret of ['', 'short', 'changeme', 'secret-with-more-than-thirty-two-characters']) {
    const storage = createSupabaseAttendanceDeviceSelfieStorage({ environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: secret }, fetchImpl: async () => ({ ok: true, json: async () => ({ public: false }) }) });
    await assert.rejects(() => storage.assertPrivate(), (error) => error.statusCode === 503 && error.details.code === 'ATTENDANCE_SELFIE_PATH_SECRET_WEAK');
  }
  const storage = createSupabaseAttendanceDeviceSelfieStorage({ environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' }, fetchImpl: async () => ({ ok: true, json: async () => ({ public: false }) }) });
  await assert.doesNotReject(() => storage.assertPrivate());
});

test('reconcileOrphans deletes old objects without rows and keeps objects with rows', async () => {
  const now = new Date('2027-01-01T00:00:00.000Z'); const deleted = []; const audits = [];
  const prisma = { attendanceDeviceSelfie: { findMany: async () => [{ storageObjectKey: 'attendance-selfie/hash/kept.jpg' }] } };
  const storage = createSupabaseAttendanceDeviceSelfieStorage({ environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' }, prisma, audit: { log: async (entry) => audits.push(entry) }, clock: () => now, fetchImpl: async (url, options) => {
    if (url.includes('/object/list/')) return { ok: true, json: async () => [{ id: '1', name: 'hash/orphan.jpg', updated_at: '2026-12-31T00:00:00.000Z' }, { id: '2', name: 'hash/kept.jpg', updated_at: '2026-12-31T00:00:00.000Z' }] };
    if (options.method === 'DELETE') { deleted.push(url); return { ok: true, json: async () => ({}) }; }
    return { ok: true, json: async () => ({ public: false }) };
  } });
  assert.deepEqual(await storage.reconcileOrphans({ now, olderThanMs: 60 * 60 * 1000 }), { scanned: 2, deleted: 1, kept: 1, failed: 0, skippedRecent: 0, skippedUnknown: 0, truncated: false, limitReached: null });
  assert.equal(deleted.length, 1); assert.match(deleted[0], /orphan\.jpg/); assert.equal(audits[0].metadata.event, 'ATTENDANCE_SELFIE_ORPHAN_RECONCILED');
  assert.equal(audits[0].metadata.skippedRecent, 0); assert.equal(audits[0].metadata.skippedUnknown, 0);
});

test('reconcileOrphans fails closed when the selfie row query is unavailable', async () => {
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    fetchImpl: async (url) => url.includes('/object/list/') ? { ok: true, json: async () => [] } : { ok: true, json: async () => ({}) }
  });
  await assert.rejects(() => storage.reconcileOrphans(), (error) => error.statusCode === 503 && error.details.code === 'ATTENDANCE_SELFIE_RECONCILE_UNAVAILABLE');
});

test('reconcile reports batch limit and skips recent/unknown timestamps', async () => {
  const now = new Date('2027-01-01T00:00:00.000Z'); const deleted = []; const audits = [];
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    prisma: { attendanceDeviceSelfie: { findMany: async () => [] } }, audit: { log: async (entry) => audits.push(entry) },
    fetchImpl: async (url, options) => {
      if (url.includes('/object/list/')) return { ok: true, json: async () => [
        { id: '1', name: 'old.jpg', updated_at: '2026-12-01T00:00:00.000Z' },
        { id: '2', name: 'recent.jpg', updated_at: '2026-12-31T23:30:00.000Z' },
        { id: '3', name: 'unknown.jpg' }
      ] };
      if (options.method === 'DELETE') { deleted.push(url); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({}) };
    }
  });
  const result = await storage.reconcileOrphans({ now, olderThanMs: 60 * 60 * 1000, limit: 2 });
  assert.deepEqual(result, { scanned: 2, deleted: 1, kept: 0, failed: 0, skippedRecent: 1, skippedUnknown: 0, truncated: true, limitReached: 'RECONCILE_LIMIT' });
  assert.equal(audits[0].metadata.limitReached, 'RECONCILE_LIMIT'); assert.equal(audits[0].metadata.skippedRecent, 1); assert.equal(deleted.length, 1);
});

test('reconcileOrphans honors olderThanMs zero and keeps the default age', async () => {
  const now = new Date('2027-01-01T00:00:00.000Z');
  const object = { id: '1', name: 'thirty-minutes-old.jpg', updated_at: '2026-12-31T23:30:00.000Z' };
  const makeStorage = (deleted) => createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    prisma: { attendanceDeviceSelfie: { findMany: async () => [] } },
    fetchImpl: async (url, options) => {
      if (url.includes('/object/list/')) return { ok: true, json: async () => [object] };
      if (options.method === 'DELETE') { deleted.push(url); return { ok: true, json: async () => ({}) }; }
      return { ok: true, json: async () => ({}) };
    }
  });
  const deletedWithZero = [];
  const zeroResult = await makeStorage(deletedWithZero).reconcileOrphans({ now, olderThanMs: 0 });
  assert.equal(zeroResult.deleted, 1);
  assert.equal(zeroResult.skippedRecent, 0);
  assert.equal(deletedWithZero.length, 1);
  const deletedWithDefault = [];
  const defaultResult = await makeStorage(deletedWithDefault).reconcileOrphans({ now });
  assert.equal(defaultResult.deleted, 0);
  assert.equal(defaultResult.skippedRecent, 1);
  assert.equal(deletedWithDefault.length, 0);
});

test('reconcile audit records the real depth limit', async () => {
  const audits = [];
  const prisma = { attendanceDeviceSelfie: { findMany: async () => [] } };
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    prisma, audit: { log: async (entry) => audits.push(entry) },
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      if (payload.prefix === 'attendance-selfie/') return { ok: true, json: async () => [{ name: 'a' }] };
      if (payload.prefix === 'attendance-selfie/a/') return { ok: true, json: async () => [{ name: 'b' }] };
      if (payload.prefix === 'attendance-selfie/a/b/') return { ok: true, json: async () => [{ name: 'c' }] };
      if (payload.prefix === 'attendance-selfie/a/b/c/') return { ok: true, json: async () => [{ name: 'd' }] };
      throw new Error('unexpected prefix');
    }
  });
  const result = await storage.reconcileOrphans({ olderThanMs: 0 });
  assert.equal(result.truncated, true);
  assert.equal(result.limitReached, 'MAX_DEPTH');
  assert.equal(audits[0].metadata.limitReached, 'MAX_DEPTH');
});

test('listObjects recursively lists nested folders and paginates every page', async () => {
  const calls = [];
  const files = Array.from({ length: 150 }, (_, index) => ({ id: `file-${index}`, name: `capture-${index}.jpg`, updated_at: '2026-12-31T00:00:00.000Z' }));
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body); calls.push(payload);
      if (payload.prefix === 'attendance-selfie/') return { ok: true, json: async () => [{ name: 'employee-hash' }] };
      if (payload.prefix === 'attendance-selfie/employee-hash/') return { ok: true, json: async () => [{ name: 'capture-folder' }] };
      if (payload.prefix === 'attendance-selfie/employee-hash/capture-folder/') return { ok: true, json: async () => files.slice(payload.offset, payload.offset + payload.limit) };
      throw new Error(`unexpected prefix ${payload.prefix}`);
    }
  });
  const result = await storage.listObjects();
  assert.equal(result.objects.length, 150);
  assert.equal(result.objects[0].path, 'attendance-selfie/employee-hash/capture-folder/capture-0.jpg');
  assert.equal(result.objects[149].id, 'file-149');
  assert.equal(result.truncated, false);
  assert.deepEqual(calls.filter((call) => call.prefix.endsWith('capture-folder/')).map((call) => call.offset), [0, 100]);
});

test('listObjects stops at 5000 objects and reports truncated', async () => {
  let requests = 0;
  const storage = createSupabaseAttendanceDeviceSelfieStorage({
    environment: { SUPABASE_URL: 'https://private.example.test', SUPABASE_SERVICE_ROLE_KEY: 'secret', ATTENDANCE_DEVICE_SELFIE_BUCKET: 'attendance-selfies', SELFIE_PATH_SECRET: 'strong-random-path-secret-0123456789' },
    fetchImpl: async (url, options) => {
      requests += 1;
      const payload = JSON.parse(options.body);
      if (payload.prefix === 'attendance-selfie/') return { ok: true, json: async () => [{ name: 'employee-hash' }] };
      return { ok: true, json: async () => Array.from({ length: 100 }, (_, index) => ({ id: `${payload.offset + index}`, name: `capture-${payload.offset + index}.jpg` })) };
    }
  });
  const result = await storage.listObjects();
  assert.equal(result.objects.length, 5000);
  assert.equal(result.truncated, true);
  assert.equal(requests, 51);
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
