import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SmsIcon } from './SmsIcon';

export type DataRowAction = {
  label: string;
  onSelect(): void;
  tone?: 'default' | 'danger';
  disabled?: boolean;
};

type Props = {
  label: string;
  actions: DataRowAction[];
};

const MENU_WIDTH = 196;
const VIEWPORT_GAP = 8;

export function DataRowActionMenu({ label, actions }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: VIEWPORT_GAP, top: VIEWPORT_GAP });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = (restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => triggerRef.current?.focus(), 0);
  };

  const openMenu = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const left = Math.min(window.innerWidth - MENU_WIDTH - VIEWPORT_GAP, Math.max(VIEWPORT_GAP, rect.right - MENU_WIDTH));
    setPosition({ left, top: rect.bottom + 6 });
    setOpen(true);
  };

  useLayoutEffect(() => {
    if (!open || !menuRef.current || !triggerRef.current) return;
    const menuRect = menuRef.current.getBoundingClientRect();
    const triggerRect = triggerRef.current.getBoundingClientRect();
    if (menuRect.bottom <= window.innerHeight - VIEWPORT_GAP) return;
    setPosition((current) => ({ ...current, top: Math.max(VIEWPORT_GAP, triggerRect.top - menuRect.height - 6) }));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(true);
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (menuRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      close(false);
    };
    const onViewportChange = () => close(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  if (!actions.length) return null;

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
    const activeIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = activeIndex < 0 ? 0 : (activeIndex + delta + items.length) % items.length;
      items[next]?.focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      items[0]?.focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      items[items.length - 1]?.focus();
    }
  };

  return <span className="data-row-action-menu">
    <button
      ref={triggerRef}
      type="button"
      className="data-row-more-trigger"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => open ? close(false) : openMenu()}
    ><SmsIcon name="more" size={18} /></button>
    {open && createPortal(<div
      ref={menuRef}
      className="data-row-menu-popover"
      role="menu"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
      onKeyDown={onMenuKeyDown}
    >{actions.map((action) => <button
      key={action.label}
      type="button"
      role="menuitem"
      className={action.tone === 'danger' ? 'is-danger' : ''}
      disabled={action.disabled}
      onClick={() => {
        action.onSelect();
        close(false);
      }}
    >{action.label}</button>)}</div>, document.body)}
  </span>;
}
