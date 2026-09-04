// __VERSION__ lo sustituye scripts/version-sw.mjs sobre la copia de out/ al
// desplegar. Antes este nombre estaba fijo a mano ('...-v3'), así que este
// archivo era idéntico byte a byte en todos los despliegues: el navegador solo
// instala un Service Worker nuevo si el archivo cambió, de modo que nunca se
// instalaba ninguno y la app seguía sirviendo código viejo hasta que alguien
// hacía Ctrl+F5. Con la versión dentro, cada despliegue es un archivo distinto.
//
// El `activate` de abajo borra cualquier caché con nombre distinto a este, así
// que cambiar de versión purga de paso lo que quedó del build anterior.
const CACHE_NAME = 'sellalles-cache-__VERSION__';

// Las imágenes de Storage viven en una caché aparte y SIN la versión en el
// nombre, a propósito: el `activate` de abajo borra toda caché que no sea la
// del build actual, así que meterlas ahí significaría volver a descargar el
// catálogo entero en cada despliegue — justo el gasto de transferencia que
// esto viene a eliminar. El contenido es inmutable (cada URL lleva un UUID
// nuevo), de modo que conservarla entre versiones es seguro.
const IMAGE_CACHE_NAME = 'sellalles-images-v1';

// Tope de fotos guardadas por dispositivo. A ~18 kB la miniatura y ~120 kB la
// imagen grande, 400 entradas son unos pocos MB: suficiente para el catálogo
// de una caja sin llenarle el disco a una tablet barata.
const IMAGE_CACHE_MAX = 400;
const PRECACHE_ASSETS = [
  '/',
  '/login',
  '/favicon.ico',
  '/manifest.json',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png'
];

// Install Service Worker and cache core shell assets
//
// SIN skipWaiting a propósito: el Service Worker nuevo se queda esperando en
// vez de tomar el control solo. Quien decide cuándo entra es el cajero, desde
// el aviso de "versión nueva" del menú lateral (ver pwa-register.tsx).
// Recargarle la pantalla a alguien a mitad de un cobro es peor que dejarlo un
// rato más con la versión anterior.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[Service Worker] Pre-caching static app shell');
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
});

// La app pide el relevo cuando el usuario acepta actualizar. Al activarse este
// Service Worker cambia el controller de la pestaña, y pwa-register.tsx recarga.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

// Activate Service Worker and clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME && cacheName !== IMAGE_CACHE_NAME) {
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

  // 0. Imágenes públicas de Storage - CACHE FIRST, PERMANENTE
  //
  // Tiene que ir ANTES del bypass de supabase.co de abajo: esa regla existe
  // para no cachear auth ni consultas, pero arrastraba también a las fotos de
  // producto, que son lo contrario — contenido inmutable que se repite decenas
  // de veces al día. En producción se midió la misma foto descargada 39 veces
  // en 24 horas por este motivo.
  //
  // Cache-first sin revalidar es correcto aquí porque la URL lleva un UUID
  // irrepetible: si la foto cambia, cambia la URL. Nunca se sirve una imagen
  // vieja bajo una URL nueva.
  if (requestUrl.pathname.startsWith('/storage/v1/object/public/')) {
    event.respondWith(
      caches.open(IMAGE_CACHE_NAME).then((cache) =>
        cache.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;

          return fetch(event.request).then((networkResponse) => {
            // Las <img> se piden sin crossorigin, así que la respuesta es
            // opaca (type 'opaque', status 0): no se puede inspeccionar, pero
            // sí guardar y servir. Por eso no vale el `status !== 200` que usan
            // las otras reglas — descartaría todas las fotos.
            const utilizable =
              networkResponse &&
              (networkResponse.ok || networkResponse.type === 'opaque');
            if (utilizable) {
              cache
                .put(event.request, networkResponse.clone())
                .then(() => podarCacheImagenes())
                .catch(() => {/* sin espacio: se sirve igual, solo no se cachea */});
            }
            return networkResponse;
          });
        })
      )
    );
    return;
  }

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

/**
 * Mantiene la caché de imágenes por debajo de IMAGE_CACHE_MAX.
 *
 * `cache.keys()` devuelve las entradas en orden de inserción, así que borrar
 * desde el principio descarta lo más antiguo. Es una aproximación pobre a LRU
 * — no distingue lo más usado de lo más viejo — pero no requiere llevar
 * metadatos aparte y para un catálogo que cambia poco basta de sobra.
 */
function podarCacheImagenes() {
  return caches.open(IMAGE_CACHE_NAME).then((cache) =>
    cache.keys().then((claves) => {
      const sobran = claves.length - IMAGE_CACHE_MAX;
      if (sobran <= 0) return;
      return Promise.all(claves.slice(0, sobran).map((clave) => cache.delete(clave)));
    })
  );
}
