/* QuickLimes v2 — service worker (installable PWA + offline shell).
   Local-first app: data lives in localStorage, so once the CSS/JS shell is cached
   the app opens offline. Never caches the /api backend or cross-origin requests. */
const CACHE = 'ql-v2-cache-287';   // four independent sources: no invented payments/outstanding

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', e => e.waitUntil((async () => {
  const keys = await caches.keys();
  await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
  await self.clients.claim();
})()));

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  if (url.origin !== self.location.origin) return;              // fonts, supabase, anything cross-origin → untouched
  if (/\/api\//.test(url.pathname) || url.pathname.endsWith('.php')) return;   // never cache the backend

  const isNav = req.mode === 'navigate' || (req.headers.get('accept') || '').includes('text/html');
  if (isNav) {
    // Pages: network-first (always fresh), fall back to cache when offline.
    e.respondWith((async () => {
      try {
        const net = await fetch(req);
        const c = await caches.open(CACHE); c.put(req, net.clone());
        return net;
      } catch (_) {
        return (await caches.match(req)) || (await caches.match('/v2/dashboard.html')) || Response.error();
      }
    })());
    return;
  }

  // Static assets (CSS/JS/PNG/SVG): stale-while-revalidate.
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const network = fetch(req).then(net => {
      if (net && net.ok) caches.open(CACHE).then(c => c.put(req, net.clone()));
      return net;
    }).catch(() => null);
    return cached || (await network) || Response.error();
  })());
});
