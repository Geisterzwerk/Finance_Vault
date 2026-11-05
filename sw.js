// Service Worker – Offline-Fähigkeit. Nach jeder Änderung VERSION erhöhen!
const VERSION = 'fv-v2.2.0';
const LIBS = 'fv-libs-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/vault.js', './js/store.js', './js/calc.js', './js/prices.js', './js/importer.js', './js/bingx.js',
  './js/ui.js', './js/views-main.js', './js/views-more.js', './js/views-docs.js', './js/scan.js', './js/ledger.js', './js/taxpack.js', './js/libs.js', './js/server.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];
const LIB_HOSTS = ['cdn.jsdelivr.net', 'cdnjs.cloudflare.com', 'tessdata.projectnaptha.com'];

self.addEventListener('install', (e) => e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((k) => Promise.all(k.filter((x) => x !== VERSION && x !== LIBS).map((x) => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  // Bibliotheken (OCR, QR, PDF): einmal laden, dann offline aus dem Cache
  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith(caches.open(LIBS).then((c) => c.match(e.request).then((hit) => hit || fetch(e.request).then((res) => { if (res.ok) c.put(e.request, res.clone()); return res; }))));
    return;
  }
  if (url.origin !== location.origin) return; // Kurs- und Ledger-APIs nie cachen
  e.respondWith(fetch(e.request).then((res) => { const c = res.clone(); caches.open(VERSION).then((x) => x.put(e.request, c)); return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('./index.html'))));
});

// Push-Mitteilungen vom eigenen Server
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Finance Vault', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Finance Vault', { body: d.body || '', tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' } }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
    for (const c of cl) { if ('focus' in c) { c.navigate(url).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
