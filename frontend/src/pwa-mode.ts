export type SmsPwaPage = 'attendance' | 'leave' | 'profile';

export const SMS_PWA_PAGES: SmsPwaPage[] = ['attendance', 'leave', 'profile'];

function queryValue(name: string) {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

export function isSmsPwaShellMode() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const displayStandalone = typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches;
  return queryValue('pwa') === '1' || iosStandalone || displayStandalone;
}

export function initialSmsPwaPage(): SmsPwaPage {
  const requested = queryValue('page');
  return SMS_PWA_PAGES.includes(requested as SmsPwaPage) ? requested as SmsPwaPage : 'attendance';
}

export function isSmsPwaPage(value: string): value is SmsPwaPage {
  return SMS_PWA_PAGES.includes(value as SmsPwaPage);
}
