// ═══════════════════════════════════════════════════════════
// OtakuReader — service-worker.js
//
// MINIMAL service worker — only caches the app shell.
// NEVER intercepts cross-origin requests (API, CDN, proxies).
// This prevents the "AbortSignal could not be cloned" bug
// and prevents SW from breaking API calls.
// ═══════════════════════════════════════════════════════════

const CACHE_NAME = 'otakureader-v1';

// ── Install: cache the app shell files ──────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll([
        './',
        './index.html',
        './style.css',
        './script.js',
        './config.js',
        './utils/storage.js',
        './utils/api.js',
        './utils/ui.js',
        './sources/mangadex.js',
        './manifest.json',
      ]).catch(() => {})  // silently ignore if some files are missing
    )
  );
  self.skipWaiting();
});

// ── Activate: delete old caches ─────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      caches.keys().then(keys =>
        Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
      ),
    ])
  );
});

// ── Fetch: CRITICAL RULE ────────────────────────────────────
// ONLY handle same-origin requests (the app shell).
// Let ALL cross-origin requests (API, CDN, proxies) pass through.
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);

  // ✅ CRITICAL: Never intercept cross-origin requests
  // This allows MangaDex API + CDN + all proxies to work correctly
  if (url.origin !== self.location.origin) return;

  // Cache-first for same-origin app shell files
  event.respondWith(
    caches.match(event.request).then(cached =>
      cached || fetch(event.request).catch(() =>
        new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
      )
    )
  );
});
