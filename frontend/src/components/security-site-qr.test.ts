import { beforeEach, describe, expect, it, vi } from 'vitest';

const qrEncoder = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock('qrcode', () => ({ default: qrEncoder }));

import {
  createSecuritySiteQrDataUrl,
  createSecuritySiteQrPrintHtml,
  ensureSecuritySiteQrImageReady,
  nextSecuritySiteQrAnimationFrame,
  printSecuritySiteQrDocument,
  securitySiteQrFilename
} from './security-site-qr';

describe('Security Site QR rendering', () => {
  beforeEach(() => {
    qrEncoder.toDataURL.mockReset();
    qrEncoder.toDataURL.mockResolvedValue('data:image/png;base64,local-qr');
  });

  it('encodes the exact raw token locally with print-safe QR options', async () => {
    const dataUrl = await createSecuritySiteQrDataUrl('raw-token-exact');

    expect(dataUrl).toBe('data:image/png;base64,local-qr');
    expect(qrEncoder.toDataURL).toHaveBeenCalledWith('raw-token-exact', expect.objectContaining({
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 768,
      color: { dark: '#000000', light: '#ffffff' }
    }));
  });

  it('rejects an empty token without invoking the encoder', async () => {
    await expect(createSecuritySiteQrDataUrl('')).rejects.toThrow('ไม่พบ QR token');
    expect(qrEncoder.toDataURL).not.toHaveBeenCalled();
  });

  it('creates a site/version filename without the raw token', () => {
    const filename = securitySiteQrFilename('SITE/01', 7);

    expect(filename).toBe('SMSV3-Attendance-QR-SITE-01-v7.png');
    expect(filename).not.toContain('raw-token');
  });

  it('waits for a loaded image and decodes it before print', async () => {
    const image = {
      src: 'data:image/png;base64,local-qr',
      complete: true,
      naturalWidth: 768,
      decode: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as HTMLImageElement;

    await ensureSecuritySiteQrImageReady(image);

    expect(image.decode).toHaveBeenCalledOnce();
  });

  it('rejects a failed image decode without invoking browser print', async () => {
    const image = {
      src: 'data:image/png;base64,broken',
      complete: true,
      naturalWidth: 768,
      decode: vi.fn().mockRejectedValue(new Error('decode failed')),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as HTMLImageElement;
    const print = vi.fn();

    await expect(ensureSecuritySiteQrImageReady(image)).rejects.toThrow('decode failed');
    expect(print).not.toHaveBeenCalled();
  });

  it('provides a paint-frame wait for print layout', async () => {
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('window', { requestAnimationFrame });

    await nextSecuritySiteQrAnimationFrame();

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    vi.unstubAllGlobals();
  });

  it('builds a standalone A4 print document and escapes site metadata', () => {
    const html = createSecuritySiteQrPrintHtml({
      dataUrl: 'data:image/png;base64,local-qr',
      siteCode: 'SITE<01',
      siteName: 'Main & Gate',
      version: 4,
      generatedLabel: '26 ส.ค. 2569 14:10',
      validFromLabel: '26 ส.ค. 2569 14:10'
    });

    expect(html).toContain('@page { size: A4 portrait; margin: 12mm; }');
    expect(html).toContain('id="security-site-qr-print-image"');
    expect(html).toContain('width: 140mm; height: 140mm;');
    expect(html).toContain('SITE&lt;01 · Main &amp; Gate');
    expect(html).not.toContain('body * { visibility: hidden');
  });

  it('preloads the QR inside the standalone document before printing', async () => {
    const image = {
      src: 'data:image/png;base64,local-qr',
      complete: true,
      naturalWidth: 768,
      decode: vi.fn().mockResolvedValue(undefined),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    } as unknown as HTMLImageElement;
    const write = vi.fn();
    const print = vi.fn();
    const focus = vi.fn();
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    const fakeWindow = {
      document: {
        readyState: 'complete',
        fonts: { ready: Promise.resolve() },
        open: vi.fn(),
        write,
        close: vi.fn(),
        getElementById: vi.fn(() => image)
      },
      requestAnimationFrame,
      setTimeout: vi.fn((callback: () => void) => { callback(); return 1; }),
      focus,
      print,
      close: vi.fn(),
      addEventListener: vi.fn()
    } as unknown as Window;

    await printSecuritySiteQrDocument({
      dataUrl: 'data:image/png;base64,local-qr',
      siteCode: 'PS-01',
      siteName: 'Primary Site',
      version: 2,
      generatedLabel: 'generated',
      validFromLabel: 'valid'
    }, () => fakeWindow);

    expect(write).toHaveBeenCalledOnce();
    expect(image.decode).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(2);
    expect(focus).toHaveBeenCalledOnce();
    expect(print).toHaveBeenCalledOnce();
  });

  it('fails safely when Safari blocks the print window', async () => {
    await expect(printSecuritySiteQrDocument({
      dataUrl: 'data:image/png;base64,local-qr',
      siteCode: 'PS-01',
      siteName: 'Primary Site',
      version: 2,
      generatedLabel: 'generated',
      validFromLabel: 'valid'
    }, () => null)).rejects.toThrow('บล็อกหน้าต่างพิมพ์');
  });
});
