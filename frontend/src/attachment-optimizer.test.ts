import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  ATTACHMENT_POLICIES,
  PDF_HARD_LIMIT_BYTES,
  canvasToOptimizedJpeg,
  detectUploadType,
  optimizeUploadFile
} from './lib/attachment-optimizer';

afterEach(() => vi.unstubAllGlobals());

function jpegLikeFile(size: number, name = 'scan.jpg') {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff], 0);
  return new File([bytes], name, { type: 'image/jpeg', lastModified: 123 });
}

function stubImageCanvas(initialWidth: number, initialHeight: number, sizeFor: (width: number, quality: number) => number) {
  const canvases: Array<{ width: number; height: number }> = [];
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: initialWidth, height: initialHeight, close: vi.fn() }));
  vi.stubGlobal('document', {
    createElement: vi.fn(() => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: vi.fn(() => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() })),
        toBlob: (callback: (blob: Blob | null) => void, _type?: string, quality?: number) => {
          const bytes = new Uint8Array(sizeFor(canvas.width, Number(quality || 0)));
          bytes.set([0xff, 0xd8, 0xff], 0);
          callback(new Blob([bytes], { type: 'image/jpeg' }));
        }
      };
      canvases.push(canvas);
      return canvas;
    })
  });
  return canvases;
}

describe('Attachment Optimizer V1 client policy', () => {
  it('locks Owner-approved targets and hard limits in one shared profile registry', () => {
    expect(ATTACHMENT_POLICIES.DOCUMENT).toMatchObject({ targetMinBytes: 300 * 1024, targetMaxBytes: 450 * 1024, hardLimitBytes: 500 * 1024 });
    expect(PDF_HARD_LIMIT_BYTES).toBe(1024 * 1024);
    expect(ATTACHMENT_POLICIES.EMPLOYEE_REFERENCE_PHOTO).toMatchObject({ targetMinBytes: 400 * 1024, targetMaxBytes: 700 * 1024, hardLimitBytes: 1024 * 1024 });
    expect(ATTACHMENT_POLICIES.ATTENDANCE_FACE).toMatchObject({ targetMinBytes: 150 * 1024, targetMaxBytes: 300 * 1024, hardLimitBytes: 1024 * 1024 });
  });

  it('detects PDF/JPEG/PNG from bytes instead of trusting the filename', async () => {
    expect(await detectUploadType(new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0x00])]))).toBe('jpeg');
    expect(await detectUploadType(new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])]))).toBe('png');
    expect(await detectUploadType(new Blob(['%PDF-1.7\n']))).toBe('pdf');
    expect(await detectUploadType(new Blob(['<svg/>']))).toBeNull();
  });

  it('continues resizing document images until it reaches the 300-450 KB target instead of stopping merely below 500 KB', async () => {
    const canvases = stubImageCanvas(2000, 1400, (width) => width >= 1900 ? 480 * 1024 : 420 * 1024);
    const result = await optimizeUploadFile(jpegLikeFile(900 * 1024, 'medical-note.png'), 'DOCUMENT');
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('medical-note.jpg');
    expect(result.size).toBeLessThanOrEqual(ATTACHMENT_POLICIES.DOCUMENT.targetMaxBytes);
    expect(canvases.length).toBeGreaterThanOrEqual(2);
  });

  it('uses the higher-quality Reference Photo target and does not upscale source dimensions', async () => {
    const canvases = stubImageCanvas(1600, 1200, (width) => width >= 1500 ? 750 * 1024 : 650 * 1024);
    const result = await optimizeUploadFile(jpegLikeFile(950 * 1024, 'reference.png'), 'EMPLOYEE_REFERENCE_PHOTO');
    expect(result.size).toBeLessThanOrEqual(ATTACHMENT_POLICIES.EMPLOYEE_REFERENCE_PHOTO.targetMaxBytes);
    expect(Math.max(...canvases.map((canvas) => canvas.width))).toBeLessThanOrEqual(1600);
  });

  it('targets 150-300 KB for transient Attendance face frames', async () => {
    const canvas = {
      width: 960,
      height: 720,
      toBlob: (callback: (blob: Blob | null) => void, _type?: string, quality?: number) => {
        const size = Number(quality) >= 0.9 ? 340 * 1024 : 290 * 1024;
        callback(new Blob([new Uint8Array(size)], { type: 'image/jpeg' }));
      }
    } as unknown as HTMLCanvasElement;
    const result = await canvasToOptimizedJpeg(canvas, 'ATTENDANCE_FACE');
    expect(result.size).toBeLessThanOrEqual(ATTACHMENT_POLICIES.ATTENDANCE_FACE.targetMaxBytes);
    expect(result.size).toBeLessThanOrEqual(ATTACHMENT_POLICIES.ATTENDANCE_FACE.hardLimitBytes);
  });

  it('parses even sub-1 MB PDFs so malformed/encrypted input fails closed while valid small PDFs remain byte-identical', async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage([595, 842]);
    const bytes = await pdf.save({ useObjectStreams: true });
    const source = new File([new Uint8Array(bytes)], 'valid.pdf', { type: 'application/pdf', lastModified: 456 });
    const result = await optimizeUploadFile(source, 'DOCUMENT');
    expect(result).toBe(source);
    expect(result.size).toBeLessThanOrEqual(PDF_HARD_LIMIT_BYTES);

    const malformed = new File(['%PDF-1.7\nthis-is-not-a-valid-pdf'], 'broken.pdf', { type: 'application/pdf' });
    await expect(optimizeUploadFile(malformed, 'DOCUMENT')).rejects.toThrow(/ไม่สามารถอ่าน PDF/);
  });

  it('keeps all persistent upload callers behind the central API optimization boundary', () => {
    const apiSource = fs.readFileSync(path.join(__dirname, 'api.ts'), 'utf8');
    expect(apiSource).toContain("optimizeUploadFile(photo, 'EMPLOYEE_REFERENCE_PHOTO')");
    expect(apiSource).toContain("optimizeUploadFile(document, 'DOCUMENT')");
    expect(apiSource).toContain("optimizeUploadFile(attachment, 'DOCUMENT')");
    expect(apiSource.match(/optimizeUploadFile\(document, 'DOCUMENT'\)/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
