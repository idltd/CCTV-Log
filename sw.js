// Service Worker — cache-first strategy, offline capable
const CACHE = 'cctv-sar-v3';

const PRECACHE = [
    './',
    './index.html',
    './manifest.json',
    './css/style.css',
    './js/app.js',
    './js/camera.js',
    './js/location.js',
    './js/registry.js',
    './js/sar.js',
    './js/storage.js',
    './js/log.js',
    './js/contacts.js',
    './assets/icons/icon-192.svg',
    './assets/icons/icon-512.svg',
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE).then(c => c.addAll(PRECACHE))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

const PRECACHE_URLS = new Set(PRECACHE.map(p => new URL(p, self.location).href));

self.addEventListener('fetch', (e) => {
    // Let external API calls (Nominatim, Supabase) go through normally
    const url = new URL(e.request.url);
    if (url.origin !== location.origin) return;

    // Network-first: always fetch from server so updates reach users immediately.
    // Only cache known app assets (PRECACHE list) — prevents cache poisoning.
    // Cache is used only as offline fallback.
    e.respondWith(
        fetch(e.request).then(resp => {
            if (e.request.method === 'GET' && resp.status === 200
                    && PRECACHE_URLS.has(url.href)) {
                const clone = resp.clone();
                caches.open(CACHE).then(c => c.put(e.request, clone));
            }
            return resp;
        }).catch(() =>
            caches.match(e.request).then(cached => {
                if (cached) return cached;
                if (e.request.mode === 'navigate') return caches.match('./index.html');
            })
        )
    );
});
