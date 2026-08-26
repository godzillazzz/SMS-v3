import QRCode from 'qrcode';

export const SECURITY_SITE_QR_PIXEL_SIZE = 768;

export async function createSecuritySiteQrDataUrl(rawToken: string, size = SECURITY_SITE_QR_PIXEL_SIZE): Promise<string> {
  if (!rawToken) throw new Error('ไม่พบ QR token สำหรับสร้าง QR Code');
  if (!Number.isInteger(size) || size < 256) throw new Error('ขนาด QR Code ไม่ถูกต้อง');
  return QRCode.toDataURL(rawToken, {
    errorCorrectionLevel: 'M',
    margin: 4,
    width: size,
    color: { dark: '#000000', light: '#ffffff' }
  });
}

export function securitySiteQrFilename(siteCode: string, version: number): string {
  const safeSiteCode = siteCode.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'SITE';
  return `SMSV3-Attendance-QR-${safeSiteCode}-v${version}.png`;
}
