export type AccentTheme = 'teal' | 'indigo' | 'navy' | 'emerald' | 'plum';
export const ACCENT_STORAGE_KEY = 'sms-v3-accent';
export const DEFAULT_ACCENT: AccentTheme = 'teal';
export const ACCENT_OPTIONS: Array<{ value: AccentTheme; label: string; swatch: string }> = [
  { value: 'teal', label: 'เขียวน้ำทะเล', swatch: '#0e8f88' },
  { value: 'indigo', label: 'คราม', swatch: '#4f46e5' },
  { value: 'navy', label: 'น้ำเงินเข้ม', swatch: '#1e3a5f' },
  { value: 'emerald', label: 'เขียวมรกต', swatch: '#047857' },
  { value: 'plum', label: 'พลัม', swatch: '#7e3f72' }
];

export function normalizeAccent(value: unknown): AccentTheme {
  return ACCENT_OPTIONS.some((option) => option.value === value) ? value as AccentTheme : DEFAULT_ACCENT;
}

export function readAccent(storage?: Pick<Storage, 'getItem'>): AccentTheme {
  try { return normalizeAccent(storage?.getItem(ACCENT_STORAGE_KEY)); } catch { return DEFAULT_ACCENT; }
}

export function persistAccent(accent: AccentTheme, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(ACCENT_STORAGE_KEY, accent); } catch { /* best effort */ }
}

/** Accent applies to the authenticated app shell only; public pages keep their own palette. */
export function applyAccent(accent: AccentTheme, shell?: HTMLElement | null): void {
  if (!shell) return;
  shell.dataset.accent = accent;
}
