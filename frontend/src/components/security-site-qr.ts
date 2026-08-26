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

export async function ensureSecuritySiteQrImageReady(image: HTMLImageElement): Promise<void> {
  if (!image.src) throw new Error('ไม่พบ QR image สำหรับการพิมพ์');

  if (!image.complete) {
    await new Promise<void>((resolve, reject) => {
      const handleLoad = () => {
        cleanup();
        resolve();
      };
      const handleError = () => {
        cleanup();
        reject(new Error('QR image โหลดไม่สำเร็จ'));
      };
      const cleanup = () => {
        image.removeEventListener('load', handleLoad);
        image.removeEventListener('error', handleError);
      };

      image.addEventListener('load', handleLoad, { once: true });
      image.addEventListener('error', handleError, { once: true });
      if (image.complete) {
        cleanup();
        resolve();
      }
    });
  }

  if (image.naturalWidth === 0) throw new Error('QR image โหลดไม่สำเร็จ');
  if (typeof image.decode === 'function') await image.decode();
}

export function nextSecuritySiteQrAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

export function securitySiteQrFilename(siteCode: string, version: number): string {
  const safeSiteCode = siteCode.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'SITE';
  return `SMSV3-Attendance-QR-${safeSiteCode}-v${version}.png`;
}
