// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DEFAULT_UI_PALETTE, PALETTE_FIELDS, UI_PALETTE_KEY, applyUiPalette, contrastRatio, paletteContrastChecks, paletteCss, isHexColour
} from './ui-palette';

describe('batch12 B global colour palette', () => {
  it('matches the backend defaults and key', () => {
    expect(UI_PALETTE_KEY).toBe('UI_THEME_PALETTE');
    expect(PALETTE_FIELDS).toEqual(['primary', 'secondary', 'buttonPrimary', 'buttonSecondary', 'success', 'warning', 'danger']);
    expect(DEFAULT_UI_PALETTE.primary).toBe('#2563eb');
    const backend = readFileSync(join(__dirname, '../../src/services/ui-theme-palette.service.js'), 'utf8');
    for (const [field, colour] of Object.entries(DEFAULT_UI_PALETTE)) expect(backend).toContain(`${field}: '${colour}'`);
  });

  it('computes WCAG contrast and flags pairs below 4.5:1', () => {
    expect(Math.round(contrastRatio('#000000', '#ffffff'))).toBe(21);
    expect(paletteContrastChecks(DEFAULT_UI_PALETTE).every((check) => check.pass)).toBe(true);
    const failing = paletteContrastChecks({ ...DEFAULT_UI_PALETTE, warning: '#ffd166' }).filter((check) => !check.pass);
    expect(failing.map((check) => check.field)).toEqual(['warning']);
    expect(isHexColour('#A1b2C3')).toBe(true);
    expect(isHexColour('#abc')).toBe(false);
  });

  it('scopes the palette to the light authenticated shell only and beats personal accent specificity', () => {
    const css = paletteCss(DEFAULT_UI_PALETTE);
    expect(css).toContain('html[data-theme="light"] .app-shell.app-shell[data-accent]');
    expect(css).not.toContain('dark');
    expect(css).toContain('--color-primary: #2563eb');
    expect(css).toContain('--color-danger: #b42318');
  });

  it('applies and removes a single style element', () => {
    applyUiPalette({ ...DEFAULT_UI_PALETTE, primary: '#1d4ed8' }, document);
    const style = document.getElementById('sms-ui-palette');
    expect(style?.textContent).toContain('#1d4ed8');
    applyUiPalette({ ...DEFAULT_UI_PALETTE, primary: '#123456' }, document);
    expect(document.querySelectorAll('#sms-ui-palette')).toHaveLength(1);
    applyUiPalette(null, document);
    expect(document.getElementById('sms-ui-palette')).toBeNull();
  });

  it('refuses to inject invalid colours (no CSS injection)', () => {
    applyUiPalette({ ...DEFAULT_UI_PALETTE, primary: 'red;} body{display:none' } as any, document);
    expect(document.getElementById('sms-ui-palette')).toBeNull();
  });
});
