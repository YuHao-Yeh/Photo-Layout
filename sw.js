// Network-first service worker: always serves the latest version when online,
// falls back to the cached copy so the app also works offline.
const CACHE = 'photo-layout-v13';
const ASSETS = [
  './',
  'index.html',
  'css/app.css',
  'css/themes.css',
  'img/theme-sky.svg',
  'img/theme-wave.svg',
  'img/theme-candy.svg',
  'img/theme-tiles.svg',
  'js/app.js',
  'js/layout.js',
  'js/render.js',
  'js/pdf.js',
  'js/i18n.js',
  'js/adjust.js',
  'js/theme-boot.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    fetch(request)
      .then((response) => {
        // Only keep successful responses from this site in the offline cache.
        if (response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request, { ignoreSearch: true })),
  );
});
