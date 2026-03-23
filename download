// ═══════════════════════════════════════════════════════════
// OtakuReader — utils/storage.js
//
// All localStorage read/write in one place.
// loadStored()   — read a value (returns default if missing)
// saveStored()   — write a value
// clearStored()  — delete one key
// getAllStored()  — list every OtakuReader key + value
// dumpAll()      — debug: print all keys to console
//
// Keys are defined in CONFIG.KEYS (config.js).
// Every write is also mirrored to IndexedDB via IDB (script.js)
// so data survives storage-quota eviction.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Read ──────────────────────────────────────────────────────────────────────
/**
 * Load a JSON value from localStorage.
 * @param {string} key   - localStorage key
 * @param {*}      def   - default value if key is missing or parse fails
 * @returns {*} parsed value or def
 */
function loadStored(key, def) {
  try {
    const raw = localStorage.getItem(key);
    return raw !== null ? JSON.parse(raw) : def;
  } catch (_) {
    return def;
  }
}

// ── Write ─────────────────────────────────────────────────────────────────────
/**
 * Save any JSON-serialisable value to localStorage.
 * Silently ignores QuotaExceededError (storage full).
 * @param {string} key   - localStorage key
 * @param {*}      value - value to store
 * @returns {boolean} true on success, false if storage is full
 */
function saveStored(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22) {
      console.warn('[Storage] Quota exceeded — could not save', key);
    }
    return false;
  }
}

// ── Delete one key ────────────────────────────────────────────────────────────
/**
 * Remove a single key from localStorage.
 * @param {string} key - localStorage key to remove
 */
function clearStored(key) {
  try { localStorage.removeItem(key); } catch (_) {}
}

// ── List all app keys ─────────────────────────────────────────────────────────
/**
 * Return all OtakuReader keys and their parsed values.
 * Useful for backup / debug.
 * @returns {Object} { key: parsedValue, … }
 */
function getAllStored() {
  const result = {};
  if (!CONFIG || !CONFIG.KEYS) return result;
  Object.values(CONFIG.KEYS).forEach(key => {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      try { result[key] = JSON.parse(raw); }
      catch (_) { result[key] = raw; }
    }
  });
  return result;
}

// ── Debug helper ──────────────────────────────────────────────────────────────
/**
 * Print all stored keys and sizes to the console.
 * Call dumpAll() from the browser DevTools.
 */
function dumpAll() {
  const all = getAllStored();
  console.group('[Storage] All stored keys');
  Object.entries(all).forEach(([k, v]) => {
    const size = JSON.stringify(v).length;
    console.log(`  ${k} — ${size} bytes`);
  });
  console.groupEnd();
}

// ── Storage-quota estimate ────────────────────────────────────────────────────
/**
 * Estimate how much storage the app is using (bytes).
 * @returns {number} approximate byte count
 */
function estimateStorageBytes() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      const v = localStorage.getItem(k) || '';
      total += k.length + v.length;
    }
  } catch (_) {}
  return total * 2; // localStorage stores UTF-16, ~2 bytes per char
}
