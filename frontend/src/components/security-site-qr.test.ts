import { beforeEach, describe, expect, it, vi } from 'vitest';

const qrEncoder = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock('qrcode', () => ({ default: qrEncoder }));

import {
  createSecuritySiteQrDataUrl,
  ensureSecuritySiteQrImageReady,
  nextSecuritySiteQrAnimationFrame,
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
});
