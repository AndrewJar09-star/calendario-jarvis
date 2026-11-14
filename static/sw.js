/* ================================================================
   S.T.E.W.A.R.D. OS — Service Worker v1.0
   Strategia: Network-first con cache fallback per offline
   ================================================================ */

const CACHE_NAME = 'steward-os-v10';
const STATIC_CACHE = 'steward-static-v10';

// Assets essenziali da precacherizzare
const PRECACHE_ASSETS = [
  '/',
  '/static/index.html',
  '/static/style.css?v=2.10.0',
  '/static/app.js?v=2.10.0',
  '/static/manifest.json',
  '/static/icons/icon-192.png',
  '/static/icons/icon-512.png',
  '/static/icons/jarvis-reactor.png',
  '/static/favicon.ico',
];

// Risorse esterne (CDN) da cacherizzare al volo
const CDN_HOSTS = [
  'cdn.jsdelivr.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// API che NON devono essere cacheizzate (sempre fresh)
const API_PATHS = ['/api/sync', '/api/events', '/api/alerts', '/api/calendar.ics', '/api/google-script', '/api/jarvis'];

// ─── Install ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      return Promise.all(
        PRECACHE_ASSETS.map((asset) => {
          return fetch(asset, { cache: 'reload' })
            .then((response) => {
              if (response.ok) return cache.put(asset, response);
            })
            .catch((err) => console.warn('Precache saltato per:', asset, err));
        })
      );
    })
  );
});

// ─── Activate (cleanup old caches) ─────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== STATIC_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch Strategy ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET
  if (event.request.method !== 'GET') return;

  // ① API calls → Network only (mai cache)
  if (API_PATHS.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(fetch(event.request));
    return;
  }

  // ② CDN resources → Cache first, poi network
  if (CDN_HOSTS.includes(url.hostname)) {
    event.respondWith(
      caches.match(event.request).then((cached) => {
        if (cached) return cached;
        return fetch(event.request).then((response) => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // ③ Static assets & pages → Network-first, fallback cache
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ─── Background Sync (futuro) ───────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-events') {
    event.waitUntil(
      fetch('/api/sync', { method: 'POST' }).catch(() => {
        // Riprova al prossimo avvio
      })
    );
  }
});

// ─── Push Notifications (futuro) ────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'S.T.E.W.A.R.D. OS', {
      body: data.body || 'Nuovo aggiornamento disponibile',
      icon: '/static/icons/icon-192.png',
      badge: '/static/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data: data,
      actions: [
        { action: 'open',   title: 'Apri' },
        { action: 'close',  title: 'Chiudi' },
      ]
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.action === 'open' || !event.action) {
    event.waitUntil(clients.openWindow('/'));
  }
});
