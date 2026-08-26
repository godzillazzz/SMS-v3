import { beforeEach, describe, expect, it, vi } from 'vitest';

const qrEncoder = vi.hoisted(() => ({ toDataURL: vi.fn() }));

vi.mock('qrcode', () => ({ default: qrEncoder }));

import { createSecuritySiteQrDataUrl, securitySiteQrFilename } from './security-site-qr';

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
});
