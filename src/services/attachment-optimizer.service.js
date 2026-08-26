'use strict';

const crypto = require('node:crypto');
const sharp = require('sharp');
const HttpError = require('../utils/http-error');

const KB = 1024;
const MB = 1024 * KB;

const ATTACHMENT_PROFILES = Object.freeze({
  DOCUMENT: Object.freeze({
    name: 'DOCUMENT',
    allowedTypes: Object.freeze(['pdf', 'jpeg', 'png']),
    imageTargetMinBytes: 300 * KB,
    imageTargetMaxBytes: 450 * KB,
    imageHardLimitBytes: 500 * KB,
    pdfHardLimitBytes: 1 * MB,
    maxInputBytes: 4 * MB,
    maxEdge: 2200,
    minDimension: 64,
    maxDimension: 12000,
    jpegQualities: Object.freeze([90, 86, 82, 78, 74, 70, 66, 62]),
    resizeEdges: Object.freeze([2200, 2000, 1800, 1600, 1400, 1200])
  }),
  EMPLOYEE_REFERENCE_PHOTO: Object.freeze({
    name: 'EMPLOYEE_REFERENCE_PHOTO',
    allowedTypes: Object.freeze(['jpeg', 'png']),
    imageTargetMinBytes: 400 * KB,
    imageTargetMaxBytes: 700 * KB,
    imageHardLimitBytes: 1 * MB,
    maxInputBytes: 4 * MB,
    maxEdge: 1800,
    minDimension: 256,
    maxDimension: 4096,
    minAspectRatio: 0.5,
    maxAspectRatio: 2,
    jpegQualities: Object.freeze([94, 92, 90, 88, 86, 84, 82, 80]),
    resizeEdges: Object.freeze([1800, 1600, 1440, 1280, 1120])
  }),
  ATTENDANCE_FACE: Object.freeze({
    name: 'ATTENDANCE_FACE',
    allowedTypes: Object.freeze(['jpeg', 'png']),
    imageTargetMinBytes: 150 * KB,
    imageTargetMaxBytes: 300 * KB,
    imageHardLimitBytes: 1 * MB,
    maxInputBytes: 1 * MB,
    maxEdge: 1600,
    minDimension: 128,
    maxDimension: 4096,
    minAspectRatio: 0.4,
    maxAspectRatio: 2.5
  })
});

const MIME_BY_TYPE = Object.freeze({
  pdf: 'application/pdf',
  jpeg: 'image/jpeg',
  png: 'image/png'
});

function detectedType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString('ascii') === '%PDF-') return 'pdf';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpeg';
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  return null;
}

function attachmentError(statusCode, code, message) {
  return new HttpError(statusCode, message, { code });
}

function hasPdfEof(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 9) return false;
  const tail = buffer.subarray(Math.max(0, buffer.length - 2048));
  return tail.lastIndexOf(Buffer.from('%%EOF', 'ascii')) >= 0;
}

function profileFor(profileName) {
  const profile = ATTACHMENT_PROFILES[profileName];
  if (!profile) throw new Error(`Unknown attachment profile: ${profileName}`);
  return profile;
}

function assertBasicFile(file, profileName) {
  const profile = profileFor(profileName);
  if (!file || !Buffer.isBuffer(file.buffer) || !file.buffer.length) {
    throw attachmentError(400, 'ATTACHMENT_REQUIRED', 'กรุณาเลือกไฟล์ที่ต้องการอัปโหลด');
  }
  const actualSize = file.buffer.length;
  if (actualSize > profile.maxInputBytes) {
    throw attachmentError(400, 'ATTACHMENT_INPUT_TOO_LARGE', 'ไฟล์ต้นฉบับมีขนาดใหญ่เกินกว่าที่ระบบรับได้ กรุณาอัปโหลดผ่านหน้าเว็บเพื่อให้ระบบย่อไฟล์ก่อนส่ง');
  }
  const type = detectedType(file.buffer);
  if (!type || !profile.allowedTypes.includes(type)) {
    throw attachmentError(415, 'ATTACHMENT_TYPE_INVALID', profileName === 'EMPLOYEE_REFERENCE_PHOTO' || profileName === 'ATTENDANCE_FACE'
      ? 'รองรับเฉพาะไฟล์ JPEG หรือ PNG ที่ถูกต้องเท่านั้น'
      : 'รองรับเฉพาะไฟล์ PDF, JPEG หรือ PNG ที่ถูกต้องเท่านั้น');
  }
  const expectedMime = MIME_BY_TYPE[type];
  if (type === 'pdf' && !hasPdfEof(file.buffer)) {
    throw attachmentError(415, 'ATTACHMENT_PDF_INVALID', 'ไฟล์ PDF ไม่สมบูรณ์หรือไม่สามารถตรวจสอบโครงสร้างพื้นฐานได้');
  }
  if (file.mimetype && file.mimetype !== expectedMime) {
    throw attachmentError(415, 'ATTACHMENT_MIME_MISMATCH', 'ชนิดไฟล์ไม่ตรงกับข้อมูลจริงของไฟล์');
  }
  return { profile, type, mimeType: expectedMime, actualSize };
}

