/* Registro pagamenti — service worker: l'app si apre anche senza connessione */
const CACHE = 'registro-pagamenti-21f4d0e8';
const FILE = ['./', 'index.html', 'style.css?v=21f4d0e8', 'core.js?v=21f4d0e8', 'app.js?v=21f4d0e8', 'manifest.webmanifest', 'qrcode.js', 'icone/icona-192.png', 'icone/icona-512.png', 'icone/icona-maskable-512.png'];
const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILE)));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('registro-pagamenti-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', (e) => { if (e.data === 'aggiorna') self.skipWaiting(); });
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // il lettore Excel: dalla rete la prima volta, poi dalla cache
  if (req.url === EXCELJS) {
    e.respondWith(caches.open(CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; }))));
    return;
  }
  if (url.origin !== location.origin) return; // il Foglio Google va sempre in rete
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).catch(() => caches.match('index.html')));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
