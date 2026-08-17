import { useEffect, useState } from 'react';
import { SmsIcon } from './SmsIcon';
import { applyThemePreference, normalizeThemePreference, persistThemePreference, readThemePreference, type ThemePreference } from '../theme';

const options: Array<{ value: ThemePreference; label: string; icon: 'system' | 'sun' | 'moon' }> = [
  { value: 'system', label: 'ตามระบบ', icon: 'system' },
  { value: 'light', label: 'สว่าง', icon: 'sun' },
  { value: 'dark', label: 'มืด', icon: 'moon' }
];

function initialPreference(): ThemePreference {
  if (typeof document !== 'undefined') {
    const bootstrapped = normalizeThemePreference(document.documentElement.dataset.themePreference);
    if (document.documentElement.dataset.themePreference) return bootstrapped;
  }
  return typeof window !== 'undefined' ? readThemePreference(window.localStorage) : 'system';
}

export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const [preference, setPreference] = useState<ThemePreference>(initialPreference);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => applyThemePreference(preference, document.documentElement, media);
    persistThemePreference(preference, window.localStorage);
    apply();
    if (preference !== 'system') return undefined;
    media.addEventListener?.('change', apply);
    return () => media.removeEventListener?.('change', apply);
  }, [preference]);

  return <div className={`theme-control ${compact ? 'theme-control--compact' : ''}`} role="group" aria-label="โหมดสีของระบบ">
    {options.map((option) => <button
      key={option.value}
      type="button"
      className={preference === option.value ? 'is-active' : ''}
      aria-pressed={preference === option.value}
      aria-label={`ธีม${option.label}`}
      title={`ธีม${option.label}`}
      onClick={() => setPreference(option.value)}
    ><SmsIcon name={option.icon} size={16} /><span>{option.label}</span></button>)}
  </div>;
}
