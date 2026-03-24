// ═══════════════════════════════════════════════════════════
// OtakuReader — utils/api.js
// All network requests go through RequestManager.
// Handles: timeout, proxy rotation, caching, error classification.
// ═══════════════════════════════════════════════════════════

'use strict';

const apiCache    = {};   // url → parsed JSON
const apiCacheAt  = {};   // url → timestamp

// ── RequestManager ───────────────────────────────────────────────────────────
const RequestManager = (() => {

  // Use Promise.race() for timeout — NEVER pass AbortSignal to fetch().
  // Passing AbortSignal breaks Service Workers (they can't clone the signal).
  function fetchWithRace(url) {
    const fetchP = fetch(url, { mode: 'cors', credentials: 'omit' });
    const timeoutP = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), CONFIG.REQUEST_TIMEOUT_MS)
    );
    return Promise.race([fetchP, timeoutP]);
  }

  // Try direct first, then each proxy in order
  async function request(url) {
    let lastError;
    for (let attempt = 0; attempt <= CONFIG.MAX_RETRIES; attempt++) {
      const proxyFn = CONFIG.PROXIES[Math.min(attempt, CONFIG.PROXIES.length - 1)];
      const reqUrl  = proxyFn(url);
      try {
        // Skip backoff on first attempt or when on local file (no point waiting)
        if (attempt > 0 && window.location.protocol !== 'file:') {
          await sleep(Math.min(500 * Math.pow(2, attempt - 1), 4000));
        }
        const resp = await fetchWithRace(reqUrl);
        if (resp.status === 429) {
          await sleep(2000 * (attempt + 1)); // rate-limited — wait longer
          lastError = new Error('Rate limited (429)');
          continue;
        }
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        return resp;
      } catch (e) {
        lastError = e;
        // "Failed to fetch" = network error → immediately try next proxy
        if (attempt === 0 && e.message && e.message.includes('fetch')) continue;
      }
    }
    throw lastError || new Error('All attempts failed');
  }

  // Fetch JSON with caching and SourceHealth tracking
  async function json(url) {
    // Return cached copy if still fresh
    if (apiCache[url] && Date.now() - apiCacheAt[url] < CONFIG.API_CACHE_TTL_MS) {
      return apiCache[url];
    }
    if (!navigator.onLine) { UI.showOfflineBar(); return null; }

    try {
      const resp = await request(url);
      const data = await resp.json();
      apiCache[url] = data;
      apiCacheAt[url] = Date.now();
      UI.hideOfflineBar();
      SourceHealth.onSuccess('mangadex');
      return data;
    } catch (e) {
      console.warn('[API] Failed:', url.split('?')[0], '—', e.message);
      SourceHealth.onFail('mangadex');
      if (!navigator.onLine || e.message.includes('fetch') || e.message.includes('timeout')) {
        UI.showOfflineBar();
      }
      return null;
    }
  }

  // Fetch an image URL, trying proxies if needed
  async function image(url) {
    for (let i = 0; i < CONFIG.PROXIES.length; i++) {
      try {
        const r = await fetchWithRace(CONFIG.PROXIES[i](url));
        if (r.ok) return CONFIG.PROXIES[i](url);
      } catch (_) {}
    }
    return url; // fallback to original
  }

  // Clear expired cache entries
  function purgeExpired() {
    const now = Date.now();
    Object.keys(apiCache).forEach(k => {
      if (now - apiCacheAt[k] > CONFIG.API_CACHE_TTL_MS) {
        delete apiCache[k]; delete apiCacheAt[k];
      }
    });
  }

  // Invalidate all cache (call on network reconnect)
  function clearCache() {
    Object.keys(apiCache).forEach(k => { delete apiCache[k]; delete apiCacheAt[k]; });
  }

  return { json, image, clearCache, purgeExpired };
})();

// ── fetchWithProxy ────────────────────────────────────────────────────────────
// Tries direct first (MangaDex API has CORS enabled — works on GitHub Pages).
// Falls back to corsproxy.io, then RequestManager's full retry+rotation chain.
async function fetchWithProxy(url) {
  // 1. Try direct — MangaDex/ComicK both support CORS from GitHub Pages
  try {
    const resp = await fetch(url, { mode: 'cors', credentials: 'omit' });
    if (resp.ok) return resp;
  } catch (_) {}
  // 2. Fallback: corsproxy.io
  try {
    const proxied = CONFIG.PROXIES[1](url); // index 1 = corsproxy.io
    const resp = await fetch(proxied, { mode: 'cors', credentials: 'omit' });
    if (resp.ok) return resp;
  } catch (_) {}
  // 3. Final fallback: RequestManager full retry+rotation logic
  return RequestManager.request(url);
}

// Convenience alias used throughout the app
async function api(url) { return RequestManager.json(url); }

// ── SourceHealth ─────────────────────────────────────────────────────────────
// Tracks success/failure rate per source.
// After 3 failures → source disabled (cooldown).
// After 10 failures → source marked dead.
const SourceHealth = (() => {
  const stats = {};
  const DISABLE_AT = 3, DEAD_AT = 10, COOLDOWN_MS = 5 * 60 * 1000;

  function _get(id) {
    if (!stats[id]) stats[id] = { ok: 0, fail: 0, lastFail: 0, disabled: false, dead: false };
    return stats[id];
  }
  function onSuccess(id) {
    const s = _get(id);
    s.ok++;
    s.disabled = false;
    if (s.fail > 0) s.fail = Math.max(0, s.fail - 1);
  }
  function onFail(id) {
    const s = _get(id);
    s.fail++;
    s.lastFail = Date.now();
    if (s.fail >= DEAD_AT)    { s.dead = true;     s.disabled = true; }
    else if (s.fail >= DISABLE_AT) { s.disabled = true; }
  }
  function isAvailable(id) {
    const s = _get(id);
    if (s.dead) return false;
    if (s.disabled && Date.now() - s.lastFail > COOLDOWN_MS) {
      s.disabled = false; // cooldown expired — retry
    }
    return !s.disabled;
  }
  function report(id) {
    const s = _get(id);
    const total = s.ok + s.fail;
    return { ...s, rate: total ? Math.round(s.ok / total * 100) : 100 };
  }
  function all() { return stats; }
  return { onSuccess, onFail, isAvailable, report, all };
})();

// ── Helpers ──────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// loadStored() and saveStored() are now in utils/storage.js
