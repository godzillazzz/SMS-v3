export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'sms-v3-theme';

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function resolveThemePreference(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === 'system' ? (systemDark ? 'dark' : 'light') : preference;
}

export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  if (!storage) return 'system';
  try {
    return normalizeThemePreference(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function persistThemePreference(preference: ThemePreference, storage?: Pick<Storage, 'setItem'>): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    // Local persistence is best-effort; theme switching must remain functional.
  }
}

export function systemPrefersDark(media?: Pick<MediaQueryList, 'matches'>): boolean {
  return Boolean(media?.matches);
}

export function applyThemePreference(
  preference: ThemePreference,
  root?: Pick<HTMLElement, 'dataset'>,
  media?: Pick<MediaQueryList, 'matches'>
): ResolvedTheme {
  const resolved = resolveThemePreference(preference, systemPrefersDark(media));
  if (root) {
    root.dataset.theme = resolved;
    root.dataset.themePreference = preference;
  }
  return resolved;
}
