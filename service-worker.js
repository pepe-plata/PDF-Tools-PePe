const CACHE = 'pdf-tools-pepe-v012';
const APP = [
  './',
  './index.html',
  './manifest.json',
  './service-worker.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];
const CDN = [
  'https://unpkg.com/pdf-lib@1.17.1/dist/pdf-lib.min.js',
  'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.mjs',
  'https://unpkg.com/pdfjs-dist@5.4.624/legacy/build/pdf.worker.mjs',
  'https://unpkg.com/jszip@3.10.1/dist/jszip.min.js'
];
// Coincidencia por prefijo: sobrevive a redirecciones, query strings y barras finales.
const CDN_PREFIX = [
  'https://unpkg.com/pdf-lib@1.17.1/',
  'https://unpkg.com/pdfjs-dist@5.4.624/',
  'https://unpkg.com/jszip@3.10.1/'
];
const isCdn = u => CDN.includes(u) || CDN_PREFIX.some(p => u.startsWith(p));

async function cacheUrl(cache, url) {
  try {
    const r = await fetch(url, { cache: 'no-store', mode: 'cors', credentials: 'omit' });
    if (r && r.ok) { await cache.put(url, r.clone()); return true; }
  } catch (e) {}
  return false;
}

self.addEventListener('install', e => e.waitUntil((async () => {
  const c = await caches.open(CACHE);
  await Promise.allSettled(APP.map(u => c.add(u)));
  await Promise.allSettled(CDN.map(u => cacheUrl(c, u)));
  await self.skipWaiting();
})()));

self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('message', e => {
  if (e.data?.type === 'ENSURE_LIBS') e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    const result = {};
    for (const u of CDN) result[u] = !!(await c.match(u)) || await cacheUrl(c, u);
    e.source?.postMessage({ type: 'LIBS_READY', result });
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (req.headers.has('range')) return;              // deja pasar los Range a la red

  let u; try { u = new URL(req.url); } catch (_) { return; }
  const app = u.origin === location.origin;
  if (!app && !isCdn(req.url)) return;

  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const hit = await c.match(req);
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r && r.ok && r.type !== 'opaque') {
        try { await c.put(req, r.clone()); } catch (_) {}
      }
      return r;
    } catch (err) {
      if (app) {
        const fb = (await c.match('./index.html')) || (await c.match('./'));
        if (fb) return fb;
      }
      throw err;
    }
  })());
});