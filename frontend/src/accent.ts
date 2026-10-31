export type AccentTheme = 'teal' | 'indigo' | 'navy' | 'emerald' | 'plum' | string;
export const ACCENT_STORAGE_KEY = 'sms-v3-accent';
export const DEFAULT_ACCENT: AccentTheme = 'teal';
export const BUILTIN_ACCENT_OPTIONS: Array<{ value: AccentTheme; label: string; swatch: string }> = [
  { value: 'teal', label: 'เขียวน้ำทะเล', swatch: '#0e8f88' },
  { value: 'indigo', label: 'คราม', swatch: '#4f46e5' },
  { value: 'navy', label: 'น้ำเงินเข้ม', swatch: '#1e3a5f' },
  { value: 'emerald', label: 'เขียวมรกต', swatch: '#047857' },
  { value: 'plum', label: 'พลัม', swatch: '#7e3f72' }
];

export const ACCENT_OPTIONS = BUILTIN_ACCENT_OPTIONS;

export function getAllAccentOptions(customSidebarOptions?: Array<{ id: string; label: string; color: string }>): Array<{ value: AccentTheme; label: string; swatch: string }> {
  if (!Array.isArray(customSidebarOptions) || customSidebarOptions.length === 0) {
    return BUILTIN_ACCENT_OPTIONS;
  }
  return customSidebarOptions.map((opt) => ({
    value: opt.id,
    label: opt.label || opt.id,
    swatch: opt.color
  }));
}

export function normalizeAccent(value: unknown, allowedOptions: Array<{ value: AccentTheme }> = BUILTIN_ACCENT_OPTIONS): AccentTheme {
  const defaultVal = allowedOptions[0]?.value || DEFAULT_ACCENT;
  return allowedOptions.some((option) => option.value === value) ? (value as AccentTheme) : defaultVal;
}

export function readAccent(storage?: Pick<Storage, 'getItem' | 'setItem'>, allowedOptions?: Array<{ value: AccentTheme }>): AccentTheme {
  try {
    const raw = storage?.getItem(ACCENT_STORAGE_KEY);
    const normalized = normalizeAccent(raw, allowedOptions);
    // If the stored accent was deleted from allowed options, reset storage to default
    if (raw && raw !== normalized && storage?.setItem) {
      storage.setItem(ACCENT_STORAGE_KEY, normalized);
    }
    return normalized;
  } catch {
    return allowedOptions?.[0]?.value || DEFAULT_ACCENT;
  }
}

export function persistAccent(accent: AccentTheme, storage?: Pick<Storage, 'setItem'>): void {
  try { storage?.setItem(ACCENT_STORAGE_KEY, accent); } catch { /* best effort */ }
}

/** Accent applies to the authenticated app shell only; public pages keep their own palette. */
export function applyAccent(accent: AccentTheme, shell?: HTMLElement | null): void {
  if (!shell) return;
  shell.dataset.accent = accent;
}
