// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canViewRoutePage,
  navigate,
  pageFromLocation,
  pageFromPath,
  PAGE_PATHS,
  pageTitle,
  routeQueryMonth,
  routeQueryNumber,
  ROUTE_CHANGE_EVENT,
  subscribeToRouteChanges,
  updateDocumentTitle,
  updateRouteQuery
} from './routing';

const originalUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;

afterEach(() => {
  window.history.replaceState({}, '', originalUrl || '/');
  vi.restoreAllMocks();
});

describe('application History API routes', () => {
  it('maps every page to a stable path and back', () => {
    for (const [page, path] of Object.entries(PAGE_PATHS)) {
      expect(pageFromPath(path)).toBe(page);
      expect(pageFromLocation({ pathname: path, search: '' })).toEqual({ kind: 'page', page });
    }
    expect(pageFromPath('/')).toBe('dashboard');
    expect(pageFromPath('/app/leave/history/')).toBe('leaveHistory');
    expect(pageFromPath('/app/not-a-real-page')).toBeNull();
  });

  it('keeps a deep-link path and query through the login boundary until navigation occurs', () => {
    window.history.replaceState({}, '', '/app/roster?month=2026-10&department=AN1&page=2');
    const initial = pageFromLocation();
    expect(initial).toEqual({ kind: 'page', page: 'schedule' });
    // Login does not rewrite location; after authentication Dashboard resolves the same URL.
    expect(window.location.pathname + window.location.search).toBe('/app/roster?month=2026-10&department=AN1&page=2');
    expect(pageFromLocation()).toEqual(initial);
  });

  it('pushes route changes, preserves query state, and responds to browser popstate', () => {
    window.history.replaceState({ fixture: true }, '', '/app/leave/history?month=2026-10&status=PENDING');
    const onRouteChange = vi.fn();
    const unsubscribe = subscribeToRouteChanges(onRouteChange);

    const target = navigate('approvalCenter');
    expect(target.pathname).toBe('/app/approvals');
    expect(target.searchParams.get('month')).toBe('2026-10');
    expect(target.searchParams.get('status')).toBe('PENDING');
    expect(window.history.state).toMatchObject({ fixture: true, smsPage: 'approvalCenter' });
    expect(onRouteChange).toHaveBeenCalledTimes(1);

    window.history.replaceState({}, '', '/app/roster?month=2026-11&page=3');
    window.dispatchEvent(new PopStateEvent('popstate'));
    expect(onRouteChange).toHaveBeenCalledTimes(2);
    expect(pageFromLocation()).toEqual({ kind: 'page', page: 'schedule' });
    unsubscribe();
  });

  it('updates query state without dropping other parameters or the current path', () => {
    window.history.replaceState({}, '', '/app/roster?month=2026-10&department=AN1&status=APPROVED');
    updateRouteQuery({ month: '2026-11', page: '2', department: undefined });
    expect(window.location.pathname).toBe('/app/roster');
    expect(new URLSearchParams(window.location.search).get('month')).toBe('2026-11');
    expect(new URLSearchParams(window.location.search).get('page')).toBe('2');
    expect(new URLSearchParams(window.location.search).get('department')).toBeNull();
    expect(new URLSearchParams(window.location.search).get('status')).toBe('APPROVED');
    expect(routeQueryMonth()).toBe('2026-11');
    expect(routeQueryNumber('page')).toBe(2);
    expect(routeQueryNumber('missing')).toBe(1);
  });

  it('returns a Thai in-app 404 route for unknown paths and keeps PWA deep links', () => {
    expect(pageFromLocation({ pathname: '/unknown', search: '' })).toEqual({ kind: 'not-found', pathname: '/unknown' });
    expect(pageFromLocation({ pathname: '/', search: '?pwa=1&page=leave' })).toEqual({ kind: 'page', page: 'leave' });
    expect(pageFromLocation({ pathname: '/', search: '?pwa=1&page=unknown' })).toEqual({ kind: 'page', page: 'attendance' });
  });

  it('preserves current route permissions for direct links and displays a route title', () => {
    expect(canViewRoutePage('settings', { user: { role: 'VIEWER' }, isViewingAs: false })).toBe(false);
    expect(canViewRoutePage('settings', { user: { role: 'ADMIN' }, isViewingAs: false })).toBe(true);
    expect(canViewRoutePage('approvalCenter', { user: { role: 'SUPERVISOR' }, isViewingAs: false })).toBe(true);
    expect(canViewRoutePage('approvalCenter', { user: { role: 'ADMIN' }, isViewingAs: true })).toBe(false);
    expect(pageTitle('schedule')).toBe('ตารางกะรายเดือน');

    updateDocumentTitle('schedule');
    expect(document.title).toBe('ตารางกะรายเดือน | SMS-v3');
    updateDocumentTitle(null, 'not-found');
    expect(document.title).toBe('ไม่พบหน้าที่ต้องการ | SMS-v3');
  });

  it('dispatches an app route event only for an application navigation', () => {
    const listener = vi.fn();
    window.addEventListener(ROUTE_CHANGE_EVENT, listener);
    navigate('employees', { replace: true, query: { search: 'S-100' } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/app/employees');
    expect(new URLSearchParams(window.location.search).get('search')).toBe('S-100');
    window.removeEventListener(ROUTE_CHANGE_EVENT, listener);
  });
});
