export type AccentTheme = 'navy' | 'teal' | 'emerald' | 'plum';
export const ACCENT_STORAGE_KEY = 'sms-v3-accent';
export const ACCENT_OPTIONS: Array<{ value: AccentTheme; label: string; swatch: string }> = [
  { value: 'navy', label: 'กรมท่า', swatch: '#1e3a5f' },
  { value: 'teal', label: 'เขียวน้ำทะเล', swatch: '#0f6b75' },
  { value: 'emerald', label: 'เขียวมรกต', swatch: '#1f6b4a' },
  { value: 'plum', label: 'ม่วง', swatch: '#5b3d8a' }
];

export function normalizeAccent(value: unknown): AccentTheme {
  return ACCENT_OPTIONS.some((option) => option.value === value) ? value as AccentTheme : 'navy';
}

export function readAccent(storage?: Pick<Storage, 'getItem'>): AccentTheme {
  try { return normalizeAccent(storage?.getItem(ACCENT_STORAGE_KEY)); } catch { return 'navy'; }
}

export function persistAccent(accent: AccentTheme, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(ACCENT_STORAGE_KEY, accent); } catch { /* best effort */ }
}

/** Accent applies to the authenticated app shell only; public pages keep their own palette. */
export function applyAccent(accent: AccentTheme, shell?: HTMLElement | null): void {
  if (!shell) return;
  if (accent === 'navy') delete shell.dataset.accent;
  else shell.dataset.accent = accent;
}
