import { useEffect, useRef, type RefObject } from 'react';
import { Button, DialogSurface } from '../ui/primitives';
import type { AccentTheme, AppearanceMode, AppearancePreferences } from './appearance-preferences';

type Props = {
  preferences: AppearancePreferences;
  onChange(preferences: AppearancePreferences): void;
  onClose(): void;
  restoreFocusRef: RefObject<HTMLElement | null>;
};

const modes: Array<{ value: AppearanceMode; label: string; description: string; icon: string }> = [
  { value: 'light', label: 'สว่าง', description: 'พื้นหลังสว่างและอ่านง่าย', icon: '☀' },
  { value: 'dark', label: 'มืด', description: 'พื้นหลังโทนเข้ม', icon: '☾' }
];
const accents: Array<{ value: AccentTheme; label: string; color: string }> = [
  { value: 'navy', label: 'Navy', color: '#1d4ed8' },
  { value: 'teal', label: 'Teal', color: '#0b7a74' },
  { value: 'emerald', label: 'Emerald', color: '#047857' }
];

export function AppearancePanel({ preferences, onChange, onClose, restoreFocusRef }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = document.documentElement.style.overflow;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
    closeRef.current?.focus();

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

  return <div className="shell-overlay-backdrop appearance-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <DialogSurface ref={panelRef} className="appearance-panel" labelledBy="appearance-panel-title" aria-describedby="appearance-panel-description">
      <header className="appearance-panel__header">
        <div><p className="shell-eyebrow">PREFERENCES</p><h2 id="appearance-panel-title">การแสดงผล</h2></div>
        <Button ref={closeRef} type="button" size="icon" className="shell-overlay-close" aria-label="ปิดการตั้งค่าการแสดงผล" onClick={onClose}>×</Button>
      </header>
      <p id="appearance-panel-description" className="appearance-panel__description">เลือกธีมและสีหลักสำหรับหน้าจอนี้ การตั้งค่านี้บันทึกไว้ในเบราว์เซอร์ของคุณ</p>
      <fieldset className="appearance-choice-group">
        <legend>โหมดสี</legend>
        <div className="appearance-mode-options">
          {modes.map((mode) => <Button key={mode.value} type="button" variant={preferences.mode === mode.value ? 'primary' : 'neutral'} className="appearance-mode-option" aria-pressed={preferences.mode === mode.value} onClick={() => onChange({ ...preferences, mode: mode.value })}>
            <span aria-hidden="true" className="appearance-mode-option__icon">{mode.icon}</span><span><strong>{mode.label}</strong><small>{mode.description}</small></span>
          </Button>)}
        </div>
      </fieldset>
      <fieldset className="appearance-choice-group">
        <legend>สีหลัก</legend>
        <div className="appearance-accent-options">
          {accents.map((accent) => <Button key={accent.value} type="button" variant={preferences.accent === accent.value ? 'neutral' : undefined} className="appearance-accent-option" aria-pressed={preferences.accent === accent.value} onClick={() => onChange({ ...preferences, accent: accent.value })}>
            <span aria-hidden="true" className="appearance-accent-swatch" style={{ backgroundColor: accent.color }} />
            <span>{accent.label}</span>
            {preferences.accent === accent.value && <span aria-hidden="true" className="appearance-accent-check">✓</span>}
          </Button>)}
        </div>
      </fieldset>
      <div className="appearance-panel__footer"><span>Preview</span><span className="appearance-preview"><i aria-hidden="true" /> <b>SMS v3</b> <small>Dashboard</small></span></div>
    </DialogSurface>
  </div>;
}
