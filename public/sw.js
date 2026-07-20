// Bumpear esta versión purga el caché acumulado del bucket anterior (el
// `activate` de abajo borra cualquier caché con nombre distinto a este). La
// protección real contra builds desincronizados es el listener de
// controllerchange en pwa-register.tsx, que recarga automáticamente cuando
// un Service Worker nuevo toma control de una pestaña ya abierta.
const CACHE_NAME = 'sellalles-cache-v3';
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/favicon.ico',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install Service Worker and cache core shell assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static app shell');
      return cache.addAll(PRECACHE_ASSETS);
    }).then(() => self.skipWaiting())
  );
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log('[Service Worker] Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch handler with custom caching strategies
self.addEventListener('fetch', (event) => {
  const requestUrl = new URL(event.request.url);

  // 1. API and Database requests (Supabase) - NETWORK ONLY
  // Do not intercept or cache authentication or transactional database queries.
  if (
    requestUrl.origin.includes('supabase.co') ||
    requestUrl.pathname.includes('/auth/') ||
    requestUrl.pathname.includes('/rest/')
  ) {
    return; // Let the browser handle these normally
  }

  // 2. Static Assets (Next.js CSS, JS chunks) - CACHE FIRST
  // These files are immutable because they contain build hashes.
  if (
    requestUrl.pathname.startsWith('/_next/static/') ||
    requestUrl.pathname.endsWith('.js') ||
    requestUrl.pathname.endsWith('.css') ||
    requestUrl.pathname.endsWith('.png') ||
    requestUrl.pathname.endsWith('.ico') ||
    requestUrl.pathname.endsWith('.woff2')
  ) {
    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse;
        }

        return fetch(event.request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
            return networkResponse;
          }

          // Clone and cache the resource
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseToCache);
          });

          return networkResponse;
        });
      })
    );
    return;
  }

  // 3. Pages / Navigation - NETWORK FIRST, FALLBACK TO CACHE
  // Try to load newest version from network; if offline, return cached page shell.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).then((networkResponse) => {
        // Cache the updated page shell
        const responseToCache = networkResponse.clone();
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        return networkResponse;
      }).catch(() => {
        // Fallback to cache if network fails (offline)
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) {
            return cachedResponse;
          }
          // If the page is not in cache, fallback to main login page shell
          return caches.match('/login');
        });
      })
    );
  }
});
