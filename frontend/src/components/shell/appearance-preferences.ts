export type AppearanceMode = 'light' | 'dark';
export type AccentTheme = 'navy' | 'teal' | 'emerald';
export type AppearancePreferences = { mode: AppearanceMode; accent: AccentTheme };

const STORAGE_KEY = 'smsv3.appearance.v1';
export const DEFAULT_APPEARANCE: AppearancePreferences = { mode: 'light', accent: 'navy' };

function isAppearancePreferences(value: unknown): value is AppearancePreferences {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (candidate.mode === 'light' || candidate.mode === 'dark')
    && (candidate.accent === 'navy' || candidate.accent === 'teal' || candidate.accent === 'emerald');
}

export function readAppearancePreferences(): AppearancePreferences {
  if (typeof window === 'undefined') return DEFAULT_APPEARANCE;
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = value ? JSON.parse(value) : undefined;
    return isAppearancePreferences(parsed) ? parsed : DEFAULT_APPEARANCE;
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof document === 'undefined') return;
  const appShell = document.querySelector<HTMLElement>('.app-shell');
  if (!appShell) return;
  appShell.dataset.mode = preferences.mode;
  if (preferences.accent === 'navy') delete appShell.dataset.accent;
  else appShell.dataset.accent = preferences.accent;
}

export function saveAppearancePreferences(preferences: AppearancePreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // The UI preference remains active for this session when browser storage is unavailable.
  }
}
