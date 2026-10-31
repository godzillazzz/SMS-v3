import { attendanceAuthenticatedRequest } from './attendance-auth-request';

// Global colour palette (Owner batch 12 B). ADMIN stores it server-side as SystemSetting
// UI_THEME_PALETTE; every signed-in user reads it from GET /ui-theme. It applies to the light theme of
// the authenticated shell only — dark mode keeps its tuned tokens (contrast was checked on light
// surfaces). Personal accent stays a per-user choice for the sidebar; the global palette wins for
// --color-primary and status colours because ADMIN defines one system palette.

export const UI_PALETTE_KEY = 'UI_THEME_PALETTE';
export const PALETTE_FIELDS = ['primary', 'secondary', 'buttonPrimary', 'buttonSecondary', 'success', 'warning', 'danger'] as const;
export type PaletteField = typeof PALETTE_FIELDS[number];
export type UiPalette = Record<PaletteField, string>;

export const DEFAULT_SIDEBAR_OPTIONS: SidebarOption[] = [
  { id: 'teal', label: 'เขียวน้ำทะเล', color: '#0b4f4b' },
  { id: 'indigo', label: 'คราม', color: '#312e81' },
  { id: 'navy', label: 'น้ำเงินเข้ม', color: '#1e3a5f' },
  { id: 'emerald', label: 'เขียวมรกต', color: '#0b513b' },
  { id: 'plum', label: 'พลัม', color: '#572b50' }
];

export const DEFAULT_UI_PALETTE: UiPaletteWithSidebar = {
  primary: '#2563eb',
  secondary: '#43506a',
  buttonPrimary: '#1d4ed8',
  buttonSecondary: '#43506a',
  success: '#0e7a42',
  warning: '#8f5300',
  danger: '#b42318',
  sidebarOptions: DEFAULT_SIDEBAR_OPTIONS
};

export const PALETTE_LABELS: Record<PaletteField, string> = {
  primary: 'สีหลัก',
  secondary: 'สีรอง',
  buttonPrimary: 'ปุ่มหลัก',
  buttonSecondary: 'ปุ่มรอง',
  success: 'สถานะปกติ',
  warning: 'สถานะเฝ้าระวัง',
  danger: 'สถานะเร่งด่วน'
};

const SURFACE: Record<PaletteField, string> = {
  primary: '#ffffff',
  secondary: '#f3f5f9',
  buttonPrimary: '#ffffff',
  buttonSecondary: '#ffffff',
  success: '#ffffff',
  warning: '#ffffff',
  danger: '#ffffff'
};

export const MIN_CONTRAST = 4.5;
const STYLE_ID = 'sms-ui-palette';

export type SidebarOption = {
  id: string;
  label: string;
  color: string;
};

export type UiPaletteWithSidebar = UiPalette & {
  sidebarOptions?: SidebarOption[];
};

export function isHexColour(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
}

function luminance(hex: string) {
  const [r, g, b] = (hex.slice(1).match(/../g) || []).map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

export function paletteContrastChecks(palette: UiPalette) {
  return PALETTE_FIELDS.map((field) => {
    const valid = isHexColour(palette[field]);
    const ratio = valid ? Math.round(contrastRatio(palette[field], SURFACE[field]) * 100) / 100 : 0;
    return { field, label: PALETTE_LABELS[field], ratio, valid, pass: valid && ratio >= MIN_CONTRAST };
  });
}

export function isValidPalette(value: unknown): value is UiPaletteWithSidebar {
  if (!value || typeof value !== 'object') return false;
  const val = value as Record<string, unknown>;
  const baseValid = PALETTE_FIELDS.every((field) => isHexColour(val[field]));
  if (!baseValid) return false;
  if (val.sidebarOptions !== undefined) {
    if (!Array.isArray(val.sidebarOptions)) return false;
    for (const opt of val.sidebarOptions) {
      if (!opt || typeof opt !== 'object') return false;
      const o = opt as Record<string, unknown>;
      if (typeof o.id !== 'string' || typeof o.label !== 'string' || !isHexColour(o.color)) return false;
    }
  }
  return true;
}

export function paletteCss(palette: UiPaletteWithSidebar) {
  // Doubled class raises specificity above ui-accent.css ([data-theme] .app-shell[data-accent]).
  const scope = 'html[data-theme="light"] .app-shell.app-shell[data-accent], html[data-theme="light"] .app-shell.app-shell';
  let css = `${scope} { --color-primary: ${palette.primary}; --color-primary-hover: ${palette.buttonPrimary}; --color-accent: ${palette.primary}; --color-text-secondary: ${palette.secondary}; --color-success: ${palette.success}; --color-warning: ${palette.warning}; --color-danger: ${palette.danger}; --sms-button-primary: ${palette.buttonPrimary}; --sms-button-secondary: ${palette.buttonSecondary}; }`;
  if (Array.isArray(palette.sidebarOptions)) {
    for (const opt of palette.sidebarOptions) {
      // Harmonic sidebar tokens: derive active item and background gradient from opt.color
      // Using color-mix against white gives a harmonious tinted glow in the same hue family
      css += `\nhtml[data-theme] .app-shell[data-accent="${opt.id}"] {
  --color-sidebar-bg: ${opt.color};
  --color-sidebar-bg-strong: color-mix(in srgb, ${opt.color} 84%, #000000);
  --sidebar-active: color-mix(in srgb, ${opt.color} 75%, #ffffff);
  --color-sidebar-hover: rgba(255, 255, 255, 0.12);
  --sidebar-item: color-mix(in srgb, ${opt.color} 30%, #ffffff);
  --sidebar-label: color-mix(in srgb, ${opt.color} 50%, #ffffff);
}`;
    }
  }
  return css;
}

export function applyUiPalette(palette: UiPaletteWithSidebar | null, doc: Document = document) {
  const existing = doc.getElementById(STYLE_ID);
  if (!palette || !isValidPalette(palette)) { existing?.remove(); return; }
  const style = existing || doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = paletteCss(palette);
  if (!existing) doc.head.appendChild(style);
}

export async function fetchUiPalette(token: string): Promise<{ palette: UiPaletteWithSidebar; isDefault: boolean } | null> {
  const response = await attendanceAuthenticatedRequest('/ui-theme', token, { method: 'GET', credentials: 'include' });
  if (!response.ok) throw new Error('UI_THEME_UNAVAILABLE');
  const payload = await response.json().catch(() => ({}));
  return payload?.data && isValidPalette(payload.data.palette) ? { palette: payload.data.palette, isDefault: Boolean(payload.data.isDefault) } : null;
}
