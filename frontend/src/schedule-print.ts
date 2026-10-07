const FRAME_CLEANUP_DELAY_MS = 60_000;

export type PrintOrientation = 'portrait' | 'landscape';

export type PrintDocumentOptions = {
  orientation: PrintOrientation;
  margin?: string;
};

export type PrintTableMetadata = {
  title: string;
  printedBy: string;
  filters?: Array<{ label: string; value: string }>;
};

function waitForPaint(targetWindow: Window): Promise<void> {
  return new Promise<void>((resolve) => {
    targetWindow.requestAnimationFrame(() => targetWindow.requestAnimationFrame(() => resolve()));
  });
}

async function waitForStylesheets(frameDocument: Document): Promise<void> {
  const stylesheets = Array.from(frameDocument.querySelectorAll('link[rel="stylesheet"]')) as HTMLLinkElement[];
  await Promise.all(stylesheets.map((stylesheet) => {
    if (stylesheet.sheet) return Promise.resolve();
    return new Promise<void>((resolve) => {
      stylesheet.addEventListener('load', () => resolve(), { once: true });
      stylesheet.addEventListener('error', () => resolve(), { once: true });
    });
  }));
}

function copyPrintStyles(sourceDocument: Document, frameDocument: Document): void {
  const base = frameDocument.createElement('base');
  base.href = sourceDocument.baseURI;
  frameDocument.head.append(base);

  sourceDocument.head.querySelectorAll('link[rel="stylesheet"], style').forEach((stylesheet) => {
    frameDocument.head.append(stylesheet.cloneNode(true));
  });
}

function preparePrintLayout(frameDocument: Document, orientation: PrintOrientation, margin: string): void {
  const isolationStyle = frameDocument.createElement('style');
  isolationStyle.dataset.printDocumentIsolation = 'true';
  isolationStyle.textContent = `
    @page { size: A4 ${orientation}; margin: ${margin}; }
    html, body { margin: 0 !important; min-height: 0 !important; height: auto !important; overflow: visible !important; background: #fff !important; color: #000 !important; }
    body { padding: 0 !important; }
    .print-only, .leave-print-document, .attendance-official-report-print { display: block !important; position: static !important; width: 100% !important; min-height: 0 !important; height: auto !important; max-height: none !important; overflow: visible !important; background: #fff !important; }
    .t29-table-print { box-sizing: border-box; width: 100%; color: #000; background: #fff; font-family: 'Noto Sans Thai', 'IBM Plex Sans Thai', sans-serif; font-size: 10pt; }
    .t29-table-print h1 { margin: 0 0 4mm; font-size: 18pt; }
    .t29-table-print__filters { display: flex; flex-wrap: wrap; gap: 2mm 6mm; margin: 0 0 3mm; font-size: 9pt; }
    .t29-table-print__meta { display: flex; justify-content: space-between; gap: 6mm; margin: 0 0 4mm; font-size: 9pt; }
    .t29-table-print table { width: 100% !important; min-width: 0 !important; border-collapse: collapse !important; table-layout: auto; }
    .t29-table-print thead { display: table-header-group !important; }
    .t29-table-print tfoot { display: table-footer-group !important; }
    .t29-table-print tr { break-inside: avoid !important; page-break-inside: avoid !important; }
    .t29-table-print th, .t29-table-print td { border: 1px solid #596273 !important; padding: 2mm !important; color: #000 !important; background: #fff !important; vertical-align: top; overflow-wrap: anywhere; }
    .t29-table-print button, .t29-table-print input, .t29-table-print select, .t29-table-print textarea { display: none !important; }
    .leave-print-document { box-sizing: border-box; margin: 0 !important; padding: 0 !important; color: #000 !important; background: #fff !important; font-family: 'Noto Sans Thai', 'IBM Plex Sans Thai', sans-serif !important; font-size: 13pt !important; line-height: 1.25 !important; break-before: auto !important; page-break-before: auto !important; }
    .leave-print-document, .leave-print-document * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .leave-print-document .leave-print-signatures, .leave-print-document .leave-print-signature-block { break-inside: avoid !important; page-break-inside: avoid !important; }
    .leave-print-document .leave-print-signatures { margin-top: 10mm !important; }
    .leave-print-document .leave-print-signature-block + .leave-print-signature-block { margin-top: 7mm !important; }
    .print-table { width: 100% !important; min-width: 0 !important; table-layout: fixed !important; }
    .print-table thead { display: table-header-group !important; }
    .print-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
    .print-table thead th:first-child, .print-table tbody td:first-child { width: 7mm !important; }
    .print-table thead th:nth-child(2), .print-table tbody td:nth-child(2) { width: 38mm !important; }
    .print-table thead th:nth-child(3), .print-table tbody td:nth-child(3) { width: 22mm !important; }
    .print-table thead th:nth-child(n+4):nth-child(-n+34), .print-table tbody td:nth-child(n+4):nth-child(-n+34) { width: 6mm !important; padding: 1px !important; font-size: 7pt !important; line-height: 1.05 !important; overflow-wrap: anywhere; }
    .print-table thead th:last-child, .print-table tbody td:last-child { width: 15mm !important; }
    .print-table th small { font-size: 7pt !important; line-height: 1.05 !important; }
    .print-department-group-row { break-inside: avoid !important; page-break-inside: avoid !important; break-after: avoid-page !important; page-break-after: avoid !important; }
    .print-department-group-row + tr { break-before: avoid-page !important; page-break-before: avoid !important; }
    .print-legend-table { font-size: 7.5pt !important; }
    .print-footer-container, .print-signatures, .signature-box { break-inside: avoid !important; page-break-inside: avoid !important; }
    .attendance-report-page { box-sizing: border-box !important; width: 100% !important; min-height: 0 !important; max-height: none !important; overflow: visible !important; break-after: page; page-break-after: always; }
    .attendance-report-page:last-child { break-after: auto; page-break-after: auto; }
    .attendance-report-table { width: 100% !important; }
    .attendance-report-table thead { display: table-header-group !important; }
    .attendance-report-table tr { break-inside: avoid !important; page-break-inside: avoid !important; }
    .executive-report-print, .executive-report-print-page { box-sizing: border-box; width: 100% !important; min-width: 0 !important; overflow: visible !important; }
    .executive-report-print-section, .executive-report-print-kpis { break-inside: avoid; page-break-inside: avoid; }
    .executive-report-print * { min-width: 0; overflow-wrap: anywhere; }
  `;
  frameDocument.head.append(isolationStyle);
}

