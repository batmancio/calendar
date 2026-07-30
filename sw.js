/**
 * Chronos/Planner - Service Worker
 * Cache-first per lo shell dell'app (funzionamento offline), passthrough
 * completo per /api/* e per richieste cross-origin (es. Google Fonts).
 */

const CACHE_NAME = 'planner-shell-v2';

const PRECACHE_URLS = [
  './',
  './index.html',
  './style.css',
  './js/app.js',
  './js/calendar.js',
  './js/modal.js',
  './js/state.js',
  './js/tasks.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return Promise.all(
          PRECACHE_URLS.map(url => {
            return cache.add(url).catch(err => console.warn('Precaching skipped for:', url, err));
          })
        );
      })
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes('/api/')) return;

  event.respondWith(
    caches.match(req).then(cached => {
      if (cached) return cached;
      return fetch(req).then(response => {
        if (response && response.status === 200 && response.type === 'basic') {
          const responseToCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(req, responseToCache));
        }
        return response;
      });
    }).catch(() => caches.match('./index.html'))
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./');
    })
  );
});
