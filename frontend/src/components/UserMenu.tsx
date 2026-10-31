import React, { useEffect, useRef, useState } from 'react';
import { SmsIcon } from './SmsIcon';
import { ThemeControl } from './ThemeControl';

const AccentControl = React.lazy(() => import('./AccentControl').then((module) => ({ default: module.AccentControl })));

type UserMenuProps = {
  initials: string;
  displayName: string;
  roleLabel: string;
  avatarTone?: number;
  showAccent?: boolean;
  desktopView: boolean;
  onToggleDesktopView(): void;
  onOpenSecurity(): void;
  onLogout(): void;
};

// Desktop topbar user menu (owner decision 2026-10-27): theme, accent, display mode, passkey and logout live here.
// The panel stays mounted (hidden) so AccentControl applies the saved accent on first load.
export function UserMenu({ initials, displayName, roleLabel, avatarTone, showAccent = true, desktopView, onToggleDesktopView, onOpenSecurity, onLogout }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener('mousedown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); window.removeEventListener('keydown', onKey); };
  }, [open]);

  const run = (action: () => void) => () => { setOpen(false); action(); };

  return <div className="user-menu" ref={rootRef}>
    <button ref={triggerRef} type="button" className="topbar-profile topbar-profile-button" aria-haspopup="menu" aria-expanded={open} aria-controls="topbar-user-menu" title="บัญชีและการตั้งค่าหน้าจอ" onClick={() => setOpen((value) => !value)}>
      <span className="avatar" data-avatar-tone={avatarTone}>{initials}</span>
      <span><b>{displayName}</b><small>{roleLabel}</small></span>
      <svg className="user-menu__chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <div id="topbar-user-menu" className="user-menu__panel" role="menu" aria-label="บัญชีและการตั้งค่าหน้าจอ" hidden={!open}>
      <div className="user-menu__profile"><span className="avatar" data-avatar-tone={avatarTone}>{initials}</span><span><b>{displayName}</b><small>{roleLabel}</small></span></div>
      <div className="user-menu__row"><span>โหมดสี</span><ThemeControl compact /></div>
      {showAccent && <div className="user-menu__row"><span>สีแถบข้าง</span><React.Suspense fallback={null}><AccentControl /></React.Suspense></div>}
      <button type="button" role="menuitem" className="user-menu__item" onClick={run(onToggleDesktopView)}><SmsIcon name={desktopView ? 'device' : 'system'} size={16} />{desktopView ? 'กลับมุมมองมือถือ' : 'แสดงแบบเดสก์ท็อป'}</button>
      <button type="button" role="menuitem" className="user-menu__item" onClick={run(onOpenSecurity)}><SmsIcon name="key" size={16} />การเข้าสู่ระบบและ Passkey</button>
      <button type="button" role="menuitem" className="user-menu__item user-menu__item--danger" onClick={run(onLogout)}><SmsIcon name="logout" size={16} />ออกจากระบบ</button>
    </div>
  </div>;
}
