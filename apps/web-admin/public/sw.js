// Clary Admin — minimal service worker (static asset caching only)
const CACHE = 'clary-admin-v1';
const PRECACHE = ['/', '/manifest.webmanifest', '/logo.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE).catch(() => undefined)).then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  const isStatic = /\.(?:js|css|svg|png|jpg|jpeg|webp|ico|woff2?)$/i.test(url.pathname) || url.pathname.startsWith('/assets/');
  if (!isStatic) return;
  event.respondWith(
    caches.match(req).then((c) => c || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((cc) => cc.put(req, copy).catch(() => undefined));
      return res;
    })),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
