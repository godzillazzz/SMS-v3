import { useEffect, useState } from 'react';
import { ACCENT_OPTIONS, applyAccent, persistAccent, readAccent, type AccentTheme } from '../accent';

export function AccentControl() {
  const [accent, setAccent] = useState<AccentTheme>(() => typeof window !== 'undefined' ? readAccent(window.localStorage) : 'navy');
  useEffect(() => {
    persistAccent(accent, window.localStorage);
    applyAccent(accent, document.querySelector<HTMLElement>('.app-shell'));
  }, [accent]);
  return <div className="accent-control" role="group" aria-label="สีหลักของระบบ">
    {ACCENT_OPTIONS.map((option) => <button
      key={option.value}
      type="button"
      className={accent === option.value ? 'is-active' : ''}
      style={{ ['--swatch' as string]: option.swatch }}
      aria-pressed={accent === option.value}
      aria-label={`สีหลัก${option.label}`}
      title={option.label}
      onClick={() => setAccent(option.value)}
    />)}
  </div>;
}
