'use strict';

// Global UI colour palette (Owner batch 12 B). One SystemSetting row (JSON, 7 colours) that only ADMIN
// writes through the governed PUT /system-settings/:key path (audit + history). Every authenticated
// user reads it through GET /ui-theme, which exposes this key only. Each colour must reach WCAG
// contrast >= 4.5:1 against the surface it is used on; anything else is rejected (fail closed).

const UI_THEME_PALETTE_KEY = 'UI_THEME_PALETTE';
const MIN_CONTRAST = 4.5;
const DEFAULT_SIDEBAR_OPTIONS = Object.freeze([
  { id: 'teal', label: 'เขียวน้ำทะเล', color: '#0b4f4b' },
  { id: 'indigo', label: 'คราม', color: '#312e81' },
  { id: 'navy', label: 'น้ำเงินเข้ม', color: '#1e3a5f' },
  { id: 'emerald', label: 'เขียวมรกต', color: '#0b513b' },
  { id: 'plum', label: 'พลัม', color: '#572b50' }
]);

const DEFAULT_UI_THEME_PALETTE = Object.freeze({
  primary: '#2563eb',
  secondary: '#43506a',
  buttonPrimary: '#1d4ed8',
  buttonSecondary: '#43506a',
  success: '#0e7a42',
  warning: '#8f5300',
  danger: '#b42318'
});
const PALETTE_FIELDS = Object.freeze(Object.keys(DEFAULT_UI_THEME_PALETTE));
// Light surfaces each colour is rendered on (text colour vs background, or white text on a filled button).
const CONTRAST_SURFACE = Object.freeze({
  primary: '#ffffff',
  secondary: '#f3f5f9',
  buttonPrimary: '#ffffff',
  buttonSecondary: '#ffffff',
  success: '#ffffff',
  warning: '#ffffff',
  danger: '#ffffff'
});
const HEX = /^#[0-9a-f]{6}$/i;

function invalid(message, code = 'SYSTEM_SETTING_VALUE_INVALID') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function luminance(hex) {
  const channels = hex.slice(1).match(/../g).map((part) => parseInt(part, 16) / 255)
    .map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(a, b) {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function parsePalette(value) {
  let parsed;
  try { parsed = JSON.parse(String(value)); } catch { throw invalid('UI theme palette must be JSON.'); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalid('UI theme palette must be an object.');
  const keys = Object.keys(parsed);
  // Allowed keys: mandatory PALETTE_FIELDS and optional sidebarOptions
  const hasAllRequired = PALETTE_FIELDS.every((field) => keys.includes(field));
  const hasOnlyAllowed = keys.every((key) => PALETTE_FIELDS.includes(key) || key === 'sidebarOptions');
  if (!hasAllRequired || !hasOnlyAllowed) {
    throw invalid(`UI theme palette must contain: ${PALETTE_FIELDS.join(', ')}.`);
  }
  const palette = {};
  for (const field of PALETTE_FIELDS) {
    const colour = String(parsed[field] ?? '');
    if (!HEX.test(colour)) throw invalid(`${field} must be a #RRGGBB colour.`);
    palette[field] = colour.toLowerCase();
  }
  if (parsed.sidebarOptions !== undefined) {
    if (!Array.isArray(parsed.sidebarOptions)) {
      throw invalid('sidebarOptions must be an array.');
    }
    palette.sidebarOptions = parsed.sidebarOptions.map((opt, idx) => {
      if (!opt || typeof opt !== 'object') throw invalid(`sidebarOptions[${idx}] must be an object.`);
      const color = String(opt.color ?? '');
      if (!HEX.test(color)) throw invalid(`sidebarOptions[${idx}].color must be a #RRGGBB colour.`);
      const id = String(opt.id ?? '').trim() || `custom-${idx + 1}`;
      const label = String(opt.label ?? '').trim() || id;
      return { id, label, color: color.toLowerCase() };
    });
  }
  return palette;
}

function contrastViolations(palette) {
  const violations = PALETTE_FIELDS
    .map((field) => ({ field, ratio: Math.round(contrastRatio(palette[field], CONTRAST_SURFACE[field]) * 100) / 100 }))
    .filter((row) => row.ratio < MIN_CONTRAST);
  if (Array.isArray(palette.sidebarOptions)) {
    for (const opt of palette.sidebarOptions) {
      // Sidebar text is white (#ffffff), ratio must be >= 4.5:1
      const ratio = Math.round(contrastRatio(opt.color, '#ffffff') * 100) / 100;
      if (ratio < MIN_CONTRAST) {
        violations.push({ field: `sidebarOptions(${opt.label || opt.id})`, ratio });
      }
    }
  }
  return violations;
}

function normalizeUiThemePalette(value) {
  const palette = parsePalette(value);
  const violations = contrastViolations(palette);
  if (violations.length) {
    const error = invalid(`Contrast below ${MIN_CONTRAST}:1 for ${violations.map((row) => `${row.field} ${row.ratio}:1`).join(', ')}.`, 'UI_THEME_CONTRAST_TOO_LOW');
    error.violations = violations;
    throw error;
  }
  return JSON.stringify(palette);
}

async function readUiThemePalette(client) {
  const row = await client.systemSetting.findUnique({ where: { key: UI_THEME_PALETTE_KEY }, select: { value: true, updatedAt: true } });
  if (!row) return { palette: { ...DEFAULT_UI_THEME_PALETTE, sidebarOptions: DEFAULT_SIDEBAR_OPTIONS }, isDefault: true, updatedAt: null };
  try {
    const parsed = JSON.parse(normalizeUiThemePalette(row.value));
    if (!parsed.sidebarOptions) parsed.sidebarOptions = [...DEFAULT_SIDEBAR_OPTIONS];
    return { palette: parsed, isDefault: false, updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null };
  } catch {
    return { palette: { ...DEFAULT_UI_THEME_PALETTE, sidebarOptions: DEFAULT_SIDEBAR_OPTIONS }, isDefault: true, updatedAt: null };
  }
}

module.exports = {
  UI_THEME_PALETTE_KEY, DEFAULT_UI_THEME_PALETTE, DEFAULT_SIDEBAR_OPTIONS, PALETTE_FIELDS, CONTRAST_SURFACE, MIN_CONTRAST,
  contrastRatio, contrastViolations, normalizeUiThemePalette, readUiThemePalette
};
