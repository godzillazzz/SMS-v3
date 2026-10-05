import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./pages/pwa-attendance/employee-attendance-v4.css', import.meta.url), 'utf8');
const simpleCss = readFileSync(new URL('./pages/attendance-simple/attendance-simple.css', import.meta.url), 'utf8');
const shellCss = readFileSync(new URL('./styles/operational-layer.css', import.meta.url), 'utf8');
const employeePwaThemeCss = readFileSync(new URL('./styles/employee-pwa-theme.css', import.meta.url), 'utf8');
const signatureThemeCss = readFileSync(new URL('./styles/signature-experience-v1-2.css', import.meta.url), 'utf8');
const darkHistoryStyles = css.slice(css.indexOf('/* Attendance History contrast for the dark PWA shell. */'));
const variablesBlock = darkHistoryStyles.match(/\.employee-v4-page\.nexus-mobile-history\s*\{([\s\S]*?)\}/)?.[1] || '';
const palette = new Map([...variablesBlock.matchAll(/(--[\w-]+):\s*(#[\da-f]{6})/gi)].map(([, name, value]) => [name, value.toLowerCase()]));

function luminance(hex: string) {
  const channels = hex.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16) / 255).map((value) =>
    value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function colorMix(foreground: string, background: string, foregroundWeight: number) {
  const channels = [foreground, background].map((value) => value.slice(1).match(/.{2}/g)!.map((channel) => parseInt(channel, 16)));
  return `#${channels[0].map((channel, index) => Math.round(channel * foregroundWeight + channels[1][index] * (1 - foregroundWeight)).toString(16).padStart(2, '0')).join('')}`;
}

function color(name: string) {
  const value = palette.get(name);
  expect(value, `missing ${name} dark-history palette value`).toBeDefined();
  return value!;
}

describe('Attendance History mobile dark-shell contrast', () => {
  it('keeps body, muted, accent, active-control and status text at WCAG AA contrast', () => {
    const pairs: Array<[string, string, string]> = [
      ['body text on history card', color('--employee-v4-ink'), color('--employee-v4-surface')],
      ['muted text on history card', color('--employee-v4-muted'), color('--employee-v4-surface')],
      ['muted text on time strip', color('--employee-v4-muted'), color('--employee-v4-history-inset')],
      ['muted text on site cards', color('--employee-v4-muted'), color('--employee-v4-history-subtle')],
      ['body text on site cards', color('--employee-v4-ink'), color('--employee-v4-history-subtle')],
      ['accent on history card', color('--employee-v4-blue'), color('--employee-v4-surface')],
      ['success status', color('--employee-v4-history-success'), color('--employee-v4-history-success-soft')],
      ['warning status', color('--employee-v4-history-warning'), color('--employee-v4-history-warning-soft')],
      ['danger status', color('--employee-v4-history-danger'), color('--employee-v4-history-danger-soft')],
      ['info status', color('--employee-v4-history-info'), color('--employee-v4-history-info-soft')],
      ['neutral status', color('--employee-v4-history-neutral'), color('--employee-v4-history-neutral-soft')],
      ['selected range control', '#020813', color('--employee-v4-blue')]
    ];

    for (const [label, foreground, background] of pairs) {
      expect(contrastRatio(foreground, background), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('scopes dark palettes to Attendance History content and its detail surfaces', () => {
    expect(darkHistoryStyles).toContain('.employee-v4-page.nexus-mobile-history .employee-v4-history-times');
    expect(darkHistoryStyles).toContain('.employee-v4-page.nexus-mobile-history .employee-v4-history-sites > div');
    expect(darkHistoryStyles).toContain('.employee-v4-page.nexus-mobile-history .employee-v4-history-correction > div:first-of-type');
    expect(darkHistoryStyles).toContain('.employee-v4-page.nexus-mobile-history .employee-v4-history-flags span');
  });
});

describe('main Attendance PWA action helper contrast', () => {
  it('keeps the clock action helper readable against the dark PWA button surface', () => {
    const helperRule = simpleCss.match(/\.app-shell\.pwa-shell \.attendance-simple__clock small\s*\{([^}]*)\}/i)?.[1];
    const secondaryColor = signatureThemeCss.match(/--signature-dark-text-secondary:\s*(#[\da-f]{6})/i)?.[1];
    const nexusSurface = shellCss.match(/--nexus-surface:\s*(#[\da-f]{6})/i)?.[1];
    const buttonSurface = shellCss.match(/\.pwa-shell :is\(input,select,textarea,button:not\(\.btn-primary\)\)\s*\{\s*background-color:\s*(#[\da-f]{6})/i)?.[1];
    expect(helperRule).toContain('color: var(--employee-pwa-text-muted);');
    expect(employeePwaThemeCss).toContain('--employee-pwa-text-muted: color-mix(in srgb, var(--employee-pwa-text-secondary) 88%, var(--nexus-surface))');
    expect(secondaryColor).toBeDefined();
    expect(nexusSurface).toBeDefined();
    expect(buttonSurface).toBeDefined();
    const helperColor = colorMix(secondaryColor!, nexusSurface!, 0.88);
    expect(contrastRatio(helperColor, buttonSurface!)).toBeGreaterThanOrEqual(7);
  });
});
