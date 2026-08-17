import { describe, expect, it } from 'vitest';
import {
  THEME_STORAGE_KEY,
  applyThemePreference,
  normalizeThemePreference,
  persistThemePreference,
  readThemePreference,
  resolveThemePreference
} from './theme';

describe('G04.2 UX-01 theme engine', () => {
  it('defaults invalid or absent preferences to system and resolves from OS preference', () => {
    expect(normalizeThemePreference(undefined)).toBe('system');
    expect(normalizeThemePreference('unexpected')).toBe('system');
    expect(resolveThemePreference('system', false)).toBe('light');
    expect(resolveThemePreference('system', true)).toBe('dark');
  });

  it('honors explicit light and dark preferences regardless of system preference', () => {
    expect(resolveThemePreference('light', true)).toBe('light');
    expect(resolveThemePreference('dark', false)).toBe('dark');
  });

  it('persists and reads the frontend-only preference using the stable storage key', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); }
    };
    persistThemePreference('dark', storage);
    expect(values.get(THEME_STORAGE_KEY)).toBe('dark');
    expect(readThemePreference(storage)).toBe('dark');
  });

  it('applies theme datasets without replacing unrelated application state', () => {
    const root = { dataset: { route: 'dashboard', modal: 'closed' } } as unknown as HTMLElement;
    expect(applyThemePreference('dark', root, { matches: false } as MediaQueryList)).toBe('dark');
    expect(root.dataset.theme).toBe('dark');
    expect(root.dataset.themePreference).toBe('dark');
    expect(root.dataset.route).toBe('dashboard');
    expect(root.dataset.modal).toBe('closed');
  });

  it('keeps persistence failure non-fatal', () => {
    const storage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); }
    };
    expect(readThemePreference(storage)).toBe('system');
    expect(() => persistThemePreference('light', storage)).not.toThrow();
  });
});
