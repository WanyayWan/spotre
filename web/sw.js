// Hum service worker: app shell caching, artwork caching, and offline audio
// (served with byte-range support so iOS Safari can play it).
const VERSION = 'hum-v1';
const SHELL = `shell-${VERSION}`;
const ART = 'hum-art-v1';
const AUDIO = 'hum-audio-v1';
const SHELL_FILES = [
  '/', '/index.html', '/manifest.webmanifest', '/css/app.css',
  '/js/app.js', '/js/api.js', '/js/md5.js', '/js/player.js', '/js/offline.js', '/js/ui.js', '/js/views.js', '/js/nowplaying.js',
  '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});

async function rangeResponse(request, cached) {
  const range = request.headers.get('range');
  const blob = await cached.blob();
  const type = cached.headers.get('content-type') || 'audio/mpeg';
  if (!range) {
    return new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size), 'Accept-Ranges': 'bytes' } });
  }
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = m && m[1] ? Number(m[1]) : 0;
  let end = m && m[2] ? Number(m[2]) : blob.size - 1;
  if (m && !m[1] && m[2]) { start = blob.size - Number(m[2]); end = blob.size - 1; }
  end = Math.min(end, blob.size - 1);
  if (start >= blob.size || start > end) {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${blob.size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': type, 'Content-Length': String(end - start + 1),
      'Content-Range': `bytes ${start}-${end}/${blob.size}`, 'Accept-Ranges': 'bytes',
    },
  });
}

// Cover art URLs carry auth params; key the cache on id+size only.
const artKey = (url) => `${url.origin}/__art/${url.searchParams.get('id')}/${url.searchParams.get('size') || ''}`;

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;

  if (url.pathname.startsWith('/offline-audio/')) {
    e.respondWith((async () => {
      const cache = await caches.open(AUDIO);
      const hit = await cache.match(url.origin + url.pathname);
      return hit ? rangeResponse(e.request, hit) : new Response('Not downloaded', { status: 404 });
    })());
    return;
  }

  if (url.pathname.startsWith('/rest/getCoverArt')) {
    e.respondWith((async () => {
      const cache = await caches.open(ART);
      const key = artKey(url);
      const hit = await cache.match(key);
      if (hit) return hit;
      try {
        const res = await fetch(e.request);
        if (res.ok) cache.put(key, res.clone());
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  if (url.pathname.startsWith('/rest/') || url.pathname.startsWith('/api/')) return;

  // App shell: network first (so updates land), falling back to cache offline.
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(SHELL)).put(e.request, res.clone());
      return res;
    } catch {
      const cache = await caches.open(SHELL);
      return (await cache.match(e.request)) || (e.request.mode === 'navigate' ? cache.match('/index.html') : Response.error());
    }
  })());
});