function createPrintFrame(): { frame: HTMLIFrameElement; frameDocument: Document; frameWindow: Window } {
  const frame = document.createElement('iframe');
  frame.className = 'schedule-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.title = 'Isolated print document';
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0;pointer-events:none;';
  document.body.append(frame);

  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    throw new Error('Unable to create an isolated print document.');
  }

  frameDocument.open();
  frameDocument.write('<!doctype html><html><head><meta charset="utf-8"><title></title></head><body></body></html>');
  frameDocument.close();
  return { frame, frameDocument, frameWindow };
}

async function printNodeDocument(
  printRoot: HTMLElement,
  title: string,
  options: PrintDocumentOptions,
  testPrint?: (frameWindow: Window) => void
): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    await Promise.resolve();
    testPrint?.(undefined as unknown as Window);
    return;
  }

  const { frame, frameDocument, frameWindow } = createPrintFrame();
  frameDocument.title = title;
  copyPrintStyles(document, frameDocument);
  preparePrintLayout(frameDocument, options.orientation, options.margin || '10mm');
  frameDocument.body.append(printRoot.cloneNode(true));

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    frameWindow.removeEventListener('afterprint', cleanup);
    frame.remove();
  };

  frameWindow.addEventListener('afterprint', cleanup, { once: true });
  try {
    await waitForStylesheets(frameDocument);
    if (frameDocument.fonts?.ready) await frameDocument.fonts.ready.catch(() => undefined);
    await waitForPaint(frameWindow);
    void frameDocument.body.offsetHeight;
    if (testPrint) testPrint(frameWindow);
    else frameWindow.print();
    window.setTimeout(cleanup, FRAME_CLEANUP_DELAY_MS);
  } catch (error) {
    cleanup();
    throw error;
  }
}

export async function printDocument(
  selector: string,
  title: string,
  options: PrintDocumentOptions,
  testPrint?: (frameWindow: Window) => void
): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    await Promise.resolve();
    testPrint?.(undefined as unknown as Window);
    return;
  }
  const printRoot = document.querySelector<HTMLElement>(selector);
  if (!printRoot) throw new Error('Print content is unavailable.');
  await printNodeDocument(printRoot, title, options, testPrint);
}

export async function printScheduleDocument(testPrint?: (frameWindow: Window) => void): Promise<void> {
  return printDocument('.print-only', 'Schedule PDF', { orientation: 'landscape', margin: '8mm 10mm' }, testPrint);
}

function printDateTime(value: Date): string {
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Bangkok'
  }).format(value);
}

export async function printTableReport(
  selector: string,
  metadata: PrintTableMetadata,
  testPrint?: (frameWindow: Window) => void
): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const sourceTable = document.querySelector<HTMLTableElement>(selector);
  if (!sourceTable) throw new Error('Report table is unavailable.');

  const table = sourceTable.cloneNode(true) as HTMLTableElement;
  table.querySelectorAll('.data-action-column, .row-actions, button, input, select, textarea').forEach((item) => item.remove());
  table.querySelectorAll('[tabindex], [aria-label]').forEach((item) => {
    item.removeAttribute('tabindex');
    item.removeAttribute('aria-label');
  });

  const root = document.createElement('article');
  root.className = 't29-table-print';
  root.dataset.printReport = 'table';
  const heading = document.createElement('h1');
  heading.textContent = metadata.title;
  root.append(heading);

  if (metadata.filters?.length) {
    const filters = document.createElement('div');
    filters.className = 't29-table-print__filters';
    filters.setAttribute('aria-label', 'ตัวกรองที่ใช้');
    for (const filter of metadata.filters) {
      const item = document.createElement('span');
      item.textContent = `${filter.label}: ${filter.value}`;
      filters.append(item);
    }
    root.append(filters);
  }

  const reportMeta = document.createElement('div');
  reportMeta.className = 't29-table-print__meta';
  const printedAt = document.createElement('span');
  printedAt.textContent = `พิมพ์เมื่อ ${printDateTime(new Date())}`;
  const printedBy = document.createElement('span');
  printedBy.textContent = `ผู้พิมพ์ ${metadata.printedBy}`;
  reportMeta.append(printedAt, printedBy);
  root.append(reportMeta, table);

  const columnCount = Math.max(...Array.from(table.rows, (row) => row.cells.length), 0);
  await printNodeDocument(root, metadata.title, {
    orientation: columnCount > 7 ? 'landscape' : 'portrait',
    margin: '10mm'
  }, testPrint);
}
