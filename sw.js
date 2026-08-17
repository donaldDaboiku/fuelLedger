const CACHE_NAME = 'fuelledger-v10';
const APP_SHELL = [
  './index.html',
  './fuelledger.css',
  './fuelledger.js',
  './manifest.json',
  './image/web/icon.svg'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
    ))
  );
  self.clients.claim();
});

function isCacheableRequest(request) {
  const url = new URL(request.url);
  return request.method === 'GET'
    && (url.protocol === 'http:' || url.protocol === 'https:')
    && url.origin === self.location.origin;
}

async function cachePut(request, response) {
  if (!isCacheableRequest(request) || !response || !response.ok) return;
  const cache = await caches.open(CACHE_NAME);
  await cache.put(request, response);
}

self.addEventListener('fetch', event => {
  if (!isCacheableRequest(event.request)) return;

  const url = new URL(event.request.url);
  const isAppDocument = event.request.mode === 'navigate'
    || url.pathname.endsWith('/index.html')
    || url.pathname.endsWith('/');

  event.respondWith((async () => {
    if (isAppDocument) {
      try {
        const networkResponse = await fetch(event.request);
        await cachePut(event.request, networkResponse.clone());
        return networkResponse;
      } catch (_) {
        return (await caches.match('./index.html'))
          || Response.error();
      }
    }

    const cached = await caches.match(event.request);
    if (cached) return cached;

    try {
      const networkResponse = await fetch(event.request);
      await cachePut(event.request, networkResponse.clone());
      return networkResponse;
    } catch (_) {
      return (await caches.match('./index.html'))
        || Response.error();
    }
  })());
});
