'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  ATTACHMENT_PROFILES,
  detectedType,
  optimizeAttachment,
  validateAttachment
} = require('../src/services/attachment-optimizer.service');

function file(buffer, mimetype, originalname = 'upload.bin') {
  return { buffer, mimetype, originalname, size: buffer.length };
}

async function noisyJpeg(width = 1800, height = 1200, quality = 100) {
  const raw = Buffer.alloc(width * height * 3);
  let state = 0x12345678;
  for (let i = 0; i < width * height; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    const n = state % 20;
    const value = 235 + n;
    raw[i * 3] = value;
    raw[(i * 3) + 1] = value;
    raw[(i * 3) + 2] = value;
  }
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg({ quality, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

test('shared attachment profiles lock the Owner-approved V1 targets and hard limits', () => {
  const document = ATTACHMENT_PROFILES.DOCUMENT;
  const reference = ATTACHMENT_PROFILES.EMPLOYEE_REFERENCE_PHOTO;
  const attendance = ATTACHMENT_PROFILES.ATTENDANCE_FACE;
  assert.equal(document.imageTargetMinBytes, 300 * 1024);
  assert.equal(document.imageTargetMaxBytes, 450 * 1024);
  assert.equal(document.imageHardLimitBytes, 500 * 1024);
  assert.equal(document.pdfHardLimitBytes, 1024 * 1024);
  assert.equal(reference.imageTargetMinBytes, 400 * 1024);
  assert.equal(reference.imageTargetMaxBytes, 700 * 1024);
  assert.equal(reference.imageHardLimitBytes, 1024 * 1024);
  assert.equal(attendance.imageTargetMinBytes, 150 * 1024);
  assert.equal(attendance.imageTargetMaxBytes, 300 * 1024);
  assert.equal(attendance.imageHardLimitBytes, 1024 * 1024);
});

test('signature detection rejects MIME spoofing instead of trusting browser metadata', async () => {
  const jpeg = await noisyJpeg(512, 512, 90);
  assert.equal(detectedType(jpeg), 'jpeg');
  await assert.rejects(
    () => optimizeAttachment(file(jpeg, 'image/png', 'spoof.png'), 'DOCUMENT'),
    (error) => error?.details?.code === 'ATTACHMENT_MIME_MISMATCH'
  );
  await assert.rejects(
    () => optimizeAttachment(file(Buffer.from('<svg></svg>'), 'image/svg+xml', 'bad.svg'), 'DOCUMENT'),
    (error) => error?.details?.code === 'ATTACHMENT_TYPE_INVALID'
  );
});

test('document images are optimized into the 300-450 KB target when practical and never exceed 500 KB', async () => {
  const source = await noisyJpeg();
  assert.ok(source.length > ATTACHMENT_PROFILES.DOCUMENT.imageTargetMaxBytes);
  assert.ok(source.length < ATTACHMENT_PROFILES.DOCUMENT.maxInputBytes);
  const result = await optimizeAttachment(file(source, 'image/jpeg', 'medical-note.jpg'), 'DOCUMENT');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.equal(result.file.size, result.file.buffer.length);
  assert.equal(result.file.size, result.sizeBytes);
  assert.ok(result.sizeBytes <= ATTACHMENT_PROFILES.DOCUMENT.imageTargetMaxBytes);
  assert.ok(result.sizeBytes <= ATTACHMENT_PROFILES.DOCUMENT.imageHardLimitBytes);
  assert.ok(result.sizeBytes < source.length);
  assert.ok(result.width <= result.sourceWidth);
  assert.ok(result.height <= result.sourceHeight);
  assert.match(result.checksum, /^[a-f0-9]{64}$/);
});

test('reference photos use the higher-quality profile while staying face-match sized and below 1 MB', async () => {
  const source = await noisyJpeg();
  const result = await optimizeAttachment(file(source, 'image/jpeg', 'employee-face.jpg'), 'EMPLOYEE_REFERENCE_PHOTO');
  assert.equal(result.mimeType, 'image/jpeg');
  assert.ok(result.sizeBytes <= ATTACHMENT_PROFILES.EMPLOYEE_REFERENCE_PHOTO.imageTargetMaxBytes);
  assert.ok(result.sizeBytes <= ATTACHMENT_PROFILES.EMPLOYEE_REFERENCE_PHOTO.imageHardLimitBytes);
  assert.ok(result.width >= 256 && result.height >= 256);
  assert.ok(result.width <= 4096 && result.height <= 4096);
  assert.ok(result.width <= result.sourceWidth && result.height <= result.sourceHeight);
});

test('optimizer never upscales a small already-acceptable reference photo', async () => {
  const source = await noisyJpeg(512, 512, 88);
  const result = await optimizeAttachment(file(source, 'image/jpeg', 'small-face.jpg'), 'EMPLOYEE_REFERENCE_PHOTO');
  assert.equal(result.optimized, false);
  assert.equal(result.width, 512);
  assert.equal(result.height, 512);
  assert.equal(result.file.buffer, source);
});

test('malformed image payloads fail closed even when the magic prefix resembles JPEG', async () => {
  const malformed = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02, 0x03]);
  await assert.rejects(
    () => optimizeAttachment(file(malformed, 'image/jpeg', 'broken.jpg'), 'DOCUMENT'),
    (error) => error?.details?.code === 'ATTACHMENT_IMAGE_INVALID'
  );
});

test('PDF and attendance hard limits are revalidated on the server', async () => {
  const pdfOverLimit = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(1024 * 1024), Buffer.from('\n%%EOF')]);
  await assert.rejects(
    () => optimizeAttachment(file(pdfOverLimit, 'application/pdf', 'oversize.pdf'), 'DOCUMENT'),
    (error) => error?.details?.code === 'PDF_HARD_LIMIT_EXCEEDED'
  );

  const attendanceOverLimit = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(1024 * 1024)]);
  await assert.rejects(
    () => validateAttachment(file(attendanceOverLimit, 'image/jpeg', 'frame.jpg'), 'ATTENDANCE_FACE'),
    (error) => ['ATTACHMENT_HARD_LIMIT_EXCEEDED', 'ATTACHMENT_INPUT_TOO_LARGE'].includes(error?.details?.code)
  );
});
