type ScrollLockSnapshot = {
  bodyOverflow: string;
  documentOverflow: string;
};

let activeDocumentScrollLocks = 0;
let baselineScrollStyles: ScrollLockSnapshot | undefined;

export function acquireDocumentScrollLock(): () => void {
  if (typeof document === 'undefined' || !document.body || !document.documentElement) return () => undefined;

  if (activeDocumentScrollLocks === 0) {
    baselineScrollStyles = {
      bodyOverflow: document.body.style.overflow,
      documentOverflow: document.documentElement.style.overflow
    };
  }

  activeDocumentScrollLocks += 1;
  document.body.style.overflow = 'hidden';
  document.documentElement.style.overflow = 'hidden';

  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeDocumentScrollLocks = Math.max(0, activeDocumentScrollLocks - 1);
    if (activeDocumentScrollLocks !== 0) return;

    document.body.style.overflow = baselineScrollStyles?.bodyOverflow || '';
    document.documentElement.style.overflow = baselineScrollStyles?.documentOverflow || '';
    baselineScrollStyles = undefined;
  };
}

export function documentScrollLockCount(): number {
  return activeDocumentScrollLocks;
}
