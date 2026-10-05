import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./styles/employee-pwa-theme.css');
const signatureThemeV11 = read('./styles/signature-experience-v1-1.css');
const signatureTheme = read('./styles/signature-experience-v1-2.css');
const attendanceSimple = read('./pages/attendance-simple/attendance-simple.css');
const attendanceV4 = read('./pages/pwa-attendance/employee-attendance-v4.css');
const index = read('../index.html');
const main = read('./main.tsx');
const manifest = JSON.parse(read('../public/manifest.webmanifest'));
const bootstrap = index.match(/<script>([\s\S]*?)<\/script>/)![1];

function boot(search: string, iosStandalone = false, displayStandalone = false) {
  const root = { dataset: {} as Record<string, string> };
  const meta = { content: '#0B58D8' };
  runInNewContext(bootstrap, {
    URLSearchParams, location: { search }, navigator: { standalone: iosStandalone },
    matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' && displayStandalone }),
    localStorage: { getItem: () => 'light' },
    document: { documentElement: root, querySelector: () => meta }
  });
  return { root, meta };
}

const palette = new Map<string, string>();
for (const file of ['./styles/command-nexus.css', './styles/operational-layer.css']) {
  for (const block of read(file).matchAll(/:root\s*\{([^}]+)\}/g)) {
    for (const [, name, value] of block[1].matchAll(/(--nexus-[\w-]+):\s*(#[\da-f]{6})/gi)) palette.set(name, value);
  }
}
for (const [, name, value] of signatureThemeV11.matchAll(/(--signature-light-text-secondary):\s*(#[\da-f]{6})/gi)) {
  palette.set(name, value);
}
for (const [, name, value] of signatureTheme.matchAll(/(--signature-dark-text-(?:secondary|muted)):\s*(#[\da-f]{6})/gi)) {
  palette.set(name, value);
}
function luminance(hex: string) {
  const c = hex.slice(1).match(/.{2}/g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
function mix(foreground: string, background: string, foregroundWeight: number) {
  const fg = foreground.slice(1).match(/.{2}/g)!.map(v => parseInt(v, 16));
  const bg = background.slice(1).match(/.{2}/g)!.map(v => parseInt(v, 16));
  return `#${fg.map((channel, index) => Math.round(channel * foregroundWeight + bg[index] * (1 - foregroundWeight)).toString(16).padStart(2, '0')).join('')}`;
}
function ratioColors(fg: string, bg: string) {
  const [a, b] = [luminance(fg), luminance(bg)].sort((x, y) => y - x);
  return (a + .05) / (b + .05);
}
function ratio(fg: string, bg: string) { return ratioColors(palette.get(fg)!, palette.get(bg)!); }

describe('Employee PWA dark chrome ownership', () => {
  it.each([
    ['explicit PWA', '?pwa=1', false, false],
    ['iOS Home Screen', '', true, false],
    ['standalone display', '', false, true]
  ])('sets dark browser chrome before paint for %s without changing the stored desktop preference', (_, search, ios, standalone) => {
    const { root, meta } = boot(search as string, ios as boolean, standalone as boolean);
    expect(root.dataset.smsShell).toBe('employee');
    expect(root.dataset.theme).toBe('light');
    expect(root.dataset.themePreference).toBe('light');
    expect(meta.content).toBe(manifest.theme_color);
    expect(manifest.background_color).toBe(palette.get('--nexus-bg'));
  });

  it('leaves normal desktop/Admin browser metadata and theme untouched', () => {
    const { root, meta } = boot('?page=dashboard&pwa=0');
    expect(root.dataset.smsShell).toBeUndefined();
    expect(root.dataset.theme).toBe('light');
    expect(meta.content).toBe('#0B58D8');
    expect(main.indexOf("import './styles/employee-pwa-theme.css'")).toBeGreaterThan(main.indexOf("import './styles/operational-layer.css'"));
  });

  it('owns root canvas and opaque chrome only in the Employee shell, including short pages', () => {
    expect(css).toContain('html[data-sms-shell="employee"] body');
    expect(css).toContain('html[data-sms-shell="employee"] #root');
    expect(css).toContain('min-height: 100dvh !important');
    expect(css).toContain('background: var(--nexus-bg) !important');
    for (const selector of ['.pwa-mobile-header', '.pwa-bottom-nav']) {
      const block = css.match(new RegExp('\\.app-shell\\.pwa-shell ' + selector.replace('.', '\\.') + '\\s*\\{([^}]+)\\}'))![1];
      expect(block).toContain('background: var(--nexus-surface)');
      expect(block).not.toContain('transparent');
    }
    expect(css).not.toMatch(/(?:^|\n)(?:body|#root|\.topbar)\s*\{/);
    expect(css).toContain('.pwa-mobile-brand .sms-brand-copy small { color: var(--nexus-muted) !important; }');
    expect(css).toContain('.employee-v4-section-header h1 { color: var(--nexus-text); }');
  });

  it('reserves content clearance and paints the entire bottom inset inside fixed nav', () => {
    expect(index).toContain('viewport-fit=cover');
    expect(css).toContain('--sms-pwa-safe-bottom: env(safe-area-inset-bottom, 0px)');
    expect(css).toContain('padding-bottom: calc(7px + var(--sms-pwa-safe-bottom))');
    expect(css).toContain('padding-bottom: calc(112px + var(--sms-pwa-safe-bottom))');
    expect(css).toContain('padding-top: calc(10px + var(--sms-pwa-safe-top))');
  });

  it.each([
    ['header title / headings', '--nexus-text', '--nexus-surface'],
    ['header subtitle / inactive nav', '--nexus-muted', '--nexus-surface'],
    ['Online pill', '--nexus-text', '--nexus-container'],
    ['active nav label / icon', '--nexus-cyan-soft', '--nexus-container']
  ])('keeps %s at WCAG AA normal-text contrast', (_, fg, bg) => {
    expect(ratio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('maps Employee PWA semantic text and Leave surfaces to the dark design tokens only inside the shell', () => {
    expect(css).toContain('--employee-pwa-text-primary: var(--nexus-text)');
    expect(css).toContain('--employee-pwa-text-secondary: var(--signature-dark-text-secondary)');
    expect(css).toContain('--employee-pwa-text-muted: color-mix(in srgb, var(--employee-pwa-text-secondary) 88%, var(--nexus-surface))');
    expect(css).toContain('--employee-pwa-text-on-light-surface: var(--signature-light-text-secondary)');
    expect(css).toContain('--color-text-secondary: var(--employee-pwa-text-secondary)');
    expect(css).toContain('--color-text-muted: var(--employee-pwa-text-muted)');
    expect(css).toContain('--employee-v4-muted: var(--employee-pwa-text-muted)');
    expect(css).toContain('--employee-v4-blue-deep: var(--employee-pwa-text-primary)');
    expect(css).toContain('--attendance-simple-text-secondary: var(--employee-pwa-text-secondary)');
    expect(css).toContain('--attendance-simple-text-muted: var(--employee-pwa-text-muted)');
    expect(css).toContain('.app-shell.pwa-shell .pwa-profile-hero p { color: var(--nexus-cyan-soft) !important; }');
    expect(css).toContain('--signature-surface: var(--nexus-surface)');
    expect(css).toContain('--signature-brand-soft: var(--nexus-container)');
    expect(css).toContain('--signature-text: var(--employee-pwa-text-primary)');
    expect(signatureThemeV11).toContain('--signature-light-text-secondary: #526075;');
    expect(signatureThemeV11).toContain('--signature-text-secondary: var(--signature-light-text-secondary);');
    expect(signatureThemeV11).toContain('--font-ui: "Noto Sans Thai", "Inter"');
    expect(signatureThemeV11).toContain('--font-heading: "Inter", "Noto Sans Thai"');
    expect(css).not.toMatch(/(?:font-family|--font-(?:ui|heading))\s*:/i);
    expect(signatureTheme).toContain(':is([data-theme="dark"], html[data-sms-shell="employee"]) .leave-page .leave-submit-card');
    expect(signatureTheme).toContain(':is([data-theme="dark"], html[data-sms-shell="employee"]) .leave-page textarea::placeholder');
    expect(signatureTheme).toContain('--signature-text-secondary: var(--signature-dark-text-secondary)');
    expect(signatureTheme).toContain('--signature-text-muted: var(--signature-dark-text-muted)');
    expect(signatureTheme).toContain('.leave-page .status-badge.pending { color:var(--signature-light-text-secondary); }');
    expect(attendanceSimple).toContain('--attendance-simple-text-secondary: #a8bacb;');
    expect(attendanceSimple).toContain('--attendance-simple-text-muted: #7f94a8;');
    expect(attendanceSimple).toContain('.attendance-simple__summary span { color:var(--attendance-simple-text-muted);');
    expect(attendanceSimple).toContain('.app-shell.pwa-shell .attendance-simple__clock small {');
    expect(attendanceSimple).toContain('color: var(--employee-pwa-text-muted);');
    expect(attendanceV4).toContain('.employee-v4-schedule-main small { display: flex; align-items: center; gap: 5px; margin-top: 5px; color: var(--employee-v4-muted);');
    expect(attendanceV4).toContain('.employee-v4-shift-highlights span {\n  color: var(--employee-v4-muted);');
    expect(attendanceV4).toContain('.employee-v4-shift-highlights small {\n  color: var(--employee-v4-muted);');
    expect(css).not.toMatch(/(?:^|\n)\[data-theme="light"\]\s*\{/);

    for (const [label, fg, bg] of [
      ['primary on surface', '--nexus-text', '--nexus-surface'],
      ['secondary on surface', '--signature-dark-text-secondary', '--nexus-surface']
    ]) {
      expect(ratio(fg, bg), label).toBeGreaterThanOrEqual(7);
    }
    expect(ratio('--signature-dark-text-muted', '--nexus-container')).toBeGreaterThanOrEqual(4.5);
    expect(ratio('--signature-dark-text-secondary', '--nexus-container')).toBeGreaterThanOrEqual(7);

    const employeeMuted = mix(palette.get('--signature-dark-text-secondary')!, palette.get('--nexus-surface')!, .88);
    const raisedLuminance = luminance(palette.get('--nexus-container')!);
    const mutedLuminance = luminance(employeeMuted);
    expect((Math.max(raisedLuminance, mutedLuminance) + .05) / (Math.min(raisedLuminance, mutedLuminance) + .05)).toBeGreaterThanOrEqual(7);
    expect(ratioColors(palette.get('--signature-light-text-secondary')!, '#f8fbff')).toBeGreaterThanOrEqual(4.5);
    expect(ratioColors(palette.get('--signature-light-text-secondary')!, '#fff6dc')).toBeGreaterThanOrEqual(4.5);
  });
});
