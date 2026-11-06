// =====================================================================
// Service Worker – Offline-Fähigkeit und zuverlässige Updates
//
// App-Dateien: «Netz zuerst» ohne HTTP-Cache (immer die neueste Version,
// sobald online). Offline: letzte Version aus dem Cache.
// Bibliotheken unter /vendor/: haben die Version im Pfad -> «Cache zuerst».
// Fremde Hosts (Kurse, Blockchain, eigener Server) werden nie gecacht.
//
// VERSION bei jedem Release erhöhen (dann wird der Offline-Cache sauber neu
// aufgebaut). Updates kommen aber auch ohne Erhöhung an.
// =====================================================================
const VERSION = 'fv-v2.4.2';
const VENDOR = 'fv-vendor-v1';
const FILES = ['./', './index.html', './manifest.webmanifest', './css/style.css',
  './js/app.js', './js/version.js', './js/vault.js', './js/store.js', './js/calc.js', './js/prices.js', './js/importer.js', './js/bingx.js',
  './js/ui.js', './js/views-main.js', './js/views-more.js', './js/views-docs.js', './js/scan.js', './js/scanui.js', './js/ledger.js',
  './js/taxpack.js', './js/libs.js', './js/server.js', './js/estimate.js',
  './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png'];

self.addEventListener('install', (e) => e.waitUntil((async () => {
  const c = await caches.open(VERSION);
  // cache: 'reload' umgeht den HTTP-Cache -> keine alten Dateien im neuen Offline-Cache
  await c.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })));
  await self.skipWaiting();
})()));

self.addEventListener('activate', (e) => e.waitUntil((async () => {
  for (const k of await caches.keys()) if (k !== VERSION && k !== VENDOR) await caches.delete(k);
  await self.clients.claim();
})()));

const timeout = (ms) => new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms));

async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  try {
    // Navigationen: nach 6 s Offline-Version zeigen (schlechtes Netz)
    const net = fetch(req.url, { cache: 'no-store', credentials: 'same-origin' });
    let res = await (req.mode === 'navigate' ? Promise.race([net, timeout(6000)]) : net);
    // Safari lehnt umgeleitete Antworten für Navigationen ab -> saubere Kopie
    if (res.redirected) res = new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    if (req.mode === 'navigate') { const idx = await cache.match('./index.html'); if (idx) return idx; }
    throw err;
  }
}

async function cacheFirst(req) {
  const cache = await caches.open(VENDOR);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // Kurs-, Ledger- und Server-APIs nie cachen
  if (url.pathname.includes('/vendor/')) { e.respondWith(cacheFirst(req)); return; }
  e.respondWith(networkFirst(req));
});

// Push-Mitteilungen vom eigenen Server (Texte enthalten nie Beträge)
self.addEventListener('push', (e) => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'Finance Vault', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(String(d.title || 'Finance Vault').slice(0, 80), {
    body: String(d.body || '').slice(0, 200), tag: d.tag, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  // Nur Ziele innerhalb der App öffnen (kein Sprung auf fremde Seiten)
  let url = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) url = new URL('./', self.registration.scope);
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cl) => {
    for (const c of cl) { if ('focus' in c) { c.navigate(url.href).catch(() => {}); return c.focus(); } }
    return self.clients.openWindow(url.href);
  }));
});
