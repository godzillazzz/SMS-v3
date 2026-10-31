import '../styles/ui-accent.css';
import { useEffect, useState } from 'react';
import {
  BUILTIN_ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  getAllAccentOptions,
  applyAccent,
  persistAccent,
  readAccent,
  type AccentTheme
} from '../accent';
import { fetchUiPalette, type SidebarOption } from '../ui-palette';

export function AccentControl({ token }: { token?: string }) {
  const [sidebarOptions, setSidebarOptions] = useState<SidebarOption[] | undefined>();
  const options = getAllAccentOptions(sidebarOptions);

  const [accent, setAccent] = useState<AccentTheme>(() =>
    typeof window !== 'undefined' ? readAccent(window.localStorage, BUILTIN_ACCENT_OPTIONS) : DEFAULT_ACCENT
  );

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchUiPalette(token)
      .then((res) => {
        if (!active || !res?.palette) return;
        const custom = res.palette.sidebarOptions;
        setSidebarOptions(custom);
        const currentOptions = getAllAccentOptions(custom);
        const current = readAccent(window.localStorage, currentOptions);
        setAccent(current);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [token]);

  useEffect(() => {
    persistAccent(accent, window.localStorage);
    applyAccent(accent, document.querySelector<HTMLElement>('.app-shell'));
  }, [accent]);

  return <div className="accent-control" role="group" aria-label="สีแถบข้างและสีหลัก">
    {options.map((option) => <button
      key={option.value}
      type="button"
      className={accent === option.value ? 'is-active' : ''}
      style={{ ['--swatch' as string]: option.swatch }}
      aria-pressed={accent === option.value}
      aria-label={`สีแถบข้าง${option.label}`}
      title={option.label}
      onClick={() => setAccent(option.value)}
    />)}
  </div>;
}
