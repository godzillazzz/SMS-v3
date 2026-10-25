import { useEffect, useRef, useState, type RefObject } from 'react';
import { Button, DialogSurface, TextInput } from '../ui/primitives';

export type PaletteCommand = {
  id: string;
  label: string;
  group: string;
  icon: string;
  keywords?: string;
  current?: boolean;
  action(): void;
};

type Props = {
  commands: PaletteCommand[];
  onClose(): void;
  restoreFocusRef: RefObject<HTMLElement | null>;
};

export function CommandPalette({ commands, onClose, restoreFocusRef }: Props) {
  const [query, setQuery] = useState('');
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const term = query.trim().toLocaleLowerCase();
  const filteredCommands = term
    ? commands.filter((command) => `${command.label} ${command.group} ${command.keywords || ''}`.toLocaleLowerCase().includes(term))
    : commands;

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    inputRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab' || !panelRef.current) return;
      const nodes = Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'));
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousBodyOverflow;
      document.documentElement.style.overflow = previousDocumentOverflow;
      const restoreTarget = restoreFocusRef.current;
      if (restoreTarget?.isConnected) restoreTarget.focus();
    };
  }, [onClose, restoreFocusRef]);

  const moveResultFocus = (current: HTMLButtonElement, offset: number) => {
    const buttons = Array.from(panelRef.current?.querySelectorAll<HTMLButtonElement>('.command-palette__result') || []);
    if (!buttons.length) return;
    const index = buttons.indexOf(current);
    buttons[(index + offset + buttons.length) % buttons.length]?.focus();
  };

  return <div className="shell-overlay-backdrop command-palette-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <DialogSurface ref={panelRef} className="command-palette" labelledBy="command-palette-title" aria-describedby="command-palette-help">
      <header className="command-palette__header">
        <div><p className="shell-eyebrow">QUICK NAVIGATION</p><h2 id="command-palette-title">ไปยังหน้าจอ</h2></div>
        <Button ref={closeRef} type="button" size="icon" className="shell-overlay-close" aria-label="ปิดคำสั่ง" onClick={onClose}>×</Button>
      </header>
      <label className="command-palette__search" htmlFor="command-palette-search">
        <span aria-hidden="true">⌕</span>
        <TextInput ref={inputRef} id="command-palette-search" autoComplete="off" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === 'ArrowDown' && filteredCommands.length) { event.preventDefault(); panelRef.current?.querySelector<HTMLButtonElement>('.command-palette__result')?.focus(); } }} placeholder="ค้นหาหน้าจอหรือการตั้งค่า…" />
        <kbd>Esc</kbd>
      </label>
      <p id="command-palette-help" className="command-palette__help">ใช้ ↑ ↓ เพื่อเลือก และ Enter เพื่อเปิด</p>
      {filteredCommands.length ? <ul className="command-palette__results" aria-label="คำสั่งที่พบ">
        {filteredCommands.map((command, index) => <li key={command.id}>
          <Button type="button" className="command-palette__result" aria-current={command.current ? 'page' : undefined} onClick={command.action} onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); moveResultFocus(event.currentTarget, 1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); if (index === 0) inputRef.current?.focus(); else moveResultFocus(event.currentTarget, -1); }
          }}>
            <span className="command-palette__icon" aria-hidden="true">{command.icon}</span><span className="command-palette__label">{command.label}</span><small>{command.group}</small>
          </Button>
        </li>)}
      </ul> : <p className="command-palette__empty" role="status">ไม่พบหน้าจอที่ตรงกับคำค้นหา</p>}
      <footer className="command-palette__footer"><span><kbd>↑</kbd><kbd>↓</kbd> เลือก</span><span><kbd>Enter</kbd> เปิด</span><span><kbd>Ctrl</kbd><kbd>K</kbd> คำสั่ง</span></footer>
    </DialogSurface>
  </div>;
}
