import { useEffect, useRef } from 'react';
import { acquireDocumentScrollLock } from '../document-scroll-lock';

type AccessibleOverlayOptions = {
  closeDisabled?: boolean;
  initialFocusSelector?: string;
  restoreFocus?: boolean;
};

const focusableSelector = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

export function useAccessibleOverlay<T extends HTMLElement>(
  active: boolean,
  onClose: () => void,
  options: AccessibleOverlayOptions = {}
) {
  const containerRef = useRef<T | null>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(Boolean(options.closeDisabled));
  const initialFocusSelectorRef = useRef(options.initialFocusSelector || '');
  const restoreFocusRef = useRef(options.restoreFocus !== false);

  onCloseRef.current = onClose;
  closeDisabledRef.current = Boolean(options.closeDisabled);
  initialFocusSelectorRef.current = options.initialFocusSelector || '';
  restoreFocusRef.current = options.restoreFocus !== false;

  useEffect(() => {
    if (!active) return undefined;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseScrollLock = acquireDocumentScrollLock();
    const focusTimer = window.setTimeout(() => {
      const container = containerRef.current;
      if (!container) return;
      const preferred = initialFocusSelectorRef.current
        ? container.querySelector<HTMLElement>(initialFocusSelectorRef.current)
        : null;
      const firstFocusable = container.querySelector<HTMLElement>(focusableSelector);
      (preferred || firstFocusable || container).focus({ preventScroll: true });
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container) return;

      if (event.key === 'Escape' && !closeDisabledRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      if (!focusable.length) {
        event.preventDefault();
        container.focus({ preventScroll: true });
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === container)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      releaseScrollLock();
      if (restoreFocusRef.current && previousFocus?.isConnected) {
        window.setTimeout(() => previousFocus.focus({ preventScroll: true }), 0);
      }
    };
  }, [active]);

  return containerRef;
}
