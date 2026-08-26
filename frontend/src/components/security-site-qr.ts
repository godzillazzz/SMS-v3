import QRCode from 'qrcode';

export const SECURITY_SITE_QR_PIXEL_SIZE = 768;

export type SecuritySiteQrPrintInput = {
  dataUrl: string;
  siteCode: string;
  siteName: string;
  version: number;
  generatedLabel: string;
  validFromLabel: string;
};

type PrintWindowFactory = () => Window | null;

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

export function nextSecuritySiteQrAnimationFrame(targetWindow: Pick<Window, 'requestAnimationFrame'> | undefined = typeof window !== 'undefined' ? window : undefined): Promise<void> {
  return new Promise((resolve) => {
    if (targetWindow && typeof targetWindow.requestAnimationFrame === 'function') {
      targetWindow.requestAnimationFrame(() => resolve());
      return;
    }
    setTimeout(resolve, 0);
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function createSecuritySiteQrPrintHtml(input: SecuritySiteQrPrintInput): string {
  if (!input.dataUrl.startsWith('data:image/')) throw new Error('QR image สำหรับพิมพ์ไม่ถูกต้อง');
  const site = `${input.siteCode} · ${input.siteName}`;
  return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
<title>${escapeHtml(`Attendance Site QR - ${input.siteCode}`)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; }
  * { box-sizing: border-box; }
  .qr-print-page { width: 100%; min-height: 273mm; display: flex; flex-direction: column; align-items: center; text-align: center; break-inside: avoid; page-break-inside: avoid; }
  .qr-print-kicker { margin: 0; font-size: 11pt; font-weight: 700; letter-spacing: .08em; }
  h1 { margin: 5mm 0 0; font-size: 22pt; line-height: 1.15; }
  .qr-print-meta { margin-top: 4mm; display: grid; gap: 2mm; font-size: 11pt; line-height: 1.35; }
  .qr-print-image { display: block; width: 140mm; height: 140mm; max-width: 100%; margin: 10mm auto 0; object-fit: contain; background: #fff; image-rendering: pixelated; break-inside: avoid; page-break-inside: avoid; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  footer { width: 100%; margin-top: auto; padding-top: 8mm; font-size: 9pt; display: flex; justify-content: space-between; gap: 8mm; }
  @media screen { body { padding: 12mm; } .qr-print-page { min-height: calc(100vh - 24mm); } }
</style>
</head>
<body>
<main class="qr-print-page">
  <p class="qr-print-kicker">SECURITY MANAGEMENT SYSTEM V3</p>
  <h1>ATTENDANCE SITE QR</h1>
  <div class="qr-print-meta">
    <div>Site: ${escapeHtml(site)}</div>
    <div>QR Version: ${escapeHtml(String(input.version))}</div>
    <div>Generated: ${escapeHtml(input.generatedLabel)}</div>
    <div>Valid from: ${escapeHtml(input.validFromLabel)}</div>
  </div>
  <img id="security-site-qr-print-image" class="qr-print-image" src="${escapeHtml(input.dataUrl)}" width="768" height="768" alt="Attendance Site QR" />
  <footer><span>Security Management System V3</span><span>${escapeHtml(input.siteCode)} · QR v${escapeHtml(String(input.version))}</span></footer>
</main>
</body>
</html>`;
}

async function waitForStandalonePrintDocument(printWindow: Window, image: HTMLImageElement): Promise<void> {
  if (printWindow.document.readyState === 'loading') {
    await new Promise<void>((resolve) => printWindow.addEventListener('load', () => resolve(), { once: true }));
  }
  await ensureSecuritySiteQrImageReady(image);
  if (printWindow.document.fonts?.ready) await printWindow.document.fonts.ready;
  await nextSecuritySiteQrAnimationFrame(printWindow);
  await nextSecuritySiteQrAnimationFrame(printWindow);
  await new Promise<void>((resolve) => printWindow.setTimeout(() => resolve(), 250));
}

export async function printSecuritySiteQrDocument(
  input: SecuritySiteQrPrintInput,
  openWindow: PrintWindowFactory = () => window.open('', '_blank')
): Promise<void> {
  const printWindow = openWindow();
  if (!printWindow) throw new Error('เบราว์เซอร์บล็อกหน้าต่างพิมพ์ กรุณาอนุญาต Pop-up แล้วลองใหม่');

  try {
    printWindow.document.open();
    printWindow.document.write(createSecuritySiteQrPrintHtml(input));
    printWindow.document.close();

    const image = printWindow.document.getElementById('security-site-qr-print-image') as HTMLImageElement | null;
    if (!image) throw new Error('ไม่พบ QR image ในเอกสารพิมพ์');

    await waitForStandalonePrintDocument(printWindow, image);
    printWindow.addEventListener('afterprint', () => {
      printWindow.setTimeout(() => {
        try { printWindow.close(); } catch { /* no-op */ }
      }, 0);
    }, { once: true });
    printWindow.focus();
    printWindow.print();
  } catch (reason) {
    try { printWindow.close(); } catch { /* no-op */ }
    throw reason;
  }
}

export function securitySiteQrFilename(siteCode: string, version: number): string {
  const safeSiteCode = siteCode.trim().replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'SITE';
  return `SMSV3-Attendance-QR-${safeSiteCode}-v${version}.png`;
}
