import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/primitives';

type Props = { displayName: string; role: string; initials: string; onAppearance(restoreTo: HTMLElement | null): void };
export function UserMenu({ displayName, role, initials, onAppearance }: Props) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapperRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return <div className="topbar-user-menu" ref={wrapperRef}>
    <Button ref={triggerRef} type="button" className="topbar-profile user-menu-trigger" title="บัญชีผู้ใช้งาน" aria-label={`บัญชีผู้ใช้งาน ${displayName}`} aria-expanded={open} aria-controls="topbar-user-menu-panel" onClick={() => setOpen((value) => !value)}>
      <span className="avatar">{initials}</span><span><b>{displayName}</b><small>{role}</small></span><i aria-hidden="true">⌄</i>
    </Button>
    {open && <div className="user-menu-popover" id="topbar-user-menu-panel" role="group" aria-label="เมนูบัญชีผู้ใช้งาน">
      <div className="user-menu-identity"><span className="avatar">{initials}</span><span><b>{displayName}</b><small>{role}</small></span></div>
      <Button type="button" className="user-menu-action" onClick={() => { setOpen(false); onAppearance(triggerRef.current); }}><span aria-hidden="true">◐</span> การแสดงผล</Button>
    </div>}
  </div>;
}
