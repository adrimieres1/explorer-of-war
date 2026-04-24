// Explorer of War — Service Worker
// Permite funcionamiento offline y en segundo plano

const CACHE_NAME = 'eow-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/app.js',
  '/manifest.json',
  'https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Orbitron:wght@400;700&display=swap'
];

// Instalación: cachear assets estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS.filter(u => !u.startsWith('http')));
    })
  );
  self.skipWaiting();
});

// Activación: limpiar caches viejas
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: cache-first para assets propios, network-first para tiles OSM
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Tiles de OpenStreetMap: cache con expiración implícita
  if (url.includes('tile.openstreetmap.org')) {
    event.respondWith(
      caches.open(CACHE_NAME + '-tiles').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
        })
      )
    );
    return;
  }

  // Fuentes de Google: cache
  if (url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME + '-fonts').then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            cache.put(event.request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Assets propios: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});

// Sincronización en segundo plano (Background Sync API)
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trail') {
    // El guardado ya es local, este hook está disponible para futuras features
    event.waitUntil(Promise.resolve());
  }
});

// Mantener el SW activo con un ping periódico desde la app
self.addEventListener('message', event => {
  if (event.data === 'ping') {
    event.ports[0].postMessage('pong');
  }
});
