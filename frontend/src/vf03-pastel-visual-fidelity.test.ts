import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const root = path.resolve(__dirname);
const read = (name: string) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const main = read('main.tsx');
const tokens = read('styles/tokens.css');
const css = read('styles/visual-fidelity.css');
const dataCss = read('styles/data-surfaces.css');
const metrics = read('components/dashboard/MetricsGrid.tsx');
const quickActions = read('components/dashboard/QuickActionsCard.tsx');
const personnel = read('pages/personnel/PersonnelDirectoryPage.tsx');
const access = read('pages/access-management/AccessManagementPage.tsx');
const review = read('pages/access-management/RegistrationReviewPanel.tsx');
const apiBytes = fs.readFileSync(path.join(root, 'api.ts'), 'utf8').replace(/\r\n/g, '\n');
const apiSha256 = crypto.createHash('sha256').update(apiBytes).digest('hex');

describe('G04.2 VF-03 colorful pastel + midnight dark visual contract', () => {
  it('defines one shared pastel family and semantic accent surfaces in the authoritative token layer', () => {
    for (const token of [
      '--pastel-lavender-100', '--pastel-blush-100', '--pastel-peach-100',
      '--pastel-mint-100', '--pastel-sky-100', '--pastel-cream-100'
    ]) expect(tokens).toContain(token);
    for (const token of [
      '--surface-accent-primary', '--surface-accent-success', '--surface-accent-warning',
      '--surface-accent-attention', '--surface-accent-danger', '--surface-accent-info'
    ]) expect((tokens.match(new RegExp(token, 'g')) || []).length).toBeGreaterThanOrEqual(2);
    for (const token of ['--pastel-page-lavender', '--pastel-page-blush', '--pastel-page-peach', '--pastel-page-mint', '--pastel-page-sky']) {
      expect(tokens).toContain(token);
    }
  });

  it('keeps one late VF authority instead of adding a competing VF stylesheet', () => {
    expect((main.match(/visual-fidelity\.css/g) || []).length).toBe(1);
    expect(main).not.toContain('vf03-pastel.css');
    expect(css).toContain('G04.2 VF-03');
    expect(css).toContain('pastel colorful visual fidelity correction');
  });

  it('renders broad multi-family ambience in both Light and Midnight Dark', () => {
    for (const token of ['--pastel-page-lavender', '--pastel-page-blush', '--pastel-page-peach', '--pastel-page-mint', '--pastel-page-sky']) {
      expect(css).toContain(`var(${token})`);
    }
    expect(css).toContain('[data-theme="light"] body');
    expect(css).toContain('[data-theme="dark"] body');
    expect(css).toContain('var(--color-bg)');
  });

  it('maps the four real Dashboard KPIs to mint, sky, cream and blush identities', () => {
    expect(metrics).toContain('label="กำลังปฏิบัติงาน"');
    expect(metrics).toContain('tone="green"');
    expect(metrics).toContain('label="ลาวันนี้"');
    expect(metrics).toContain('tone="teal"');
    expect(metrics).toContain('label="รออนุมัติ"');
    expect(metrics).toContain('tone="warning"');
    expect(metrics).toContain('label="ต้องติดตาม"');
    expect(metrics).toContain('tone="urgent"');
    expect(css).toMatch(/\.dashboard-metric--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.dashboard-metric--teal\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-info\)/s);
    expect(css).toMatch(/\.dashboard-metric--warning\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
    expect(css).toMatch(/\.dashboard-metric--urgent\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-danger\)/s);
  });

  it('gives real Quick Access modules distinct restrained pastel accents without inventing modules', () => {
    for (const title of ['ข้อมูลพนักงาน', 'ตารางกะรายเดือน', 'ศูนย์อนุมัติ', 'ใบอนุญาต รปภ.']) expect(quickActions).toContain(title);
    for (const fake of ['Payroll', 'Recruitment', 'Training', 'Benefits', 'เงินเดือน', 'สรรหา']) expect(quickActions).not.toContain(fake);
    for (const index of [1, 2, 3, 4]) expect(css).toContain(`.dashboard-quick-actions__grid button:nth-child(${index})`);
    expect(css).toContain('--quick-wash: var(--decorative-lavender)');
    expect(css).toContain('--quick-wash: var(--decorative-mint)');
    expect(css).toContain('--quick-wash: var(--decorative-cream)');
    expect(css).toContain('--quick-wash: var(--decorative-blush)');
  });

  it('keeps Personnel business behavior while giving its three real metrics distinct pastel identities', () => {
    expect(personnel).toContain('pageSize = 10');
    expect(personnel).toContain('label="บุคลากรทั้งหมด"');
    expect(personnel).toContain('tone="indigo"');
    expect(personnel).toContain('label="บุคลากรที่ใช้งาน"');
    expect(personnel).toContain('tone="green"');
    expect(personnel).toContain('label="โปรไฟล์ไม่สมบูรณ์"');
    expect(personnel).toContain('tone="amber"');
    expect(css).toMatch(/\.personnel-metric\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-primary\)/s);
    expect(css).toMatch(/\.personnel-metric--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.personnel-metric--amber\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
  });

  it('gives Access summary states distinct pastel identities without changing action authority', () => {
    for (const tone of ['indigo', 'green', 'amber', 'red', 'purple']) expect(access).toContain(`tone: '${tone}'`);
    expect(css).toMatch(/\.access-summary-card\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-primary\)/s);
    expect(css).toMatch(/\.access-summary-card--green\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-success\)/s);
    expect(css).toMatch(/\.access-summary-card--amber\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-warning\)/s);
    expect(css).toMatch(/\.access-summary-card--red\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-danger\)/s);
    expect(css).toMatch(/\.access-summary-card--purple\s*\{[^}]*--vf03-wash:\s*var\(--surface-accent-attention\)/s);
    expect(access).toContain('visibleAccountActions(role, account, originalUserId)');
    expect(access).toContain('executeConfirmedViewAs');
  });

  it('uses semantic pastel request states while preserving Registration Review workflow exactly', () => {
    expect(review).toContain('registration-review__request--${requestTone[row.status]');
    for (const tone of ['warning', 'info', 'success', 'danger']) expect(css).toContain(`.registration-review__request--${tone}`);
    expect(review).toContain('api.matchRegistrationRequest(token, selected.id, employeeId)');
    expect(review).toContain('api.approveRegistrationRequest(token, selected.id)');
    expect(review).toContain('อนุมัติเป็นผู้ใช้งาน');
    expect(review).toContain('role="dialog"');
    expect(review).not.toContain('window.prompt');
    expect(review).not.toContain('window.confirm');
  });

  it('keeps a decorative Auth hero while retaining VF-02 true single-column mobile behavior after the Owner shield correction', () => {
    expect(main).toContain('className="auth-pastel-illustration auth-security-shield-scene" aria-hidden="true"');
    expect(main).toContain('className="auth-security-shield"');
    expect(main).not.toContain('auth-security-core-scene');
    expect(main).not.toContain('auth-pastel-shield');
    expect(main).toContain('className="auth-mobile-brand"');
    expect(css).toContain('G04.2 VF-07');
    expect(css).toContain('.auth-security-shield__outer');
    expect(css).toContain('.auth-security-shield__lock-body');
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-security-shield-scene,[\s\S]*?display:\s*none !important;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-brand-panel\s*\{\s*display:\s*none !important;/);
    expect(css).toMatch(/@media \(max-width: 760px\)[\s\S]*?\.auth-experience-shell\s*\{[\s\S]*?grid-template-columns:\s*1fr !important;/);
  });

  it('keeps decorative pastel separate from semantic status truth', () => {
    const rootTheme = tokens.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    const lightTheme = tokens.match(/\[data-theme="light"\]\s*\.app-shell\s*\{([\s\S]*?)\n\}/)?.[1] || '';
    const declarations = new Map([...lightTheme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    const rootDeclarations = new Map([...rootTheme.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    const resolve = (name: string, seen = new Set<string>()): string => {
      if (seen.has(name)) throw new Error(`cyclic token alias: ${name}`);
      const value = declarations.get(name) ?? rootDeclarations.get(name);
      if (!value) throw new Error(`missing light token: ${name}`);
      const alias = value.match(/^var\((--[\w-]+)\)$/)?.[1];
      return alias ? resolve(alias, new Set(seen).add(name)) : value.toLowerCase();
    };
    const hexToRgb = (value: string): [number, number, number] => {
      const match = value.match(/^#([\da-f]{6})$/i);
      if (!match) throw new Error(`expected six-digit hex token, received ${value}`);
      return [0, 1, 2].map((index) => Number.parseInt(match[1].slice(index * 2, index * 2 + 2), 16)) as [number, number, number];
    };
    const contrast = (foreground: string, background: string) => {
      const luminance = (value: string) => hexToRgb(value).map((channel) => channel / 255).map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const tones = ['success', 'warning', 'attention', 'danger', 'info'];
    const decorative = ['primary', 'success', 'warning', 'attention', 'danger', 'info'].map((tone) => resolve(`--surface-accent-${tone}`));
    for (const tone of tones) {
      const semantic = resolve(`--color-${tone}-soft`);
      expect(semantic).toBeTruthy();
      expect(decorative).not.toContain(semantic);
      expect(contrast(resolve(`--color-${tone}`), semantic), tone).toBeGreaterThanOrEqual(4.5);
      expect(dataCss).toContain(`.status-badge--${tone}`);
    }
    for (const tone of ['primary', 'success', 'warning', 'attention', 'danger', 'info']) {
      expect(resolve(`--surface-accent-${tone}`)).toBe(resolve(`--pastel-${tone === 'primary' ? 'lavender' : tone === 'success' ? 'mint' : tone === 'warning' ? 'cream' : tone === 'attention' ? 'peach' : tone === 'danger' ? 'blush' : 'sky'}-100`));
    }
  });

  it('mutation check fails when semantic success-soft becomes decorative pastel mint', () => {
    const semanticSuccess = '--color-success-soft: #dcfce7;';
    const mutatedTokens = tokens.replace(semanticSuccess, '--color-success-soft: var(--pastel-mint-100);');
    const mutated = new Map([...mutatedTokens.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value.trim()]));
    const resolve = (name: string): string => {
      const value = mutated.get(name);
      const alias = value?.match(/^var\((--[\w-]+)\)$/)?.[1];
      return alias ? resolve(alias) : value || '';
    };
    expect(resolve('--color-success-soft')).not.toBe(resolve('--surface-accent-success'));
  });

  it('locks the authorized API source after T25 cross-tab refresh coordination', () => {
    expect(apiSha256).toBe('10585a3f0c2dec7bf1bfe9078bbb564d971af130dc2ea0e3d7902eb626c3d3a4');
  });
});
