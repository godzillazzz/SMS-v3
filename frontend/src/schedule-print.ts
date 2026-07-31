const PRINT_ROOT_SELECTOR = '.print-only';
const FRAME_CLEANUP_DELAY_MS = 60_000;

function waitForPaint(targetWindow: Window = window): Promise<void> {
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

function preparePrintLayout(frameDocument: Document): void {
  const isolationStyle = frameDocument.createElement('style');
  isolationStyle.textContent = `
    html, body { margin: 0 !important; min-height: 0 !important; height: auto !important; overflow: visible !important; background: #fff !important; }
    .print-only { display: block !important; position: static !important; width: 100% !important; min-height: 0 !important; height: auto !important; overflow: visible !important; }
  `;
  frameDocument.head.append(isolationStyle);
}

export async function printScheduleDocument(testPrint?: () => void): Promise<void> {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    await Promise.resolve();
    testPrint?.();
    return;
  }

  const printRoot = document.querySelector<HTMLElement>(PRINT_ROOT_SELECTOR);
  if (!printRoot) throw new Error('Schedule print content is unavailable.');

  const frame = document.createElement('iframe');
  frame.className = 'schedule-print-frame';
  frame.setAttribute('aria-hidden', 'true');
  frame.setAttribute('tabindex', '-1');
  frame.style.cssText = 'position:fixed;left:-10000px;top:0;width:1123px;height:794px;border:0;pointer-events:none;';
  document.body.append(frame);

  const frameDocument = frame.contentDocument;
  const frameWindow = frame.contentWindow;
  if (!frameDocument || !frameWindow) {
    frame.remove();
    throw new Error('Unable to create the schedule print document.');
  }

  frameDocument.open();
  frameDocument.write('<!doctype html><html><head><title>Schedule PDF</title></head><body></body></html>');
  frameDocument.close();
  copyPrintStyles(document, frameDocument);
  preparePrintLayout(frameDocument);
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
    (testPrint ?? (() => frameWindow.print()))();
    window.setTimeout(cleanup, FRAME_CLEANUP_DELAY_MS);
  } catch (error) {
    cleanup();
    throw error;
  }
}
