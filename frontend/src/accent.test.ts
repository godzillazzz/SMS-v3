import { describe, expect, it } from 'vitest';
import {
  BUILTIN_ACCENT_OPTIONS,
  DEFAULT_ACCENT,
  getAllAccentOptions,
  normalizeAccent,
  readAccent
} from './accent';

describe('accent and custom sidebar options', () => {
  it('returns builtin options when no custom sidebar options exist', () => {
    expect(getAllAccentOptions()).toEqual(BUILTIN_ACCENT_OPTIONS);
    expect(getAllAccentOptions([])).toEqual(BUILTIN_ACCENT_OPTIONS);
  });

  it('maps custom sidebar options to accent options', () => {
    const custom = [
      { id: 'custom-1', label: 'Dark Navy', color: '#102a43' },
      { id: 'custom-2', label: 'Forest Green', color: '#0b3d2e' }
    ];
    const options = getAllAccentOptions(custom);
    expect(options).toHaveLength(2);
    expect(options[0]).toEqual({ value: 'custom-1', label: 'Dark Navy', swatch: '#102a43' });
  });

  it('normalizes invalid or removed accent to default option', () => {
    const custom = [
      { id: 'custom-1', label: 'Dark Navy', color: '#102a43' },
      { id: 'custom-2', label: 'Forest Green', color: '#0b3d2e' }
    ];
    const options = getAllAccentOptions(custom);
    expect(normalizeAccent('custom-1', options)).toBe('custom-1');
    expect(normalizeAccent('non-existent', options)).toBe('custom-1');
  });

  it('resets deleted accent from storage back to default option', () => {
    const store: Record<string, string> = { 'sms-v3-accent': 'deleted-color' };
    const mockStorage = {
      getItem: (k: string) => store[k] || null,
      setItem: (k: string, v: string) => { store[k] = v; }
    };
    const custom = [
      { id: 'custom-1', label: 'Dark Navy', color: '#102a43' }
    ];
    const options = getAllAccentOptions(custom);
    const result = readAccent(mockStorage, options);
    expect(result).toBe('custom-1');
    expect(store['sms-v3-accent']).toBe('custom-1');
  });
});
