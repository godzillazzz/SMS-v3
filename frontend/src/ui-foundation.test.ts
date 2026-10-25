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

  it('offers navy as default plus three accent hues and falls back safely', () => {
    expect(ACCENT_OPTIONS.map((option) => option.value)).toEqual(['navy', 'teal', 'emerald']);
    expect(normalizeAccent('pink')).toBe('navy');
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    persistAccent('teal', storage);
    expect(readAccent(storage)).toBe('teal');
    const shell = { dataset: {} as Record<string, string> } as unknown as HTMLElement;
    applyAccent('emerald', shell);
    expect(shell.dataset.accent).toBe('emerald');
    applyAccent('navy', shell);
    expect(shell.dataset.accent).toBeUndefined();
  });

  it('maps business statuses to badge tones without changing their values', () => {
    expect(statusBadgeTone('APPROVED')).toBe('success');
    expect(statusBadgeTone('pending')).toBe('warning');
    expect(statusBadgeTone('REJECTED')).toBe('danger');
    expect(statusBadgeTone('ADMIN')).toBe('violet');
    expect(statusBadgeTone('anything-else')).toBe('neutral');
  });
});
