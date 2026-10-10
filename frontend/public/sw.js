'use strict';

const CACHE_NAME = 'sms-pwa-shell-v4';
const SHELL_URLS = ['/', '/manifest.webmanifest', '/pwa-icon-192.png', '/pwa-icon-512.png', '/brand/sms-logo.webp', '/brand/sms-logo-dark.webp', '/brand/sms-logo-splash.webp', '/brand/sms-logo-splash-dark.webp', '/brand/sms-logo-horizontal.webp', '/brand/sms-logo-horizontal-dark.webp'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_URLS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Attendance/leave/profile data is never cached by the service worker.
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put('/', response.clone()));
          return response;
        })
        .catch(() => caches.match('/').then((cached) => cached || Response.error()))
    );
    return;
  }

  // Manifest metadata must be network-first so installed PWAs receive new shortcuts/theme
  // even when a future release changes the manifest without changing application assets.
  if (url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || Response.error()))
    );
    return;
  }

  const cacheableStatic = url.pathname.startsWith('/assets/')
    || SHELL_URLS.includes(url.pathname)
    || url.pathname === '/pwa-icon-192.png'
    || url.pathname === '/pwa-icon-512.png'
    || url.pathname === '/apple-touch-icon.png';

  if (!cacheableStatic) return;

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request).then((response) => {
        if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
        return response;
      });
      return cached || network;
    })
  );
});
