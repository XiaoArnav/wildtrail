// Caches the app shell and the AI library so WildTrail works offline.
// (The model files themselves are cached by transformers.js in the browser's Cache Storage.)
const CACHE = 'wildtrail-v20';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.json', 'icon.svg'];
const EXTERNAL_ASSETS = [
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  'https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  'https://cdn.jsdelivr.net/npm/pmtiles@3.0.7/dist/pmtiles.js'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(async c => {
      await c.addAll(SHELL);
      for (const asset of EXTERNAL_ASSETS) {
        try {
          const res = await fetch(asset);
          if (res.ok) await c.put(asset, res);
        } catch (_) {}
      }
    }).then(() => self.skipWaiting())
  );
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  const mine = url.origin === location.origin;
  const lib = url.hostname === 'cdn.jsdelivr.net';
  if (e.request.method !== 'GET' || !(mine || lib)) return;
  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return res;
    }))
  );
});