async function imageMetadata(buffer, profileName) {
  let metadata;
  try {
    metadata = await sharp(buffer, { failOn: 'error', limitInputPixels: 150_000_000 }).metadata();
  } catch {
    throw attachmentError(415, 'ATTACHMENT_IMAGE_INVALID', 'ไม่สามารถอ่านข้อมูลภาพได้ กรุณาเลือกภาพ JPEG หรือ PNG ที่สมบูรณ์');
  }
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) throw attachmentError(415, 'ATTACHMENT_IMAGE_INVALID', 'ไม่สามารถอ่านขนาดภาพได้');
  const profile = profileFor(profileName);
  const ratio = width / height;
  if (width < profile.minDimension || height < profile.minDimension || width > profile.maxDimension || height > profile.maxDimension) {
    const message = profileName === 'EMPLOYEE_REFERENCE_PHOTO'
      ? 'รูปอ้างอิงต้องมีขนาดอย่างน้อย 256x256 และไม่เกิน 4096x4096 พิกเซล'
      : 'ขนาดภาพอยู่นอกช่วงที่ระบบรองรับ';
    throw attachmentError(400, 'ATTACHMENT_DIMENSIONS_INVALID', message);
  }
  if (profile.minAspectRatio && (ratio < profile.minAspectRatio || ratio > profile.maxAspectRatio)) {
    throw attachmentError(400, 'ATTACHMENT_ASPECT_RATIO_INVALID', 'สัดส่วนภาพอยู่นอกช่วงที่ระบบรองรับ');
  }
  return { width, height, ratio };
}

function jpegFileName(name) {
  const base = String(name || 'attachment').replace(/\.[^.]+$/, '') || 'attachment';
  return `${base}.jpg`;
}

function withFileMetadata(file, buffer, mimetype) {
  return {
    ...file,
    buffer,
    size: buffer.length,
    mimetype,
    originalname: mimetype === 'image/jpeg' ? jpegFileName(file.originalname) : file.originalname
  };
}

