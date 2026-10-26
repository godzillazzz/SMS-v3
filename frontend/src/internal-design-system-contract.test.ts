import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname);
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');

const design = read('design-system.css');
const tokens = read('styles/tokens.css');
const main = read('main.tsx');
const responsiveTable = read('components/ResponsiveDataTable.tsx');

const publicOwnedFiles = [
  'styles/command-nexus.css',
  'styles/ux-t06-login-public.css',
  'styles/auth-experience.css',
  'styles/award-landing.css',
  'components/AwardPublicExperience.tsx',
];

describe('internal authenticated design-system contract', () => {
  it('defines semantic internal tokens and preserves legacy aliases', () => {
    for (const token of [
      '--color-bg', '--color-surface', '--color-border', '--color-text', '--space-1', '--space-4',
      '--radius-sm', '--shadow-sm', '--font-sans', '--focus-ring', '--focus-color',
      '--status-success-text', '--status-warning-text', '--status-danger-text', '--status-info-text',
    ]) expect(tokens).toContain(token);
    expect(tokens).toContain('--sms-page: var(--color-bg)');
    expect(tokens).toContain('--sms-text: var(--color-text)');
  });

  it('adopts the corporate internal palette and typography contract', () => {
    for (const value of [
      '--color-bg: #f4f6f9', '--color-primary: #1e3a5f', '--color-accent: #2563eb',
      '--color-surface: #ffffff', '--color-border: #e3e8ef', '--color-text: #1f2937',
      '--color-text-secondary: #5b6675', '--color-text-muted: #616c80',
      '--font-size-page-title: 22px', '--font-size-section-title: 15px',
      '--font-size-body: 0.875rem', '--font-size-metric: 26px',
      '--radius-sm: 7px', '--radius-md: 10px', '--radius-lg: 16px',
    ]) expect(tokens).toContain(value);
    expect(tokens).toContain('--focus-color: var(--color-accent)');
    expect(tokens).toContain('--status-success-text: var(--color-success)');
    expect(tokens).toContain('--status-warning-text: var(--color-warning)');
    expect(tokens).toContain('--status-danger-text: var(--color-danger)');
    expect(tokens).toContain('--status-info-text: var(--color-info)');
  });

  it('scopes reusable contracts to the authenticated app shell', () => {
    expect(design).toContain('.app-shell .ds-button');
    expect(design).toContain('.app-shell .ds-field');
    expect(design).toContain('.app-shell .ds-dialog');
    expect(design).toContain('.app-shell .ds-status');
    expect(design).toContain('.app-shell .ds-toast');
    expect(design).toContain('.app-shell .ds-table-wrap');
    expect(design).toContain('.app-shell .ds-mobile-card');
    expect(design).toContain('.app-shell .bottom-navigation');
    expect(design).toContain('.app-shell .ds-state--loading');
    expect(design).toContain('.app-shell .ds-state--empty');
    expect(design).toContain('.app-shell .ds-state--error');
    expect(design).toContain('.app-shell .ds-state--success');
    expect(design).toContain('aria-busy="true"');
    expect(design).toContain('aria-invalid="true"');
    expect(design).toContain(':focus-visible');
    expect(design).not.toMatch(/(^|\n)\s*(body|html|:root|\.login|\.landing|\.public)/);
  });

  it('keeps existing table loading/error/mobile semantics and retry surface', () => {
    expect(responsiveTable).toContain('aria-busy={loading || undefined}');
    expect(responsiveTable).toContain('role={error ? \'alert\' : \'status\'}');
    expect(responsiveTable).toContain('DataTableStateVariant');
    expect(responsiveTable).toContain('action?: { label: string; onClick(): void }');
  });

  it('does not import or override public ownership from the internal layer', () => {
    expect(main).toContain("import './design-system.css';");
    expect(design).not.toMatch(/command-nexus|ux-t06-login-public|AwardPublicExperience/);
    expect(design).not.toMatch(/(^|\n)\s*(body|html|:root|\.login|\.landing|\.public)\b/);
    for (const file of publicOwnedFiles) {
      const absolute = path.join(root, file);
      if (fs.existsSync(absolute)) expect(design).not.toContain(`import './${path.basename(file)}'`);
    }
  });

  it('keeps the public-owned files independent of the internal design system', () => {
    // Originally a git-diff freeze against 7b38f0c; public pages now evolve on their own (one-screen landing),
    // so the contract is expressed as ownership: public files never import the internal layer, and the
    // internal layer never styles public files.
    for (const file of publicOwnedFiles) {
      const source = fs.readFileSync(path.join(root, file), 'utf8');
      expect(source, file).not.toMatch(/design-system\.css|ui-primitives\.css|components\/ui\/primitives/);
    }
    for (const internal of ['design-system.css', 'styles/ui-primitives.css']) {
      const source = fs.readFileSync(path.join(root, internal), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
      expect(source, internal).not.toMatch(/nexus-public|nexus-onescreen|award-auth-page|login-page/);
    }
  });
});
