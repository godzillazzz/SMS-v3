export function registerSmsPwa() {
  if (typeof window === 'undefined' || !window.isSecureContext || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => registration.update())
      .catch(() => undefined);
  }, { once: true });
}