async function renderJpeg(buffer, edge, quality) {
  return sharp(buffer, { failOn: 'error', limitInputPixels: 150_000_000 })
    .rotate()
    .flatten({ background: '#ffffff' })
    .resize({ width: edge, height: edge, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality, progressive: true, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

async function optimizeImage(file, profileName, inspected) {
  const profile = inspected.profile;
  const sourceMetadata = await imageMetadata(file.buffer, profileName);
  if (file.buffer.length <= profile.imageTargetMaxBytes && file.buffer.length <= profile.imageHardLimitBytes) {
    return {
      file: withFileMetadata(file, file.buffer, inspected.mimeType),
      profile: profileName,
      type: inspected.type,
      mimeType: inspected.mimeType,
      sizeBytes: file.buffer.length,
      originalSizeBytes: file.buffer.length,
      optimized: false,
      width: sourceMetadata.width,
      height: sourceMetadata.height,
      sourceWidth: sourceMetadata.width,
      sourceHeight: sourceMetadata.height,
      checksum: crypto.createHash('sha256').update(file.buffer).digest('hex')
    };
  }
  let best = null;
  for (const edge of profile.resizeEdges) {
    for (const quality of profile.jpegQualities) {
      let candidate;
      try { candidate = await renderJpeg(file.buffer, edge, quality); }
      catch { throw attachmentError(415, 'ATTACHMENT_IMAGE_INVALID', 'ไม่สามารถประมวลผลภาพนี้ได้'); }
      if (!best || candidate.length < best.length) best = candidate;
      if (candidate.length <= profile.imageTargetMaxBytes) {
        const resultFile = withFileMetadata(file, candidate, 'image/jpeg');
        const metadata = await imageMetadata(candidate, profileName);
        return {
          file: resultFile,
          profile: profileName,
          type: 'jpeg',
          mimeType: 'image/jpeg',
          sizeBytes: candidate.length,
          originalSizeBytes: file.buffer.length,
          optimized: true,
          width: metadata.width,
          height: metadata.height,
          sourceWidth: sourceMetadata.width,
          sourceHeight: sourceMetadata.height,
          checksum: crypto.createHash('sha256').update(candidate).digest('hex')
        };
      }
    }
  }
  if (!best || best.length > profile.imageHardLimitBytes) {
    throw attachmentError(400, 'ATTACHMENT_OPTIMIZATION_LIMIT', profileName === 'EMPLOYEE_REFERENCE_PHOTO'
      ? 'รูปอ้างอิงยังมีขนาดเกิน 1 MB หลังปรับคุณภาพอัตโนมัติ กรุณาเลือกภาพอื่นที่มีความละเอียดเหมาะสม'
      : 'รูปเอกสารยังมีขนาดเกิน 500 KB หลังปรับขนาดอัตโนมัติ กรุณาเลือกภาพที่มีความละเอียดเหมาะสมกว่า');
  }
  const resultFile = withFileMetadata(file, best, 'image/jpeg');
  const metadata = await imageMetadata(best, profileName);
  return {
    file: resultFile,
    profile: profileName,
    type: 'jpeg',
    mimeType: 'image/jpeg',
    sizeBytes: best.length,
    originalSizeBytes: file.buffer.length,
    optimized: true,
    width: metadata.width,
    height: metadata.height,
    sourceWidth: sourceMetadata.width,
    sourceHeight: sourceMetadata.height,
    checksum: crypto.createHash('sha256').update(best).digest('hex')
  };
}

async function optimizeAttachment(file, profileName) {
  const inspected = assertBasicFile(file, profileName);
  if (inspected.type === 'pdf') {
    if (inspected.actualSize > inspected.profile.pdfHardLimitBytes) {
      throw attachmentError(400, 'PDF_HARD_LIMIT_EXCEEDED', 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 1 MB หลังการปรับไฟล์อัตโนมัติ');
    }
    return {
      file: withFileMetadata(file, file.buffer, 'application/pdf'),
      profile: profileName,
      type: 'pdf',
      mimeType: 'application/pdf',
      sizeBytes: inspected.actualSize,
      originalSizeBytes: inspected.actualSize,
      optimized: false,
      width: null,
      height: null,
      checksum: crypto.createHash('sha256').update(file.buffer).digest('hex')
    };
  }
  return optimizeImage(file, profileName, inspected);
}

async function validateAttachment(file, profileName) {
  const inspected = assertBasicFile(file, profileName);
  if (inspected.type === 'pdf') {
    if (inspected.actualSize > inspected.profile.pdfHardLimitBytes) throw attachmentError(400, 'PDF_HARD_LIMIT_EXCEEDED', 'ไฟล์ PDF ต้องมีขนาดไม่เกิน 1 MB');
    return { type: 'pdf', mimeType: inspected.mimeType, sizeBytes: inspected.actualSize, width: null, height: null, checksum: crypto.createHash('sha256').update(file.buffer).digest('hex') };
  }
  if (inspected.actualSize > inspected.profile.imageHardLimitBytes) {
    throw attachmentError(400, 'ATTACHMENT_HARD_LIMIT_EXCEEDED', profileName === 'ATTENDANCE_FACE' || profileName === 'EMPLOYEE_REFERENCE_PHOTO'
      ? 'ไฟล์ภาพต้องมีขนาดไม่เกิน 1 MB'
      : 'รูปเอกสารต้องมีขนาดไม่เกิน 500 KB');
  }
  const metadata = await imageMetadata(file.buffer, profileName);
  return {
    type: inspected.type,
    mimeType: inspected.mimeType,
    sizeBytes: inspected.actualSize,
    width: metadata.width,
    height: metadata.height,
    checksum: crypto.createHash('sha256').update(file.buffer).digest('hex')
  };
}

module.exports = {
  KB,
  MB,
  MIME_BY_TYPE,
  ATTACHMENT_PROFILES,
  detectedType,
  hasPdfEof,
  profileFor,
  imageMetadata,
  optimizeAttachment,
  validateAttachment
};
