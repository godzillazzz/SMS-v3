'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { validateReferencePhoto, imageDimensions, storageConfig, createSupabaseEmployeeReferencePhotoStorage } = require('../src/services/employee-reference-photo-storage.service');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
function png(width = 512, height = 512) { const b = Buffer.alloc(32); Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]).copy(b,0); b.writeUInt32BE(width,16); b.writeUInt32BE(height,20); return b; }

test('schema/migration create a governed Reference Photo sub-resource with one ACTIVE and one pending per Employee', () => {
  const schema = read('prisma/schema.prisma'); const migration = read('prisma/migrations/202608240001_g06_employee_reference_photo_v1/migration.sql');
  assert.match(schema, /enum EmployeeReferencePhotoStatus[\s\S]*PENDING_APPROVAL[\s\S]*ACTIVE[\s\S]*SUPERSEDED/);
  assert.match(schema, /model EmployeeReferencePhoto/);
  assert.doesNotMatch(schema, /referencePhotoUrl|reference_photo_url/);
  assert.match(migration, /employee_reference_photos_one_active_per_employee[\s\S]*WHERE "status" = 'ACTIVE'/);
  assert.match(migration, /employee_reference_photos_one_pending_per_employee[\s\S]*WHERE "status" = 'PENDING_APPROVAL'/);
});

test('route contract authenticates all endpoints and keeps final review ADMIN-only', () => {
  const route = read('src/routes/employee-reference-photo.routes.js'); const index = read('src/routes/index.js');
  assert.ok(route.includes('router.use(authenticate)'));
  assert.ok(route.includes("router.post('/:id/approve', authorize('ADMIN')"));
  assert.ok(route.includes("router.post('/:id/reject', authorize('ADMIN')"));
  assert.ok(route.includes("router.post('/:id/cancel', authorize('MANAGER')"));
  assert.ok(index.includes("router.use('/employee-reference-photos', employeeReferencePhotoRoutes)"));
});

test('upload validation accepts real PNG signature/dimensions and rejects non-image or unsafe dimensions', () => {
  const good = png(); const info = validateReferencePhoto({ buffer: good, size: good.length, mimetype: 'image/png' });
  assert.equal(info.mimeType, 'image/png'); assert.equal(info.width, 512); assert.equal(info.height, 512); assert.equal(info.checksum.length, 64);
  assert.deepEqual(imageDimensions(png(640,480), 'png'), { width: 640, height: 480 });
  assert.throws(() => validateReferencePhoto({ buffer: Buffer.from('%PDF-1.4'), size: 8, mimetype: 'application/pdf' }), /JPEG or PNG/);
  assert.throws(() => validateReferencePhoto({ buffer: png(100,100), size: 32, mimetype: 'image/png' }), /256x256/);
});

