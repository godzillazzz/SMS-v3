import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const css = read('./styles/employee-pwa-theme.css');
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
function luminance(hex: string) {
  const c = hex.slice(1).match(/.{2}/g)!.map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
}
function ratio(fg: string, bg: string) {
  const [a, b] = [luminance(palette.get(fg)!), luminance(palette.get(bg)!)].sort((x, y) => y - x);
  return (a + .05) / (b + .05);
}

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
});
