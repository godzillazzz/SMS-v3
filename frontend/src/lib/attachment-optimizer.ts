const KB = 1024;
const MB = 1024 * KB;

export type AttachmentProfileName = 'DOCUMENT' | 'EMPLOYEE_REFERENCE_PHOTO' | 'ATTENDANCE_FACE';

type AttachmentPolicy = {
  name: AttachmentProfileName;
  allowedTypes: readonly ('pdf' | 'jpeg' | 'png')[];
  targetMinBytes: number;
  targetMaxBytes: number;
  hardLimitBytes: number;
  maxSourceBytes: number;
  maxEdge: number;
  jpegQualities: readonly number[];
};

export const ATTACHMENT_POLICIES: Readonly<Record<AttachmentProfileName, AttachmentPolicy>> = Object.freeze({
  DOCUMENT: Object.freeze({
    name: 'DOCUMENT' as const,
    allowedTypes: Object.freeze(['pdf', 'jpeg', 'png'] as const),
    targetMinBytes: 300 * KB,
    targetMaxBytes: 450 * KB,
    hardLimitBytes: 500 * KB,
    maxSourceBytes: 20 * MB,
    maxEdge: 2200,
    jpegQualities: Object.freeze([0.90, 0.86, 0.82, 0.78, 0.74, 0.70, 0.66, 0.62])
  }),
  EMPLOYEE_REFERENCE_PHOTO: Object.freeze({
    name: 'EMPLOYEE_REFERENCE_PHOTO' as const,
    allowedTypes: Object.freeze(['jpeg', 'png'] as const),
    targetMinBytes: 400 * KB,
    targetMaxBytes: 700 * KB,
    hardLimitBytes: 1 * MB,
    maxSourceBytes: 12 * MB,
    maxEdge: 1800,
    jpegQualities: Object.freeze([0.94, 0.92, 0.90, 0.88, 0.86, 0.84, 0.82, 0.80])
  }),
  ATTENDANCE_FACE: Object.freeze({
    name: 'ATTENDANCE_FACE' as const,
    allowedTypes: Object.freeze(['jpeg', 'png'] as const),
    targetMinBytes: 150 * KB,
    targetMaxBytes: 300 * KB,
    hardLimitBytes: 1 * MB,
    maxSourceBytes: 1 * MB,
    maxEdge: 960,
    jpegQualities: Object.freeze([0.90, 0.86, 0.82, 0.78, 0.74, 0.70])
  })
});

export const PDF_HARD_LIMIT_BYTES = 1 * MB;

type DetectedType = 'pdf' | 'jpeg' | 'png';

function errorMessage(profile: AttachmentProfileName, kind: 'type' | 'hard' | 'pdf') {
  if (kind === 'type') return profile === 'DOCUMENT'
    ? 'รองรับเฉพาะไฟล์ PDF, JPG หรือ PNG ที่ถูกต้องเท่านั้น'
    : 'รองรับเฉพาะไฟล์ JPG หรือ PNG ที่ถูกต้องเท่านั้น';
  if (kind === 'pdf') return 'ไฟล์ PDF ยังมีขนาดเกิน 1 MB หลังปรับโครงสร้างโดยไม่ลดคุณภาพ กรุณาลดขนาด PDF จากต้นทางหรือแบ่งเอกสารก่อนอัปโหลด';
  if (profile === 'DOCUMENT') return 'รูปเอกสารยังมีขนาดเกิน 500 KB หลังย่ออัตโนมัติ กรุณาเลือกภาพที่มีความละเอียดเหมาะสมกว่า';
  if (profile === 'EMPLOYEE_REFERENCE_PHOTO') return 'รูปอ้างอิงยังมีขนาดเกิน 1 MB หลังปรับคุณภาพอัตโนมัติ กรุณาเลือกภาพอื่นที่ชัดเจนและมีความละเอียดเหมาะสม';
  return 'ภาพยืนยันตัวตนยังมีขนาดเกิน 1 MB กรุณาถ่ายภาพใหม่';
}

export async function detectUploadType(blob: Blob): Promise<DetectedType | null> {
  const bytes = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
  if (bytes.length >= 5 && String.fromCharCode(...bytes.slice(0, 5)) === '%PDF-') return 'pdf';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return 'png';
  return null;
}

function replaceImageExtension(name: string) {
  const base = String(name || 'attachment').replace(/\.[^.]+$/, '') || 'attachment';
  return `${base}.jpg`;
}

async function canvasBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('ไม่สามารถย่อภาพได้')), 'image/jpeg', quality);
  });
}

export async function canvasToOptimizedJpeg(canvas: HTMLCanvasElement, profileName: AttachmentProfileName = 'ATTENDANCE_FACE'): Promise<Blob> {
  const policy = ATTACHMENT_POLICIES[profileName];
  let best: Blob | null = null;
  for (const quality of policy.jpegQualities) {
    const candidate = await canvasBlob(canvas, quality);
    if (!best || candidate.size < best.size) best = candidate;
    if (candidate.size <= policy.targetMaxBytes) return candidate;
  }
  if (!best || best.size > policy.hardLimitBytes) throw new Error(errorMessage(profileName, 'hard'));
  return best;
}