test('storage configuration is private and requires a dedicated Reference Photo bucket', () => {
  assert.throws(() => storageConfig({}), /not configured/);
  const config = storageConfig({ SUPABASE_URL: 'https://example.test/rest/v1/', SUPABASE_SERVICE_ROLE_KEY: 'test-only', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos' });
  assert.equal(config.url, 'https://example.test'); assert.equal(config.bucket, 'employee-reference-photos');
  assert.throws(() => storageConfig({ SUPABASE_URL: 'not-a-url', SUPABASE_SERVICE_ROLE_KEY: 'test-only', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos' }), /not configured/);
});

test('private storage byte-read uses the object API, enforces size/type guards, and never creates a public URL', async () => {
  const image = png();
  const calls = [];
  const storage = createSupabaseEmployeeReferencePhotoStorage({
    environment: { SUPABASE_URL: 'https://example.test/rest/v1/', SUPABASE_SERVICE_ROLE_KEY: 'test-only', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos' },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200, headers: { get: (name) => name.toLowerCase() === 'content-length' ? String(image.length) : null }, arrayBuffer: async () => image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) };
    }
  });
  const result = await storage.getBytes('employee-id/reference.png');
  assert.deepEqual(result, image);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'GET');
  assert.match(calls[0].url, /^https:\/\/example\.test\/storage\/v1\/object\/employee-reference-photos\//);
  assert.equal(calls[0].url.includes('/sign/'), false);

  const oversized = createSupabaseEmployeeReferencePhotoStorage({
    environment: { SUPABASE_URL: 'https://example.test', SUPABASE_SERVICE_ROLE_KEY: 'test-only', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos' },
    fetchImpl: async () => ({ ok: true, status: 200, headers: { get: () => String((4 * 1024 * 1024) + 1) }, arrayBuffer: async () => { throw new Error('must not read oversized body'); } })
  });
  await assert.rejects(() => oversized.getBytes('employee-id/reference.png'), (error) => error.details?.code === 'REFERENCE_PHOTO_STORAGE_READ_FAILED');
});

test('private storage deletion is idempotent when the object is already absent', async () => {
  const calls = [];
  const storage = createSupabaseEmployeeReferencePhotoStorage({ environment: { SUPABASE_URL: 'https://example.test/rest/v1/', SUPABASE_SERVICE_ROLE_KEY: 'test-only', EMPLOYEE_REFERENCE_PHOTOS_BUCKET: 'employee-reference-photos' }, fetchImpl: async (url, options) => { calls.push({ url, options }); return { ok: false, status: 404 }; } });
  await storage.remove('employee-reference-photos/employee/photo.png');
  assert.equal(calls.length, 1); assert.equal(calls[0].options.method, 'DELETE');
  assert.match(calls[0].url, /^https:\/\/example\.test\/storage\/v1\/object\//);
});

test('service implements post-commit deletion, fail-closed viewing, retry foundation, and 60-second signed URLs', () => {
  const service = read('src/services/employee-reference-photo.service.js');
  const txEnd = service.indexOf('const cleanup = superseded ? await cleanupObject(superseded)');
  assert.ok(txEnd > service.indexOf('await prisma.$transaction'));
  assert.ok(service.indexOf('const preexistingPending') < service.indexOf('await storage.put(objectKey, file)'));
  assert.match(service, /status !== 'ACTIVE' && !allowedPending/);
  assert.match(service, /storageDeletionRequestedAt/);
  assert.ok(service.includes('createSignedUrl(row.storageObjectKey, 60)'));
  assert.match(service, /retryPendingDeletions/);
  assert.doesNotMatch(service, /employeeCode/);
});

test('Employee Master UI owns Reference Photo governance and preserves V1 event-photo policy', () => {
  const editor = read('frontend/src/components/personnel/EmployeeGovernedEditModal.tsx'); const panel = read('frontend/src/components/personnel/EmployeeReferencePhotoPanel.tsx');
  assert.match(editor, /EmployeeReferencePhotoPanel/);
  assert.match(panel, /รูปอ้างอิงพนักงาน/);
  assert.match(panel, /Retention A/);
  assert.match(panel, /รูปเดิมยัง ACTIVE จนกว่า Admin อนุมัติ/);
  assert.ok(panel.includes('Live face/liveness frames และรูป Check-in/Check-out/Patrol ไม่ถูกเก็บ'));
  assert.ok(panel.includes('persistent biometric templates/embeddings ยังไม่อยู่ใน scope'));
});

test('frontend API uses multipart photo upload and never exposes a storage object key contract', () => {
  const api = read('frontend/src/api.ts');
  assert.match(api, /uploadEmployeeReferencePhoto/); assert.match(api, /callMultipart/); assert.match(api, /approveEmployeeReferencePhoto/); assert.match(api, /rejectEmployeeReferencePhoto/);
  const panel = read('frontend/src/components/personnel/EmployeeReferencePhotoPanel.tsx'); assert.doesNotMatch(panel, /storageObjectKey|storageBucket|SUPABASE_SERVICE_ROLE_KEY/);
});
