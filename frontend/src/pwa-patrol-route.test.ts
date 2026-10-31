import { describe, expect, it } from 'vitest';
import { pageFromLocation } from './routing';

describe('routing PWA patrol page', () => {
  it('resolves patrol page when pwa=1 and page=patrol', () => {
    const loc = { pathname: '/app', search: '?pwa=1&page=patrol' };
    const res = pageFromLocation(loc);
    expect(res).toEqual({ kind: 'page', page: 'patrol' });
  });

  it('resolves attendance page when pwa=1 and page is unknown', () => {
    const loc = { pathname: '/app', search: '?pwa=1&page=unknown' };
    const res = pageFromLocation(loc);
    expect(res).toEqual({ kind: 'page', page: 'attendance' });
  });
});
