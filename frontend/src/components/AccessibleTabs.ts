import type { KeyboardEvent } from 'react';

const horizontalTabKeys = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function activateTabFromKeyboard(event: KeyboardEvent<HTMLElement>) {
  if (!horizontalTabKeys.has(event.key)) return;
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([disabled])'));
  if (!tabs.length) return;
  const activeIndex = Math.max(0, tabs.findIndex((tab) => tab === document.activeElement));
  const targetIndex = event.key === 'Home'
    ? 0
    : event.key === 'End'
      ? tabs.length - 1
      : event.key === 'ArrowRight'
        ? (activeIndex + 1) % tabs.length
        : (activeIndex - 1 + tabs.length) % tabs.length;
  event.preventDefault();
  tabs[targetIndex]?.focus({ preventScroll: true });
  tabs[targetIndex]?.click();
}