async function loadImage(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; cleanup: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    return { source: bitmap, width: bitmap.width, height: bitmap.height, cleanup: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('ไม่สามารถอ่านภาพที่เลือกได้'));
    image.src = url;
  });
  return { source: image, width: image.naturalWidth, height: image.naturalHeight, cleanup: () => URL.revokeObjectURL(url) };
}

async function optimizeImageFile(file: File, profileName: AttachmentProfileName): Promise<File> {
  const policy = ATTACHMENT_POLICIES[profileName];
  if (file.size <= policy.targetMaxBytes) return file;
  const decoded = await loadImage(file);
  try {
    if (!decoded.width || !decoded.height) throw new Error('ไม่สามารถอ่านขนาดภาพที่เลือกได้');
    const scale = Math.min(1, policy.maxEdge / Math.max(decoded.width, decoded.height));
    let width = Math.max(1, Math.round(decoded.width * scale));
    let height = Math.max(1, Math.round(decoded.height * scale));
    let best: Blob | null = null;

    for (let resizePass = 0; resizePass < 4; resizePass += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('เบราว์เซอร์ไม่สามารถเตรียมภาพสำหรับย่อไฟล์ได้');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, width, height);
      context.drawImage(decoded.source, 0, 0, width, height);
      for (const quality of policy.jpegQualities) {
        const candidate = await canvasBlob(canvas, quality);
        if (!best || candidate.size < best.size) best = candidate;
        if (candidate.size <= policy.targetMaxBytes) {
          return new File([candidate], replaceImageExtension(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
        }
      }
      width = Math.max(1, Math.round(width * 0.86));
      height = Math.max(1, Math.round(height * 0.86));
    }

    if (!best || best.size > policy.hardLimitBytes) throw new Error(errorMessage(profileName, 'hard'));
    return new File([best], replaceImageExtension(file.name), { type: 'image/jpeg', lastModified: file.lastModified });
  } finally {
    decoded.cleanup();
  }
}

async function pdfHasEof(file: File): Promise<boolean> {
  const tail = new Uint8Array(await file.slice(Math.max(0, file.size - 2048)).arrayBuffer());
  const marker = [0x25, 0x25, 0x45, 0x4f, 0x46];
  outer: for (let index = Math.max(0, tail.length - 1024); index <= tail.length - marker.length; index += 1) {
    for (let offset = 0; offset < marker.length; offset += 1) if (tail[index + offset] !== marker[offset]) continue outer;
    return true;
  }
  return false;
}

async function optimizePdf(file: File): Promise<File> {
  if (!(await pdfHasEof(file))) throw new Error('ไม่สามารถอ่าน PDF นี้ได้ กรุณาใช้ PDF ที่สมบูรณ์ ไม่เข้ารหัส และสามารถเปิดอ่านได้ตามปกติ');
  let document;
  try {
    const { PDFDocument } = await import('pdf-lib');
    document = await PDFDocument.load(await file.arrayBuffer(), { ignoreEncryption: false, updateMetadata: false });
  } catch {
    throw new Error('ไม่สามารถอ่าน PDF นี้ได้ กรุณาใช้ PDF ที่สมบูรณ์ ไม่เข้ารหัส และสามารถเปิดอ่านได้ตามปกติ');
  }
  if (file.size <= PDF_HARD_LIMIT_BYTES) return file;
  let rewritten: Uint8Array;
  try {
    rewritten = await document.save({ useObjectStreams: true, addDefaultPage: false, objectsPerTick: 50 });
  } catch {
    throw new Error('ไม่สามารถปรับโครงสร้าง PDF นี้โดยรักษาคุณภาพเดิมได้ กรุณาลดขนาด PDF จากต้นทาง');
  }
  if (rewritten.byteLength > PDF_HARD_LIMIT_BYTES) throw new Error(errorMessage('DOCUMENT', 'pdf'));
  const output = new ArrayBuffer(rewritten.byteLength);
  new Uint8Array(output).set(rewritten);
  return new File([output], file.name || 'document.pdf', { type: 'application/pdf', lastModified: file.lastModified });
}

export async function optimizeUploadFile(file: File, profileName: AttachmentProfileName): Promise<File> {
  const policy = ATTACHMENT_POLICIES[profileName];
  if (file.size > policy.maxSourceBytes) throw new Error(profileName === 'DOCUMENT' ? 'ไฟล์ต้นฉบับมีขนาดใหญ่เกิน 20 MB กรุณาลดขนาดจากต้นทางก่อนอัปโหลด' : profileName === 'EMPLOYEE_REFERENCE_PHOTO' ? 'รูปต้นฉบับมีขนาดใหญ่เกิน 12 MB กรุณาเลือกภาพอื่น' : 'ภาพยืนยันตัวตนมีขนาดใหญ่เกิน 1 MB');
  const type = await detectUploadType(file);
  if (!type || !policy.allowedTypes.includes(type)) throw new Error(errorMessage(profileName, 'type'));
  if (type === 'pdf') {
    if (profileName !== 'DOCUMENT') throw new Error(errorMessage(profileName, 'type'));
    return optimizePdf(file);
  }
  return optimizeImageFile(file, profileName);
}
