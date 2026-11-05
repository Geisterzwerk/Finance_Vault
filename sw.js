// Service Worker – Offline-Fähigkeit. Nach jeder Änderung VERSION erhöhen!
const VERSION = 'fv-v1.1.0';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/vault.js', './js/store.js', './js/calc.js', './js/prices.js', './js/importer.js', './js/bingx.js',
  './js/ui.js', './js/views-main.js', './js/views-more.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSION).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // Kurs-APIs nie cachen
  e.respondWith(fetch(e.request).then((res) => { const c = res.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});
