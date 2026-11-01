// Serves looks you load from a zip as if they were on the website. Each load gets its own
// address (uploads/<n>/sets/<look>/...), so the browser never mixes it up with an earlier
// copy; files the zip doesn't have (the shared code in sets/_core/) come from the website's
// templates/. Nothing leaves your browser: the files are kept in this browser's cache only.
const CACHE = 'uploaded-looks';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const m = /^(.*\/)uploads\/[^/]+\/(.*)$/.exec(url.pathname);
  if (event.request.method !== 'GET' || !m) return;
  event.respondWith((async () => {
    const hit = await (await caches.open(CACHE)).match(url.origin + url.pathname);
    return hit || fetch(`${url.origin}${m[1]}templates/${m[2]}`);
  })());
});
