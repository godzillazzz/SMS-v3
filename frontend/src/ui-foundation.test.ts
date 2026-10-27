import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ACCENT_OPTIONS, applyAccent, normalizeAccent, persistAccent, readAccent } from './accent';
import { statusBadgeTone } from './components/ui/primitives';

const css = ['styles/ui-primitives.css', 'styles/ui-accent.css'].map((file) => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');

describe('SMSv3 UI foundation on the corporate tokens', () => {
  it('keeps every primitives selector inside the authenticated app shell', () => {
    const selectors = css.replace(/\/\*[\s\S]*?\*\//g, '').split('}').map((rule) => rule.split('{').slice(-2)[0].trim()).filter(Boolean);
    for (const selector of selectors) expect(selector, selector).toMatch(/\.app-shell/);
    expect(css).not.toMatch(/(^|[\s,]):root|(^|[\s,])body\b|login|nexus-public/);
  });

  it('resolves through existing semantic tokens instead of a second palette', () => {
    expect(css).not.toMatch(/var\(--ds-/);
    expect(css).toContain('var(--color-primary)');
  });

  it('offers the owner-approved five primary palettes and falls back safely', () => {
    expect(ACCENT_OPTIONS.map((option) => option.value)).toEqual(['teal', 'indigo', 'navy', 'emerald', 'plum']);
    expect(normalizeAccent('pink')).toBe('teal');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    persistAccent('teal', storage);
    expect(readAccent(storage)).toBe('teal');
    const shell = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyAccent('emerald', shell);
    expect(shell.dataset.accent).toBe('emerald');
    applyAccent('navy', shell);
    expect(shell.dataset.accent).toBe('navy');
  });

  it('keeps the Sidebar collapse control in the footer with a readable label', () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.tsx'), 'utf8');
    const footer = main.slice(main.indexOf('<div className="sidebar-footer">'), main.indexOf('</div>', main.indexOf('<div className="sidebar-footer">')) + 6);
    expect(footer).toContain('sidebar-collapse-toggle');
    expect(footer).toContain("sidebarCollapsed ? 'ขยายเมนู' : 'ย่อเมนู'");
    expect(footer).toContain('<span>{sidebarCollapsed ? \'ขยายเมนู\' : \'ย่อเมนู\'}</span>');
    const shell = fs.readFileSync(path.join(__dirname, 'styles/hrpro-shell.css'), 'utf8');
    expect(shell).toContain('#sms-app .sidebar-footer .sidebar-collapse-toggle');
    expect(shell).not.toContain('#sms-app .sidebar-collapse-toggle { display: none; }');
  });

  it('maps business statuses to badge tones without changing their values', () => {
    expect(statusBadgeTone('APPROVED')).toBe('success');
    expect(statusBadgeTone('pending')).toBe('warning');
    expect(statusBadgeTone('REJECTED')).toBe('danger');
    expect(statusBadgeTone('ADMIN')).toBe('violet');
    expect(statusBadgeTone('anything-else')).toBe('neutral');
  });
});
