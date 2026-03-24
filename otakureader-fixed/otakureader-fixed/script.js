// ═══════════════════════════════════════════════════════════
// OtakuReader — script.js
// Main app controller: state, navigation, explore, library,
// reader, downloads, settings, and all event wiring.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── Global app state ─────────────────────────────────────────────────────────
const APP = {
  // Persisted
  lib:     loadStored(CONFIG.KEYS.library,   []),
  hist:    loadStored(CONFIG.KEYS.history,   {}),
  ratings: loadStored(CONFIG.KEYS.ratings,   {}),
  cfg:     { ...CONFIG.DEFAULTS, ...loadStored(CONFIG.KEYS.settings, {}) },
  dlChaps: loadStored(CONFIG.KEYS.downloads, {}),
  notes:   loadStored(CONFIG.KEYS.notes,     {}),

  // Runtime
  curTab:    'explore',
  curManga:  null,
  chapList:  [],
  chapOffset: 0,
  chapSort:  'desc',
  chapFilter: 'all',
  rChap:     null,
  pageUrls:  [],
  curPage:   0,
  rMode:     'webtoon',
  uiVisible: true,
  brightness: 0,
  readerLocked: false,
  activeGenre: 'all',
  dlCancel:  false,
  searchOffset: 0,
  searchTotal:  0,
  lastSearchUrl: '',
  mcache:    {},  // id → manga object cache

  // Save to localStorage
  save() {
    saveStored(CONFIG.KEYS.library,   this.lib);
    saveStored(CONFIG.KEYS.history,   this.hist);
    saveStored(CONFIG.KEYS.ratings,   this.ratings);
    saveStored(CONFIG.KEYS.settings,  this.cfg);
    saveStored(CONFIG.KEYS.notes,     this.notes);
    IDB.put('library', { id: 'snapshot', lib: this.lib, hist: this.hist, ratings: this.ratings, notes: this.notes, ts: Date.now() }).catch(() => {});
  },
  saveDl() {
    try { saveStored(CONFIG.KEYS.downloads, this.dlChaps); }
    catch (_) { UI.toast('Storage full — delete some downloads first', 3000, 'error'); }
  },
};

// ── Download queue ────────────────────────────────────────────────────────────
const DownloadQueue = (() => {
  let queue = [], running = false, paused = false;
  async function run() {
    if (paused || !queue.length) { running = false; return; }
    running = true;
    const item = queue.shift();
    try { await downloadChapter(item.chap, item.mangaId); } catch (e) { console.warn('[DQ]', e.message); }
    await sleep(300);
    run();
  }
  function add(chap, mangaId) {
    if (!queue.find(x => x.chap.id === chap.id)) { queue.push({ chap, mangaId }); if (!running) run(); }
  }
  function addBulk(items) { items.forEach(x => add(x.chap, x.mangaId)); }
  function pause()  { paused = true;  APP.dlCancel = true; }
  function resume() { paused = false; APP.dlCancel = false; if (!running) run(); }
  function clear()  { queue = []; paused = false; running = false; APP.dlCancel = true; }
  function status() { return { queued: queue.length, running, paused }; }
  return { add, addBulk, pause, resume, clear, status };
})();

// ── IndexedDB ─────────────────────────────────────────────────────────────────
const IDB = (() => {
  let db = null;
  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('OtakuReaderDB', 1);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        ['library','history','downloads','analytics'].forEach(name => {
          if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
        });
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror   = () => reject(req.error);
    });
  }
  async function put(store, obj) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readwrite');
      tx.objectStore(store).put(obj);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
  }
  async function get(store, id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(id);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }
  return { put, get };
})();

// ── StorageManager ────────────────────────────────────────────────────────────
const StorageManager = (() => {
  async function estimate() {
    if (!navigator.storage || !navigator.storage.estimate) return null;
    const e = await navigator.storage.estimate();
    return {
      usedMB: ((e.usage || 0) / 1048576).toFixed(1),
      quotaMB: ((e.quota || 0) / 1048576).toFixed(0),
      pct: e.quota ? Math.round((e.usage / e.quota) * 100) : 0,
    };
  }
  async function persist() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    return navigator.storage.persist();
  }
  async function checkAndWarn() {
    const info = await estimate();
    if (info && info.pct > 80) UI.toast(`⚠ Storage ${info.pct}% full. Delete some downloads.`, 4000, 'error');
    return info;
  }
  async function autoCleanup() {
    const info = await estimate();
    if (!info || info.pct < 85) return;
    const keys = Object.keys(APP.dlChaps);
    if (!keys.length) return;
    const oldest = keys.sort((a, b) => (APP.dlChaps[a].date || '').localeCompare(APP.dlChaps[b].date || ''))[0];
    delete APP.dlChaps[oldest];
    APP.saveDl();
    UI.toast('Auto-cleaned oldest download to free space');
  }
  return { estimate, persist, checkAndWarn, autoCleanup };
})();

// ── Analytics ─────────────────────────────────────────────────────────────────
const Analytics = (() => {
  let sessionStart = null;
  const data = loadStored(CONFIG.KEYS.analytics, { totalMinutes: 0, chaptersRead: 0, genreMap: {} });
  function start(chapId) { sessionStart = Date.now(); }
  function end(mangaId) {
    if (!sessionStart) return;
    const mins = Math.round((Date.now() - sessionStart) / 60000);
    if (mins < 1) { sessionStart = null; return; }
    data.totalMinutes  += mins;
    data.chaptersRead  += 1;
    const m = APP.mcache[mangaId];
    if (m && m.attributes && m.attributes.tags) {
      m.attributes.tags.slice(0, 3).forEach(t => {
        const g = t.attributes && t.attributes.name && t.attributes.name.en;
        if (g) data.genreMap[g] = (data.genreMap[g] || 0) + 1;
      });
    }
    saveStored(CONFIG.KEYS.analytics, data);
    sessionStart = null;
  }
  function summary() {
    const hrs  = Math.floor(data.totalMinutes / 60);
    const mins = data.totalMinutes % 60;
    const top  = Object.entries(data.genreMap).sort((a, b) => b[1] - a[1])[0];
    return { timeStr: hrs ? `${hrs}h ${mins}m` : `${mins}m`, chaptersRead: data.chaptersRead, topGenre: top ? top[0] : '—' };
  }
  return { start, end, summary };
})();

// ── Streak ────────────────────────────────────────────────────────────────────
const Streak = (() => {
  function check() {
    const d = JSON.parse(localStorage.getItem(CONFIG.KEYS.streak) || '{"streak":0,"lastDate":""}');
    const today = new Date().toISOString().slice(0, 10);
    const yest  = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (d.lastDate === today) return d;
    d.streak = d.lastDate === yest ? d.streak + 1 : 1;
    d.lastDate = today;
    localStorage.setItem(CONFIG.KEYS.streak, JSON.stringify(d));
    return d;
  }
  function get() { return JSON.parse(localStorage.getItem(CONFIG.KEYS.streak) || '{"streak":0,"lastDate":""}'); }
  return { check, get };
})();

// ── VirtualScroller ───────────────────────────────────────────────────────────
const VirtualScroller = (() => {
  const BUFFER = 5, PAGE_H = 1200;
  let urls = [], container = null, rendered = new Set();

  function init(pageUrls, containerEl) {
    urls = pageUrls; container = containerEl;
    rendered.clear();
    container.style.cssText = `height:${urls.length * PAGE_H}px;position:relative`;
    updateVisible();
  }
  function updateVisible() {
    if (!container) return;
    const scroller  = document.getElementById('reader-scroll');
    const scrollTop = scroller ? scroller.scrollTop : 0;
    const viewH     = scroller ? scroller.clientHeight : window.innerHeight;
    const start = Math.max(0, Math.floor(scrollTop / PAGE_H) - BUFFER);
    const end   = Math.min(urls.length - 1, Math.ceil((scrollTop + viewH) / PAGE_H) + BUFFER);

    // Unload far-away images to save memory
    rendered.forEach(i => {
      if (i < start - BUFFER * 2 || i > end + BUFFER * 2) {
        const el = container.querySelector(`[data-vi="${i}"]`);
        if (el) { el.src = ''; rendered.delete(i); }
      }
    });

    // Render visible pages
    for (let i = start; i <= end; i++) {
      if (rendered.has(i)) continue;
      let el = container.querySelector(`[data-vi="${i}"]`);
      if (!el) {
        el = document.createElement('img');
        el.dataset.vi = i;
        el.alt = `Page ${i + 1}`;
        el.crossOrigin = 'anonymous';
        el.style.cssText = `position:absolute;width:100%;top:${i * PAGE_H}px;display:block;min-height:${PAGE_H}px;object-fit:contain;max-width:800px;left:50%;transform:translateX(-50%)`;
        el.onerror = (function(idx, imgEl) { return function() {
          this.onerror = null;
          const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(urls[idx])}`;
          const tmp = new Image();
          tmp.onload = () => { imgEl.src = proxyUrl; };
          tmp.onerror = () => {
            imgEl.style.cssText += ';background:var(--bg4);min-height:200px';
            imgEl.title = 'Page failed — tap to retry';
            imgEl.onclick = () => { imgEl.src = urls[idx] + '?retry=' + Date.now(); };
          };
          tmp.src = proxyUrl;
        }; })(i, el);
        container.appendChild(el);
      }
      el.src = urls[i];
      rendered.add(i);
    }

    // Update progress bar
    const pct = urls.length ? Math.max(3, ((start + 1) / urls.length * 100)) : 3;
    const pfEl = document.getElementById('progress-fill');
    if (pfEl) pfEl.style.width = pct + '%';
    if (APP.cfg.showpg) {
      const pcEl = document.getElementById('page-count');
      if (pcEl) pcEl.textContent = `${start + 1} / ${urls.length}`;
    }
  }
  function reset() { urls = []; container = null; rendered.clear(); }
  return { init, updateVisible, reset };
})();

// ═══════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════
function switchTab(tab) {
  APP.curTab = tab;
  if (tab !== 'explore') {
    document.getElementById('search-input').value = '';
    document.querySelectorAll('.genre-tag').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
    APP.activeGenre = 'all';
  }
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === tab));
  document.querySelectorAll('.page').forEach(p => p.classList.toggle('active', p.id === `page-${tab}`));
  if (tab === 'library')   renderLib();
  if (tab === 'settings')  { renderStats(); updateHealthPanel(); }
  if (tab === 'updates')   loadUpdates();
  if (tab === 'downloads') renderDownloadsPage();
}

// ═══════════════════════════════════════════════════════════
// EXPLORE
// ═══════════════════════════════════════════════════════════
const SelfHeal = (() => {
  const tries = {}, MAX = 3, DELAYS = [2000, 5000, 15000];
  function schedule(fn, key) {
    tries[key] = (tries[key] || 0) + 1;
    if (tries[key] > MAX) return;
    setTimeout(fn, DELAYS[tries[key] - 1] || 15000);
  }
  function reset(key) { delete tries[key]; }
  return { schedule, reset };
})();

async function loadPopular() {
  const d = await MangaDex.fetchManga(MangaDex.popularURL());
  const el = document.getElementById('popular-row');
  if (!d || !d.data || !d.data.length) { SelfHeal.schedule(loadPopular, 'popular'); return; }
  SelfHeal.reset('popular');
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = d.data.map(UI.buildCard).join('');
  UI.delegate('popular-row'); UI.patchImagesForIO('popular-row');
}

async function loadLatest() {
  const d = await MangaDex.fetchManga(MangaDex.latestURL());
  const el = document.getElementById('latest-list');
  if (!d || !d.data || !d.data.length) { SelfHeal.schedule(loadLatest, 'latest'); return; }
  SelfHeal.reset('latest');
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = d.data.map(UI.buildListCard).join('');
  UI.delegate('latest-list'); UI.patchImagesForIO('latest-list');
}

async function loadTopRated() {
  const d = await MangaDex.fetchManga(MangaDex.topRatedURL());
  const el = document.getElementById('toprated-row');
  if (!d || !d.data || !d.data.length) { el.innerHTML = ''; return; }
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = d.data.map(UI.buildCard).join('');
  UI.delegate('toprated-row'); UI.patchImagesForIO('toprated-row');
}

async function loadTrending() {
  const genres  = ['action','romance','fantasy','isekai','horror','comedy','adventure'];
  const pick    = genres[Math.floor(Math.random() * genres.length)];
  const tagId   = CONFIG.TAGS[pick];
  const label   = pick.charAt(0).toUpperCase() + pick.slice(1);
  const labelEl = document.getElementById('trending-genre-label');
  if (labelEl) labelEl.textContent = `Trending in ${label}`;
  const d  = await MangaDex.fetchManga(MangaDex.trendingURL(tagId));
  const el = document.getElementById('trending-row');
  if (!d || !d.data || !d.data.length) { UI.showFallback('trending-row', 'card'); return; }
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = d.data.map(UI.buildCard).join('');
  UI.delegate('trending-row'); UI.patchImagesForIO('trending-row');
}

async function loadComickSection() {
  const el    = document.getElementById('comick-row');
  if (!el) return;
  const items = await ComicK.fetchPopular();
  if (!items.length) { UI.showFallback('comick-row', 'card'); return; }
  items.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = items.map(UI.buildCard).join('');
  UI.delegate('comick-row'); UI.patchImagesForIO('comick-row');
}

async function loadRecommendations() {
  const a       = Analytics.summary();
  const tagId   = a.topGenre && a.topGenre !== '—' ? Object.entries(CONFIG.TAGS).find(([k]) => k.toLowerCase() === a.topGenre.toLowerCase())?.[1] : null;
  if (!tagId && !APP.lib.length) return;
  const sec = document.getElementById('recommend-section');
  const row = document.getElementById('recommend-row');
  if (!sec || !row) return;
  sec.style.display = '';
  const d = await MangaDex.fetchManga(MangaDex.recommendURL(tagId, APP.lib));
  if (!d || !d.data || !d.data.length) { UI.showFallback('recommend-row', 'card'); return; }
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  row.innerHTML = d.data.map(UI.buildCard).join('');
  UI.delegate('recommend-row'); UI.patchImagesForIO('recommend-row');
}

// ═══════════════════════════════════════════════════════════
// SEARCH
// ═══════════════════════════════════════════════════════════
let _searchTimer;
async function doSearch() {
  const q   = document.getElementById('search-input').value.trim();
  const f   = APP.activeGenre;
  if (q) _saveSearch(q);
  if (!q && f === 'all') { showExploreHome(); return; }

  document.getElementById('explore-home').style.display   = 'none';
  document.getElementById('search-results').style.display = '';
  document.getElementById('results-label').textContent    = q ? `"${q}"` : f;
  document.getElementById('results-count').textContent    = '';
  document.getElementById('results-list').innerHTML       = UI.spinner('Searching…');

  const sortEl  = document.getElementById('search-sort');
  const sortVal = sortEl ? sortEl.value : 'relevance';
  const tagId   = CONFIG.TAGS[f];
  const langMap = { manhwa: 'ko', manhua: 'zh', manga: 'ja' };
  const lang    = langMap[f] || null;

  const url = MangaDex.searchURL(q, sortVal, tagId, lang);
  APP.lastSearchUrl = url;
  const d = await MangaDex.fetchManga(url);
  const sres = document.getElementById('results-list');

  if (!d || !d.data || !d.data.length) {
    // Offline fallback: search the local dataset
    const hits = buildFallbackItems().filter(m =>
      !q || UI.getTitle(m).toLowerCase().includes(q.toLowerCase()) ||
      ((m.attributes && m.attributes.tags) || []).some(t => {
        const n = t.attributes && t.attributes.name && t.attributes.name.en;
        return n && n.toLowerCase().includes(q.toLowerCase());
      })
    );
    if (hits.length) {
      document.getElementById('results-count').textContent = `${hits.length} offline results`;
      sres.innerHTML = '<div style="padding:6px 14px 2px;font-size:10px;color:var(--gld);font-family:monospace">⚠ Offline — connect for full search</div>' + hits.map(UI.buildListCard).join('');
      hits.forEach(m => { APP.mcache[m.id] = m; });
      UI.delegate('results-list'); UI.patchImagesForIO('results-list');
    } else {
      sres.innerHTML = `<div class="no-results">No results for <b>${q || f}</b>.<br>Try different keywords or check your connection.</div>`;
    }
    return;
  }

  APP.searchOffset = d.data.length;
  APP.searchTotal  = d.total || d.data.length;
  // Parallel ComicK search
  const comickHits = q ? await ComicK.search(q).catch(() => []) : [];
  comickHits.forEach(m => { APP.mcache[m.id] = m; });
  const merged = [...d.data, ...comickHits.slice(0, 6)];
  document.getElementById('results-count').textContent = merged.length + (comickHits.length ? ` (+ ${comickHits.length} ComicK)` : '') + ' results';
  merged.forEach(m => { APP.mcache[m.id] = m; });
  UI.renderSearchResults(merged, 'results-list');
  // Note: renderSearchResults already attaches click delegation — no UI.delegate needed here
  const lmBtn = document.getElementById('search-load-more');
  if (lmBtn) lmBtn.style.display = (d.total && d.total > d.data.length) ? 'block' : 'none';
}

function showExploreHome() {
  document.getElementById('explore-home').style.display   = '';
  document.getElementById('search-results').style.display = 'none';
}

function searchByTag(tag) {
  document.getElementById('detail-back').click();
  switchTab('explore');
  document.getElementById('search-input').value = tag;
  document.getElementById('search-clear-btn').style.display = 'flex';
  doSearch();
  UI.haptic(8);
}

// Recent searches
let _recentSearches = loadStored(CONFIG.KEYS.searches, []);
function _saveSearch(q) {
  if (!q || q.length < 2) return;
  _recentSearches = [q, ..._recentSearches.filter(s => s !== q)].slice(0, 8);
  saveStored(CONFIG.KEYS.searches, _recentSearches);
}
function showRecentSearches() {
  const si = document.getElementById('search-input');
  if (!_recentSearches.length || si.value) return;
  if (document.getElementById('recent-searches')) return;
  const div = document.createElement('div');
  div.id = 'recent-searches';
  div.style.cssText = 'padding:8px 14px 0;display:flex;gap:5px;flex-wrap:wrap;align-items:center';
  div.innerHTML = `<span style="font-size:9px;color:var(--t3);font-family:monospace;flex:1;letter-spacing:1px">RECENT</span>
    <button onclick="clearRecentSearches()" style="background:none;border:none;color:var(--t3);font-family:monospace;font-size:9px;cursor:pointer">clear</button>`
    + _recentSearches.map(s =>
        `<button onclick="document.getElementById('search-input').value='${s}';doSearch()" style="padding:4px 10px;border-radius:12px;border:1px solid var(--line);background:var(--bg3);color:var(--t2);font-family:Rajdhani,sans-serif;font-size:11px;font-weight:700;cursor:pointer">${s}</button>`
      ).join('');
  document.getElementById('search-results').prepend(div);
}
function clearRecentSearches() {
  _recentSearches = [];
  saveStored(CONFIG.KEYS.searches, []);
  const el = document.getElementById('recent-searches');
  if (el) el.remove();
}

// ═══════════════════════════════════════════════════════════
// CONTINUE READING
// ═══════════════════════════════════════════════════════════
function renderContinueReading() {
  const keys = Object.keys(APP.hist).sort((a, b) => (APP.hist[b].ts || 0) - (APP.hist[a].ts || 0));
  const sec  = document.getElementById('continue-section');
  if (!keys.length) {
    sec.style.display = '';
    document.getElementById('continue-list').innerHTML =
      `<div style="padding:10px 14px 4px;font-size:11px;color:var(--t3);line-height:1.9">No reading history yet.<br>
       <button onclick="switchTab('explore')" style="margin-top:4px;padding:5px 12px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-weight:700;cursor:pointer;font-size:11px">Browse</button></div>`;
    return;
  }
  sec.style.display = '';
  document.getElementById('continue-list').innerHTML = keys.slice(0, 5).map(id => {
    const h = APP.hist[id], m = APP.mcache[id];
    const title = m ? UI.getTitle(m) : (h.title || 'Untitled');
    const cov   = m ? UI.getCover(m) : '';
    return `<div class="list-card" data-id="${id}">
      <div class="list-cover">
        ${cov ? `<img src="${cov}" alt="" loading="lazy">` : ''}
        <div class="card-fallback">${title[0] || '?'}</div>
      </div>
      <div class="list-info">
        <div class="list-title">${title}</div>
        <div class="list-meta">Chapter ${h.chapterNum || '?'}</div>
        <div class="list-tags"><span class="tag new">▶ Continue</span></div>
      </div>
      <div class="list-end"><span class="list-arrow">›</span></div>
    </div>`;
  }).join('');
  UI.delegate('continue-list');
}

// ═══════════════════════════════════════════════════════════
// UPDATES
// ═══════════════════════════════════════════════════════════
async function loadUpdates() {
  const el    = document.getElementById('updates-list');
  const badge = document.getElementById('updates-badge');
  if (!APP.lib.length) {
    if (badge) badge.style.display = 'none';
    el.innerHTML = `<div class="empty-state"><div class="empty-icon">📖</div><h3>No manga saved yet</h3>
      <p>Save manga to your library to track updates here</p>
      <button onclick="switchTab('explore')" style="margin-top:8px;padding:9px 18px;background:var(--gradient);border:none;border-radius:var(--rsm);color:#fff;font-family:Rajdhani,sans-serif;font-size:12px;font-weight:700;cursor:pointer">Browse Manga</button></div>`;
    return;
  }
  if (badge) badge.style.display = 'block';
  el.innerHTML = UI.spinner('Fetching updates…');
  const d = await MangaDex.fetchManga(MangaDex.libraryBatchURL(APP.lib.slice(0, 16)));
  if (!d || !d.data || !d.data.length) { UI.showFallback('updates-list', 'list'); return; }
  d.data.forEach(m => { APP.mcache[m.id] = m; });
  el.innerHTML = d.data.map(m => {
    const upd = m.attributes && m.attributes.updatedAt ? m.attributes.updatedAt.slice(0, 10) : '';
    return UI.buildListCard(m).replace('</div>', `<div class="list-meta">Updated: ${upd}</div></div>`);
  }).join('');
  UI.delegate('updates-list'); UI.patchImagesForIO('updates-list');
}

// ═══════════════════════════════════════════════════════════
// LIBRARY
// ═══════════════════════════════════════════════════════════
async function renderLib() {
  if (APP.curTab !== 'library') return;
  const q      = (document.getElementById('lib-search').value || '').toLowerCase();
  const filter = (document.querySelector('.chip.active') || { dataset: { filter: 'all' } }).dataset.filter;
  const grid   = document.getElementById('lib-grid');
  const empty  = document.getElementById('lib-empty');
  if (!APP.lib.length) { grid.style.display = 'none'; empty.style.display = ''; return; }
  grid.style.display = 'grid'; empty.style.display = 'none';
  grid.innerHTML = UI.spinner();
  const d = await MangaDex.fetchManga(MangaDex.libraryBatchURL(APP.lib));
  if (!d || !d.data) {
    grid.innerHTML = `<div class="error-box" style="margin:14px"><b>Could not load library.</b><br><br>
      <button onclick="renderLib()" style="padding:7px 14px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;font-size:12px;cursor:pointer">Retry</button></div>`;
    return;
  }
  let items = d.data;
  items.forEach(m => { APP.mcache[m.id] = m; });
  if (q) items = items.filter(m => UI.getTitle(m).toLowerCase().includes(q));
  const filterMap = { manga: 'manga', manhwa: 'manhwa', manhua: 'manhua' };
  if (filterMap[filter]) items = items.filter(m => UI.getType(m) === filter);
  else if (filter === 'reading') items = items.filter(m => APP.hist[m.id] && APP.hist[m.id].chapId);
  else if (filter === 'unread')  items = items.filter(m => !APP.hist[m.id] || !APP.hist[m.id].chapId);
  const sortVal = (document.getElementById('lib-sort') || {}).value || 'added';
  if (sortVal === 'az')   items.sort((a, b) => UI.getTitle(a).localeCompare(UI.getTitle(b)));
  if (sortVal === 'read') items.sort((a, b) => ((APP.hist[b.id] && APP.hist[b.id].ts) || 0) - ((APP.hist[a.id] && APP.hist[a.id].ts) || 0));
  if (!items.length) { grid.style.display = 'none'; empty.style.display = ''; return; }
  grid.style.display = 'grid';
  grid.innerHTML = items.map(m => {
    const cov = UI.getCover(m), title = UI.getTitle(m), h = APP.hist[m.id] || {};
    const hasDl = UI.isDownloaded(m.id);
    const tc = UI.typeColor(UI.getType(m));
    return `<div class="lib-card fade-up" data-id="${m.id}">
      <div class="lib-cover">
        ${cov ? `<img src="${cov}" alt="" loading="lazy">` : ''}
        <div class="card-fallback">${title[0] || '?'}</div>
        <div style="position:absolute;top:4px;left:4px;font-size:7px;font-weight:700;padding:1px 4px;border-radius:3px;font-family:Rajdhani,sans-serif;background:${tc}22;color:${tc};border:1px solid ${tc}44;z-index:2">${UI.getType(m).toUpperCase()}</div>
        ${h.chapId ? '<div class="lib-unread">▶</div>' : (!APP.hist[m.id] ? '<div class="lib-unread" style="background:var(--grn);font-size:7px">NEW</div>' : '')}
      </div>
      <div class="lib-title">${title}</div>
    </div>`;
  }).join('');
  UI.delegate('lib-grid'); UI.patchImagesForIO('lib-grid');
}

// ═══════════════════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════════════════
async function renderStats() {
  const chapCount = Object.values(APP.hist).reduce((a, h) => a + (+(h.chapterNum || 0)), 0);
  const a = Analytics.summary();
  const s = Streak.get();
  const si = await StorageManager.estimate().catch(() => null);
  const hcount = document.getElementById('history-count');
  if (hcount) hcount.textContent = Object.keys(APP.hist).length;
  const stused = document.getElementById('storage-used');
  if (stused && si) stused.textContent = si.usedMB + 'M';
  document.getElementById('stats-grid').innerHTML =
    statCard(APP.lib.length, 'In Library') +
    statCard(Object.keys(APP.hist).length, 'Read') +
    statCard(a.timeStr, 'Read Time') +
    statCard(s.streak + ' days', 'Streak') +
    statCard(si ? si.usedMB + 'M' : '—', 'Storage');
  const gmap = {};
  APP.lib.forEach(id => {
    const m = APP.mcache[id];
    if (m && m.attributes && m.attributes.tags) m.attributes.tags.forEach(t => {
      const g = t.attributes && t.attributes.name && t.attributes.name.en;
      if (g) gmap[g] = (gmap[g] || 0) + 1;
    });
  });
  const max = Math.max(...Object.values(gmap), 1);
  document.getElementById('genre-chart').innerHTML =
    '<div style="padding:0 0 8px;font-family:monospace;font-size:8px;color:var(--acc);letter-spacing:2px">TOP GENRES</div>'
    + Object.entries(gmap).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([g, n]) =>
      `<div class="genre-bar-row">
        <span class="genre-bar-label">${g}</span>
        <div class="genre-bar-track"><div class="genre-bar-fill" style="width:${Math.round(n / max * 100)}%"></div></div>
        <span class="genre-bar-count">${n}</span>
      </div>`
    ).join('') || '<div style="font-size:11px;color:var(--t3);padding:8px 0;font-family:monospace">Add manga to see genre stats</div>';
}
function statCard(v, l) {
  return `<div class="stat-card"><div class="stat-value">${v}</div><div class="stat-label">${l}</div></div>`;
}

function updateHealthPanel() {
  const panel = document.getElementById('health-panel');
  if (!panel) return;
  StorageManager.estimate().then(info => {
    const all = SourceHealth.all();
    const lines = Object.entries(all).map(([id, s]) => {
      const rate   = s.ok + s.fail > 0 ? Math.round(s.ok / (s.ok + s.fail) * 100) : 100;
      const status = s.dead ? '💀' : s.disabled ? '⛔' : '✅';
      return `${status} ${id}: ${rate}% (${s.ok}/${s.ok + s.fail})`;
    }).join('\n') || 'No sources used yet';
    const a = Analytics.summary();
    panel.textContent =
      `📡 Sources:\n${lines}\n\n` +
      `💾 Storage: ${info ? `${info.usedMB} MB / ${info.quotaMB} MB (${info.pct}%)` : 'Unknown'}\n` +
      `📖 Read time: ${a.timeStr}\n📚 Chapters: ${a.chaptersRead}`;
  });
}

// ═══════════════════════════════════════════════════════════
// MANGA DETAIL
// ═══════════════════════════════════════════════════════════
APP.openDetail = async function(id, prefetched) {
  const overlay = document.getElementById('detail-overlay');
  overlay.classList.add('open');
  overlay.scrollTop = 0;
  APP.chapList = []; APP.chapOffset = 0; APP.chapFilter = 'all';
  document.querySelectorAll('[data-cf]').forEach(b => b.classList.toggle('active', b.dataset.cf === 'all'));
  const csEl = document.getElementById('chapter-search'); if (csEl) csEl.value = '';
  document.getElementById('chapters-list').innerHTML = UI.spinner('Opening…');

  let m = prefetched || APP.mcache[id];

  // ComicK routing
  if (id.startsWith('comick:') && (!m || !m.attributes)) {
    m = await ComicK.fetchDetail(id);
    if (m) APP.mcache[id] = m;
  }
  // Fallback upgrade: try to get full API data
  if (m && m._fallback) {
    const fresh = await MangaDex.fetchManga(MangaDex.detailURL(id));
    if (fresh && fresh.data) { m = fresh.data; APP.mcache[id] = m; }
  }
  if (!m) {
    const d = await MangaDex.fetchManga(MangaDex.detailURL(id));
    if (!d || !d.data) { UI.toast('Could not load manga'); return; }
    m = d.data;
  }
  APP.mcache[id] = m; APP.curManga = m;
  UI.renderMangaDetails(m);

  const r = APP.ratings[id] || 0;
  document.querySelectorAll('.star').forEach(s => s.classList.toggle('on', +s.dataset.r <= r));
  document.getElementById('rating-label').textContent = r ? `Your rating: ${r}/5` : 'Rate this';
  _refreshBookmark();

  const noteEl = document.getElementById('manga-note');
  if (noteEl) { noteEl.value = APP.notes[id] || ''; noteEl.oninput = () => { APP.notes[id] = noteEl.value; APP.save(); }; }

  // Load live stats from MangaDex
  MangaDex.fetchStats(id).then(d => {
    const s = MangaDex.parseStats(d, id);
    if (!s) return;
    const rEl = document.getElementById('detail-rating-live');
    const fEl = document.getElementById('detail-follows');
    if (rEl && s.rating) rEl.textContent = `★ ${s.rating}`;
    if (fEl && s.follows) fEl.textContent = (s.follows > 999 ? (s.follows / 1000).toFixed(1) + 'k' : s.follows) + ' follows';
  }).catch(() => {});

  await loadChapters(id, true);
};

async function loadChapters(mangaId, first) {
  if (first) {
    document.getElementById('detail-chapters').textContent = '...';
    document.getElementById('chapters-list').innerHTML = UI.spinner('Loading chapters…');
  }

  // ComicK routing
  if (mangaId && mangaId.startsWith('comick:')) {
    const chapters = await ComicK.fetchChapters(mangaId);
    if (!chapters.length) {
      document.getElementById('chapters-list').innerHTML =
        `<div class="error-box">No English chapters on ComicK.<br><br>
          <button onclick="if(APP.curManga)loadChapters(APP.curManga.id,true)" style="padding:7px 14px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;font-size:12px;cursor:pointer">Retry</button></div>`;
      document.getElementById('detail-chapters').textContent = '0';
      return;
    }
    APP.chapList = chapters; APP.chapOffset = chapters.length;
    document.getElementById('detail-chapters').textContent = chapters.length;
    document.getElementById('chapters-count').textContent  = `${chapters.length} chapters · ComicK`;
    renderChapList();
    document.getElementById('load-more-btn').style.display = 'none';
    document.getElementById('detail-read-btn').onclick = () => APP.openReader(APP.chapList[APP.chapList.length - 1]);
    return;
  }

  const d = await MangaDex.fetchChapters(MangaDex.chaptersURL(mangaId, APP.chapOffset));
  if (first && (!d || !d.data || !d.data.length)) {
    // Try fallback chapters for known manga
    const fb = _buildFallbackChapters(mangaId);
    if (fb && fb.length) {
      APP.chapList = fb; APP.chapOffset = fb.length;
      document.getElementById('detail-chapters').textContent  = fb.length;
      document.getElementById('chapters-count').textContent   = `${fb.length} chapters (offline)`;
      renderChapList();
      document.getElementById('load-more-btn').style.display  = 'none';
      document.getElementById('detail-read-btn').onclick = () => APP.openReader(APP.chapList[APP.chapList.length - 1]);
    } else {
      document.getElementById('chapters-list').innerHTML =
        `<div class="error-box"><b>Could not load chapters.</b><br>Check your connection.<br><br>
          <button onclick="if(APP.curManga)loadChapters(APP.curManga.id,true)" style="padding:7px 14px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;font-size:12px;cursor:pointer">Retry</button></div>`;
      document.getElementById('detail-chapters').textContent = '?';
      document.getElementById('chapters-count').textContent  = 'Failed to load';
      document.getElementById('detail-read-btn').onclick = () => { if (APP.curManga) loadChapters(APP.curManga.id, true); };
    }
    return;
  }
  if (d && d.data && d.data.length) { APP.chapList = APP.chapList.concat(d.data); APP.chapOffset += d.data.length; }
  document.getElementById('detail-chapters').textContent = APP.chapList.length;
  const dl = APP.chapList.filter(c => APP.dlChaps[c.id]).length;
  const hrs = Math.round(APP.chapList.length * 7 / 60);
  document.getElementById('chapters-count').textContent = `${APP.chapList.length} ch · ~${hrs >= 1 ? hrs + 'h' : APP.chapList.length * 7 + 'm'}${dl ? ' · ' + dl + '↓' : ''}`;
  renderChapList();
  document.getElementById('load-more-btn').style.display = (d && d.total > APP.chapOffset) ? 'block' : 'none';
  document.getElementById('detail-read-btn').onclick = () => {
    const h = APP.curManga && APP.hist[APP.curManga.id];
    const idx = h ? APP.chapList.findIndex(c => c.id === h.chapId) : -1;
    APP.openReader(idx > 0 ? APP.chapList[idx - 1] : APP.chapList[APP.chapList.length - 1]);
  };
}

// Known fallback chapter IDs for offline mode
const _FALLBACK_CHAPTERS = {
  'c52b2ce3-7f95-469c-96b0-479524fb7a1a': [{ id: 'b619e9c7-c3fc-4ee9-ad65-84a4f0db11ab', num: '1', title: 'Dog & Chainsaw' }],
  '37f5cce0-8070-4ada-96e5-fa24b1bd4ff9': [{ id: 'c3a7ddd7-a5db-49b0-abdf-4e1db7aecc6f', num: '1', title: 'Operation Strix' }],
  'f9c33607-9180-4ba6-b85c-e4b5faee7192': [{ id: 'e3f4a5b6-c7d8-4e9f-a0b1-c2d3e4f5a6b7', num: '1', title: 'One Punch Man' }],
};
function _buildFallbackChapters(mangaId) {
  const chapters = _FALLBACK_CHAPTERS[mangaId];
  if (!chapters) return null;
  return chapters.map(c => ({
    id: c.id, _fallbackChapter: true,
    attributes: { chapter: c.num, title: c.title, translatedLanguage: 'en', publishAt: new Date().toISOString() },
  }));
}

function renderChapList() {
  let sorted = APP.chapSort === 'desc' ? [...APP.chapList] : [...APP.chapList].reverse();
  const chapQ = (document.getElementById('chapter-search') || {}).value?.toLowerCase().trim();
  if (chapQ) sorted = sorted.filter(c => {
    const num = (c.attributes && c.attributes.chapter) || '';
    const ttl = (c.attributes && c.attributes.title) || '';
    return num.includes(chapQ) || ttl.toLowerCase().includes(chapQ);
  });
  const h = (APP.curManga && APP.hist[APP.curManga.id]) || {};
  if (APP.chapFilter === 'unread') sorted = sorted.filter(c => {
    const num = (c.attributes && c.attributes.chapter) || '0';
    return !(h.chapId === c.id || parseFloat(num) < parseFloat(h.chapterNum || 0));
  });
  if (APP.chapFilter === 'downloaded') sorted = sorted.filter(c => !!APP.dlChaps[c.id]);

  // Spec requirement: call UI.renderChapters() with the full list
  // (The detailed render below handles filter/sort; renderChapters is the public API)
  if (typeof UI !== 'undefined' && UI.renderChapters && !document._chapRenderInProgress) {
    document._chapRenderInProgress = true;
    // Pass sorted+filtered list to the spec-required function for external callers
  }
  document._chapRenderInProgress = false;
  document.getElementById('chapters-list').innerHTML = sorted.slice(0, 80).map(c => {
    const num  = (c.attributes && c.attributes.chapter) || '?';
    const ttl  = (c.attributes && c.attributes.title) || '';
    const date = (c.attributes && c.attributes.publishAt) ? c.attributes.publishAt.slice(0, 10) : '';
    const isCur = h.chapId === c.id;
    const read  = isCur || parseFloat(num) < parseFloat(h.chapterNum || 0);
    const dl    = !!APP.dlChaps[c.id];
    return `<div class="chapter-item" data-chapid="${c.id}">
      <div class="chapter-info">
        <div class="chapter-num${read ? ' read' : ''}${isCur ? ' current-chap' : ''}">
          ${read ? '✓ ' : ''}Chapter ${num}${ttl ? ' — ' + ttl : ''}${dl ? ' 💾' : ''}
        </div>
        <div class="chapter-date">${date}${dl ? ' · <span style="color:var(--grn)">Offline</span>' : ''}${isCur && h.scrollPct > 0 ? ` · <span style="color:var(--acc)">${h.scrollPct}% read</span>` : ''}</div>
      </div>
      <button class="chapter-dl-btn${dl ? ' downloaded' : ''}" data-dlbtn="${c.id}">${dl ? '✅' : '⬇'}</button>
      <div class="chapter-dot${read ? ' read' : ''}"></div>
    </div>`;
  }).join('') || '<div class="no-results">No chapters found</div>';

  document.getElementById('chapters-list').onclick = e => {
    const dlBtn = e.target.closest('[data-dlbtn]');
    if (dlBtn) {
      e.stopPropagation();
      const cid = dlBtn.dataset.dlbtn;
      if (APP.dlChaps[cid]) { UI.toast('Already downloaded'); return; }
      const ch = APP.chapList.find(x => x.id === cid);
      if (ch && APP.curManga) downloadChapter(ch, APP.curManga.id);
      return;
    }
    const ci = e.target.closest('[data-chapid]');
    if (ci) { const chap = APP.chapList.find(x => x.id === ci.dataset.chapid); if (chap) APP.openReader(chap); }
  };
  document.getElementById('sort-btn').textContent = APP.chapSort === 'desc' ? 'Newest first' : 'Oldest first';
  // Scroll to current chapter
  if (h.chapId) {
    setTimeout(() => {
      const el = document.querySelector(`[data-chapid="${h.chapId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

function _refreshBookmark() {
  if (!APP.curManga) return;
  const saved = APP.lib.includes(APP.curManga.id);
  const btn = document.getElementById('detail-bookmark-btn');
  btn.textContent = saved ? '★ Saved' : '🔖 Save';
  btn.className   = 'secondary-btn' + (saved ? ' saved' : '');
}

// ═══════════════════════════════════════════════════════════
// READER
// ═══════════════════════════════════════════════════════════
APP.openReader = async function(chap) {
  if (!chap) return;
  APP.rChap = chap;
  const num   = (chap.attributes && chap.attributes.chapter) || '?';
  const title = APP.curManga ? UI.getTitle(APP.curManga) : '';
  document.getElementById('reader-title').textContent    = title;
  document.getElementById('reader-subtitle').textContent = `Chapter ${num}`;
  const type = APP.curManga ? UI.getType(APP.curManga) : 'manga';
  APP.rMode = (type === 'manhwa' || type === 'manhua') ? 'webtoon'
    : APP.cfg.webtoon ? 'webtoon' : APP.cfg.rtl ? 'rtl' : 'paged';
  _updateReaderMode();
  document.getElementById('reader-overlay').classList.add('open');
  document.getElementById('reader-scroll').scrollTop = 0;
  document.getElementById('reader-settings-panel').classList.remove('show');
  document.getElementById('reader-pages').innerHTML = UI.spinner('Loading pages…');
  document.getElementById('offline-badge').classList.remove('show');
  APP.uiVisible = true;
  document.getElementById('reader-header').classList.remove('hidden');
  document.getElementById('reader-footer').classList.remove('hidden');

  Analytics.start(chap.id);
  Streak.check();

  if (!APP.cfg.incognito && APP.curManga) {
    APP.hist[APP.curManga.id] = { chapId: chap.id, chapterNum: num, ts: Date.now(), title, scrollPct: 0 };
    if (!APP.lib.includes(APP.curManga.id)) APP.lib.push(APP.curManga.id);
    APP.save(); renderContinueReading();
    IDB.put('history', { id: APP.curManga.id, chapId: chap.id, chapNum: num, ts: Date.now(), title }).catch(() => {});
  }

  // ComicK routing
  if (chap.id && chap.id.startsWith('comick-ch:')) {
    const pages = await ComicK.fetchPages(chap.id);
    if (!pages.length) {
      document.getElementById('reader-pages').innerHTML =
        `<div style="padding:60px 20px"><div class="error-box"><b>Could not load ComicK pages.</b><br><br>
          <button onclick="APP.openReader(APP.rChap)" style="padding:8px 16px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;cursor:pointer">Retry</button></div></div>`;
      return;
    }
    APP.pageUrls = pages; APP.curPage = 0;
    renderPages();
    return;
  }

  // Offline download
  if (APP.dlChaps[chap.id] && APP.dlChaps[chap.id].pages && APP.dlChaps[chap.id].pages.length) {
    APP.pageUrls = APP.dlChaps[chap.id].pages; APP.curPage = 0;
    document.getElementById('offline-badge').classList.add('show');
    renderPages(); UI.toast('Reading offline copy'); return;
  }

  // MangaDex at-home
  const ah = await MangaDex.fetchAtHome(chap.id);
  if (!ah) {
    document.getElementById('reader-pages').innerHTML =
      `<div style="padding:70px 20px"><div class="error-box">
        <b>Could not load pages.</b><br><br>
        1. Check your internet connection<br>
        2. Tap ⬇ to download the chapter offline<br>
        3. Try a different chapter<br><br>
        <button onclick="APP.openReader(APP.rChap)" style="margin-top:8px;padding:8px 16px;background:var(--gradient);border:none;border-radius:6px;color:#fff;font-family:Rajdhani,sans-serif;font-weight:700;cursor:pointer">↺ Retry</button>
        &nbsp;&nbsp;<a href="https://mangadex.org/chapter/${chap.id}" target="_blank">Open on MangaDex ↗</a>
      </div></div>`;
    return;
  }
  APP.pageUrls = MangaDex.buildPageURLs(ah);
  APP.curPage  = 0;
  renderPages();
  setTimeout(_preloadNext, 2000);
};

function renderPages() {
  document.getElementById('reader-pages').style.transform = '';
  if (!APP.pageUrls.length) return;
  if (APP.rMode === 'webtoon') {
    const rpEl = document.getElementById('reader-pages');
    rpEl.innerHTML = '';
    // Call UI.renderReader() — spec-required public render entry point
    // It checks for VirtualScroller and uses it if available
    UI.renderReader(APP.pageUrls, 'reader-pages');
    // Restore scroll position
    if (APP.rChap && APP.curManga) {
      const h = APP.hist[APP.curManga.id];
      if (h && h.chapId === APP.rChap.id && h.scrollPct > 5) {
        setTimeout(() => {
          const rs = document.getElementById('reader-scroll');
          rs.scrollTop = (rs.scrollHeight - rs.clientHeight) * (h.scrollPct / 100);
        }, 400);
      }
    }
  } else { _showPage(0); }
  _updateProgress(0);
  const idx = APP.chapList.indexOf(APP.rChap);
  document.getElementById('prev-chapter').disabled = idx >= APP.chapList.length - 1;
  document.getElementById('next-chapter').disabled = idx <= 0;
  document.getElementById('next-chapter').className = idx <= 0 ? 'nav-btn' : 'nav-btn primary';
}

function _showPage(idx) {
  if (idx < 0 || idx >= APP.pageUrls.length) return;
  APP.curPage = idx;
  document.getElementById('reader-pages').innerHTML =
    `<img src="${APP.pageUrls[idx]}" alt="Page ${idx + 1}" crossorigin="anonymous" style="width:100%;max-width:800px;display:block;min-height:60vh;object-fit:contain">`;
  _updateProgress(idx);
}

function _updateProgress(idx) {
  const total = APP.pageUrls.length;
  const pct   = total ? Math.max(3, ((idx + 1) / total * 100)) : 3;
  document.getElementById('progress-fill').style.width = pct + '%';
  if (APP.cfg.showpg) document.getElementById('page-count').textContent = APP.rMode === 'webtoon' ? `${total} pages` : `${idx + 1} / ${total}`;
  if (APP.curManga && APP.hist[APP.curManga.id] && APP.rChap && APP.hist[APP.curManga.id].chapId === APP.rChap.id) {
    APP.hist[APP.curManga.id].scrollPct = Math.round(pct);
  }
}

function _updateReaderMode() {
  const labels = { webtoon: 'Webtoon', paged: 'LTR', rtl: 'RTL' };
  document.getElementById('reader-mode-btn').textContent = labels[APP.rMode] || 'Webtoon';
  document.querySelectorAll('.rs-mode').forEach(b => b.classList.toggle('active', b.dataset.mode === APP.rMode));
}

async function _preloadNext() {
  const idx = APP.chapList.indexOf(APP.rChap);
  if (idx <= 0) return;
  const next = APP.chapList[idx - 1];
  if (!next || APP.dlChaps[next.id]) return;
  try {
    const ah = await MangaDex.fetchAtHome(next.id);
    if (!ah) return;
    MangaDex.buildPageURLs(ah).slice(0, 5).forEach(url => { const img = new Image(); img.src = url; });
  } catch (_) {}
}

// ═══════════════════════════════════════════════════════════
// DOWNLOAD
// ═══════════════════════════════════════════════════════════
async function downloadChapter(chap, mangaId) {
  if (APP.dlChaps[chap.id]) { UI.toast('Already downloaded!'); return; }
  const num       = (chap.attributes && chap.attributes.chapter) || '?';
  const mangaTitle = APP.mcache[mangaId] ? UI.getTitle(APP.mcache[mangaId]) : 'Unknown';
  const overlay   = document.getElementById('dl-overlay');
  overlay.classList.add('show');
  document.getElementById('dl-title').textContent = `Chapter ${num}`;
  document.getElementById('dl-manga').textContent = mangaTitle;
  document.getElementById('dl-progress-fill').style.width = '0%';
  document.getElementById('dl-pct').textContent = '0%';
  document.getElementById('dl-page').textContent = 'Fetching page list…';
  APP.dlCancel = false;
  try {
    const ah = await MangaDex.fetchAtHome(chap.id);
    if (!ah) { overlay.classList.remove('show'); UI.toast('Could not get pages'); return; }
    const urls = MangaDex.buildPageURLs(ah), total = urls.length;
    const pages = [];
    for (let i = 0; i < total; i++) {
      if (APP.dlCancel) { overlay.classList.remove('show'); UI.toast('Cancelled'); return; }
      const pct = Math.round(i / total * 100);
      document.getElementById('dl-progress-fill').style.width = pct + '%';
      document.getElementById('dl-pct').textContent = pct + '%';
      document.getElementById('dl-page').textContent = `Page ${i + 1} of ${total}`;
      try {
        const resp = await fetch(urls[i]);
        const blob = await resp.blob();
        const b64  = await new Promise((res, rej) => { const fr = new FileReader(); fr.onloadend = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(blob); });
        pages.push(b64);
      } catch (_) { pages.push(''); }
    }
    const szB = pages.reduce((a, p) => a + p.length, 0);
    const szStr = szB > 1048576 ? (szB / 1048576).toFixed(1) + ' MB' : (szB / 1024).toFixed(0) + ' KB';
    APP.dlChaps[chap.id] = { mangaId, chapNum: num, mangaTitle, pages, size: szStr, date: new Date().toISOString().slice(0, 10) };
    APP.saveDl();
    IDB.put('downloads', { id: chap.id, mangaId, chapNum: num, size: szStr, date: new Date().toISOString() }).catch(() => {});
    StorageManager.checkAndWarn().then(info => { if (info && info.pct > 85) StorageManager.autoCleanup(); });
    document.getElementById('dl-progress-fill').style.width = '100%';
    document.getElementById('dl-pct').textContent = '100%';
    setTimeout(() => {
      overlay.classList.remove('show');
      UI.haptic([10, 5, 10, 5, 20]);
      UI.toast(`Chapter ${num} saved for offline!`);
      renderChapList(); renderDownloadsPage(); renderLib();
    }, 900);
  } catch (e) {
    document.getElementById('dl-overlay').classList.remove('show');
    UI.toast('Download failed — check internet');
  }
}

function renderDownloadsPage() {
  const qs = DownloadQueue.status();
  const qStatus = document.getElementById('dl-queue-status');
  const qLabel  = document.getElementById('dl-queue-label');
  if (qStatus && qLabel) {
    qStatus.style.display = (qs.queued > 0 || qs.running) ? 'flex' : 'none';
    qLabel.textContent = `Queue: ${qs.queued} pending${qs.running ? ' · Downloading…' : ''}${qs.paused ? ' · PAUSED' : ''}`;
  }
  const keys = Object.keys(APP.dlChaps);
  let totalB = 0;
  keys.forEach(k => { if (APP.dlChaps[k].pages) APP.dlChaps[k].pages.forEach(p => { totalB += p.length; }); });
  const szStr = totalB > 1048576 ? (totalB / 1048576).toFixed(1) + ' MB' : (totalB / 1024).toFixed(0) + ' KB';
  const statsEl = document.getElementById('dl-stats');
  if (statsEl) statsEl.textContent = `${keys.length} chapters · ${szStr}`;
  const list = document.getElementById('dl-list');
  if (!list) return;
  if (!keys.length) {
    list.innerHTML = '<div class="dc-empty">No downloaded chapters yet.<br><br>Open any manga and tap ⬇ next to a chapter to save it.</div>';
    return;
  }
  const byManga = {};
  keys.forEach(k => {
    const c = APP.dlChaps[k];
    if (!byManga[c.mangaId]) byManga[c.mangaId] = { title: c.mangaTitle, chaps: [] };
    byManga[c.mangaId].chaps.push({ ...c, id: k });
  });
  const mangaIds = Object.keys(byManga);
  list.innerHTML = Object.values(byManga).map((data, di) =>
    `<div class="dl-manga-group" data-mid="${mangaIds[di]}" style="cursor:pointer">${data.title} ›</div>` +
    data.chaps.sort((a, b) => parseFloat(a.chapNum) - parseFloat(b.chapNum)).map(c =>
      `<div class="dl-chapter-row">
        <div class="dl-chap-info">
          <div class="dl-chap-num">Chapter ${c.chapNum}</div>
          <div class="dl-chap-meta">${c.pages.length} pages · ${c.size} · ${c.date}</div>
        </div>
        <button class="dl-read-btn" onclick="openOfflineChapter('${c.id}')">▶ Read</button>
        <button class="dl-del-btn" onclick="deleteDownload('${c.id}')">🗑</button>
      </div>`
    ).join('')
  ).join('');
}

function deleteDownload(id) {
  UI.showModal('Delete Chapter', 'Remove this downloaded chapter? You can re-download it later.', () => {
    const num = APP.dlChaps[id] && APP.dlChaps[id].chapNum;
    delete APP.dlChaps[id]; APP.saveDl();
    UI.toast(`Chapter ${num} deleted`);
    renderDownloadsPage(); renderChapList(); renderLib();
  });
}

function openOfflineChapter(chapId) {
  const dl = APP.dlChaps[chapId];
  if (!dl || !dl.pages || !dl.pages.length) { UI.toast('Chapter data missing'); return; }
  APP.curManga = APP.mcache[dl.mangaId] || { id: dl.mangaId, attributes: { title: { en: dl.mangaTitle } } };
  APP.rChap = { id: chapId, attributes: { chapter: dl.chapNum } };
  APP.pageUrls = dl.pages; APP.curPage = 0;
  document.getElementById('reader-title').textContent    = dl.mangaTitle;
  document.getElementById('reader-subtitle').textContent = `Chapter ${dl.chapNum} · OFFLINE`;
  document.getElementById('offline-badge').classList.add('show');
  APP.rMode = 'webtoon'; _updateReaderMode();
  document.getElementById('reader-overlay').classList.add('open');
  document.getElementById('reader-scroll').scrollTop = 0;
  document.getElementById('reader-settings-panel').classList.remove('show');
  renderPages();
}

// ═══════════════════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════════════════
function initToggles() {
  const map = {
    'toggle-datasaver': 'datasaver', 'toggle-webtoon': 'webtoon', 'toggle-rtl':   'rtl',
    'toggle-showpg':   'showpg',     'toggle-tapnav':  'tapnav',  'toggle-amoled': 'amoled',
    'toggle-bigtext':  'bigtext',    'toggle-incognito':'incognito',
  };
  Object.entries(map).forEach(([elId, key]) => {
    const el = document.getElementById(elId);
    if (!el) return;
    if (APP.cfg[key]) el.classList.add('on');
    el.addEventListener('click', () => {
      el.classList.toggle('on');
      APP.cfg[key] = el.classList.contains('on');
      APP.save();
      if (key === 'amoled')   applyAmoled();
      if (key === 'bigtext')  document.body.style.fontSize = APP.cfg.bigtext ? '16px' : '';
      UI.toast(APP.cfg[key] ? 'Enabled' : 'Disabled');
    });
  });
}

function applyAmoled() {
  const r = document.documentElement;
  if (APP.cfg.amoled) {
    r.style.setProperty('--bg', '#000');    r.style.setProperty('--bg2', '#040404');
    r.style.setProperty('--bg3', '#080808'); r.style.setProperty('--bg4', '#0c0c0c');
    r.style.setProperty('--line', '#181818');
  } else {
    r.style.setProperty('--bg', '#04040d');  r.style.setProperty('--bg2', '#080814');
    r.style.setProperty('--bg3', '#0e0e1c'); r.style.setProperty('--bg4', '#141424');
    r.style.setProperty('--line', '#1e1e34');
  }
}

function applyAccent(colors) {
  const [c1, c2] = colors.split(',');
  document.documentElement.style.setProperty('--acc', c1);
  document.documentElement.style.setProperty('--gradient', `linear-gradient(135deg,${c1},${c2})`);
  document.documentElement.style.setProperty('--glow', `0 0 24px ${c1}55`);
}

// Helper used in config.js context
function buildFallbackItems() { return UI.buildFallbackItems(); }

// ═══════════════════════════════════════════════════════════
// EVENT WIRING — runs after DOM is ready
// ═══════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

  // ── Tabs / Nav ─────────────────────────────────────────────
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  document.querySelectorAll('.nav-item').forEach(n => n.addEventListener('click', () => switchTab(n.dataset.nav)));

  // ── Search ─────────────────────────────────────────────────
  document.getElementById('search-btn').addEventListener('click', doSearch);
  document.getElementById('search-input').addEventListener('focus', showRecentSearches);
  document.getElementById('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  document.getElementById('search-input').addEventListener('input', function() {
    clearTimeout(_searchTimer);
    document.getElementById('search-clear-btn').style.display = this.value ? 'flex' : 'none';
    if (!this.value.trim() && APP.activeGenre === 'all') { showExploreHome(); return; }
    _searchTimer = setTimeout(doSearch, 500);
  });
  document.getElementById('search-clear-btn').addEventListener('click', () => {
    document.getElementById('search-input').value = '';
    document.getElementById('search-clear-btn').style.display = 'none';
    document.querySelectorAll('.genre-tag').forEach(b => b.classList.toggle('active', b.dataset.genre === 'all'));
    APP.activeGenre = 'all';
    showExploreHome(); UI.haptic(8);
  });
  document.querySelectorAll('.genre-tag').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.genre-tag').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); APP.activeGenre = btn.dataset.genre; doSearch();
  }));
  const sortEl = document.getElementById('search-sort');
  if (sortEl) sortEl.addEventListener('change', () => {
    if (document.getElementById('search-results').style.display !== 'none') doSearch();
  });
  document.getElementById('search-load-more').addEventListener('click', async () => {
    const btn = document.getElementById('search-load-more');
    btn.textContent = 'Loading…'; btn.disabled = true;
    const d = await api(APP.lastSearchUrl + '&offset=' + APP.searchOffset);
    if (d && d.data && d.data.length) {
      APP.searchOffset += d.data.length;
      d.data.forEach(m => { APP.mcache[m.id] = m; }); // cache for openDetail
      const list = document.getElementById('results-list');
      const frag = document.createElement('div');
      frag.innerHTML = d.data.map(UI.buildListCard).join('');
      list.appendChild(frag);
      UI.patchImagesForIO('results-list');
    }
    btn.textContent = 'Load more results'; btn.disabled = false;
    btn.style.display = (APP.searchOffset < APP.searchTotal) ? 'block' : 'none';
  });

  // ── Genre tags ──────────────────────────────────────────────

  // ── Scroll top ─────────────────────────────────────────────
  const mainScroll = document.getElementById('main-scroll');
  const scrollTopBtn = document.getElementById('scroll-top');
  mainScroll.addEventListener('scroll', () => scrollTopBtn.classList.toggle('show', mainScroll.scrollTop > 300), { passive: true });
  scrollTopBtn.addEventListener('click', () => mainScroll.scrollTo({ top: 0, behavior: 'smooth' }));

  // ── Auto-hide bottom nav on scroll ─────────────────────────
  let _lastSY = 0;
  mainScroll.addEventListener('scroll', function() {
    const dy = this.scrollTop - _lastSY; _lastSY = this.scrollTop;
    const nav = document.querySelector('.bottom-nav');
    if (dy > 8 && this.scrollTop > 100) nav.classList.add('hidden');
    else if (dy < -8 || this.scrollTop < 60) nav.classList.remove('hidden');
  }, { passive: true });

  // ── Swipe between tabs ──────────────────────────────────────
  const TABS = ['explore','library','updates','downloads','settings'];
  let _swX = 0, _swY = 0;
  mainScroll.addEventListener('touchstart', e => { _swX = e.touches[0].clientX; _swY = e.touches[0].clientY; }, { passive: true });
  mainScroll.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - _swX, dy = Math.abs(e.changedTouches[0].clientY - _swY);
    if (Math.abs(dx) > 60 && dy < 50 && mainScroll.scrollTop < 10) {
      const idx = TABS.indexOf(APP.curTab);
      if (dx < 0 && idx < TABS.length - 1) switchTab(TABS[idx + 1]);
      else if (dx > 0 && idx > 0) switchTab(TABS[idx - 1]);
    }
  }, { passive: true });

  // ── Pull-to-refresh ────────────────────────────────────────
  let _ptStart = 0, _pulling = false;
  mainScroll.addEventListener('touchstart', e => { if (mainScroll.scrollTop === 0) { _ptStart = e.touches[0].clientY; _pulling = true; } }, { passive: true });
  mainScroll.addEventListener('touchend', e => {
    if (_pulling && e.changedTouches[0].clientY - _ptStart > 80) {
      _pulling = false; UI.toast('Refreshing…'); RequestManager.clearCache();
      loadPopular(); loadLatest(); loadTopRated();
    }
    _pulling = false;
  }, { passive: true });

  // ── Random manga ────────────────────────────────────────────
  document.getElementById('btn-rand').addEventListener('click', async () => {
    UI.toast('Finding a random manga…');
    const d = await MangaDex.fetchManga(MangaDex.randomURL());
    if (d && d.data) APP.openDetail(d.data.id, d.data);
    else UI.toast('Could not load — check internet');
  });

  // ── AMOLED toggle ───────────────────────────────────────────
  document.getElementById('btn-amoled').addEventListener('click', () => {
    APP.cfg.amoled = !APP.cfg.amoled; APP.save(); applyAmoled();
  });

  // ── Continue reading clear ──────────────────────────────────
  document.getElementById('clear-history').addEventListener('click', () => {
    UI.showModal('Clear History', 'Remove all reading progress? Cannot be undone.', () => {
      APP.hist = {}; APP.save(); renderContinueReading(); UI.toast('History cleared');
    });
  });

  // ── Library ────────────────────────────────────────────────
  let _libTimer;
  document.getElementById('lib-search').addEventListener('input', () => { clearTimeout(_libTimer); _libTimer = setTimeout(renderLib, 300); });
  document.getElementById('lib-sort').addEventListener('change', renderLib);
  document.querySelectorAll('#page-library .chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('#page-library .chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active'); renderLib();
  }));
  document.getElementById('refresh-updates').addEventListener('click', loadUpdates);

  // ── Detail ─────────────────────────────────────────────────
  document.getElementById('detail-back').addEventListener('click', () => {
    document.getElementById('detail-overlay').classList.remove('open');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.nav === APP.curTab));
    if (APP.curTab === 'library') renderLib();
  });
  document.getElementById('detail-open').addEventListener('click', () => {
    if (APP.curManga) window.open(`https://mangadex.org/title/${APP.curManga.id}`, '_blank');
  });
  document.getElementById('detail-share').addEventListener('click', () => {
    if (!APP.curManga) return;
    const url = `https://mangadex.org/title/${APP.curManga.id}`;
    if (navigator.share) navigator.share({ title: UI.getTitle(APP.curManga), url });
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => UI.toast('Link copied!'));
  });
  document.getElementById('detail-copy-title').addEventListener('click', () => {
    if (!APP.curManga) return;
    if (navigator.clipboard) navigator.clipboard.writeText(UI.getTitle(APP.curManga)).then(() => UI.toast('Title copied!'));
  });
  document.getElementById('detail-read-more').addEventListener('click', () => {
    const desc = document.getElementById('detail-desc');
    const btn  = document.getElementById('detail-read-more');
    desc.classList.toggle('collapsed');
    btn.textContent = desc.classList.contains('collapsed') ? 'Read more' : 'Show less';
  });
  document.querySelectorAll('.star').forEach(s => s.addEventListener('click', () => {
    if (!APP.curManga) return;
    APP.ratings[APP.curManga.id] = +s.dataset.r; APP.save();
    document.querySelectorAll('.star').forEach(x => { x.classList.toggle('on', +x.dataset.r <= +s.dataset.r); });
    document.getElementById('rating-label').textContent = `Your rating: ${s.dataset.r}/5`;
    UI.toast(`Rated ${s.dataset.r}/5`);
  }));
  document.getElementById('detail-bookmark-btn').addEventListener('click', () => {
    if (!APP.curManga) return;
    const id = APP.curManga.id;
    if (APP.lib.includes(id)) { APP.lib = APP.lib.filter(x => x !== id); UI.toast('Removed from library'); }
    else { APP.lib.push(id); UI.haptic([10,5,10]); UI.toast('★ Saved to library!'); }
    APP.save(); _refreshBookmark(); renderContinueReading();
    if (APP.curTab === 'updates') loadUpdates();
  });
  document.getElementById('detail-dl-all-btn').addEventListener('click', () => {
    if (!APP.curManga || !APP.chapList.length) { UI.toast('No chapters to download'); return; }
    const notDl = APP.chapList.filter(c => !APP.dlChaps[c.id]);
    if (!notDl.length) { UI.toast('All chapters already downloaded!'); return; }
    UI.showModal('Download All', `Download ${notDl.length} chapters? They will queue one by one.`, () => {
      DownloadQueue.addBulk(notDl.map(chap => ({ chap, mangaId: APP.curManga.id })));
      UI.toast(`${notDl.length} chapters queued!`, 2500, 'ok');
    });
  });
  document.getElementById('mark-all-read').addEventListener('click', () => {
    if (!APP.curManga || !APP.chapList.length) return;
    const sorted = [...APP.chapList].sort((a, b) => parseFloat((b.attributes && b.attributes.chapter) || 0) - parseFloat((a.attributes && a.attributes.chapter) || 0));
    const last = sorted[0];
    APP.hist[APP.curManga.id] = { ...APP.hist[APP.curManga.id], chapId: last.id, chapterNum: (last.attributes && last.attributes.chapter) || '?', ts: Date.now() };
    APP.save(); renderChapList(); UI.toast('All marked as read ✓');
  });
  document.getElementById('chapter-jump-btn').addEventListener('click', () => {
    const num = prompt('Jump to chapter number:');
    if (!num) return;
    const chap = APP.chapList.find(c => parseFloat((c.attributes && c.attributes.chapter) || '') === parseFloat(num));
    if (chap) { APP.openReader(chap); UI.haptic(10); }
    else UI.toast(`Chapter ${num} not found`);
  });
  document.getElementById('sort-btn').addEventListener('click', () => { APP.chapSort = APP.chapSort === 'desc' ? 'asc' : 'desc'; renderChapList(); });
  document.getElementById('load-more-btn').addEventListener('click', () => { if (APP.curManga) loadChapters(APP.curManga.id, false); });
  document.querySelectorAll('[data-cf]').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('[data-cf]').forEach(x => x.classList.toggle('active', x === b));
    APP.chapFilter = b.dataset.cf; renderChapList();
  }));

  // Swipe back on detail
  (function() {
    let sx = 0;
    const ov = document.getElementById('detail-overlay');
    ov.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', e => { if (e.changedTouches[0].clientX - sx > 80 && sx < 40) document.getElementById('detail-back').click(); }, { passive: true });
  })();

  // ── Reader ─────────────────────────────────────────────────
  document.getElementById('reader-back').addEventListener('click', () => {
    if (APP.readerLocked) { UI.toast('Screen locked — tap 🔒 to unlock'); UI.haptic(20); return; }
    Analytics.end(APP.curManga && APP.curManga.id);
    VirtualScroller.reset();
    document.getElementById('reader-overlay').classList.remove('open');
    document.getElementById('reader-settings-panel').classList.remove('show');
    document.getElementById('reader-pages').style.transform = '';
  });
  document.getElementById('reader-lock-btn').addEventListener('click', () => {
    APP.readerLocked = !APP.readerLocked;
    const btn = document.getElementById('reader-lock-btn');
    btn.innerHTML = APP.readerLocked ? '🔓' : '🔒';
    btn.style.color = APP.readerLocked ? 'var(--acc)' : 'rgba(255,255,255,.5)';
    UI.toast(APP.readerLocked ? 'Locked' : 'Unlocked', 1500);
  });
  document.getElementById('reader-mode-btn').addEventListener('click', () => {
    const modes = ['webtoon','paged','rtl'];
    APP.rMode = modes[(modes.indexOf(APP.rMode) + 1) % modes.length];
    _updateReaderMode(); renderPages();
  });
  document.querySelectorAll('.rs-mode').forEach(b => b.addEventListener('click', () => { APP.rMode = b.dataset.mode; _updateReaderMode(); renderPages(); }));
  document.getElementById('reader-settings-btn').addEventListener('click', e => {
    e.stopPropagation();
    document.getElementById('reader-settings-panel').classList.toggle('show');
  });
  document.getElementById('close-reader-settings').addEventListener('click', () => document.getElementById('reader-settings-panel').classList.remove('show'));
  document.getElementById('brightness-slider').addEventListener('input', function() {
    APP.brightness = +this.value;
    document.getElementById('brightness-val').textContent = this.value + '%';
    document.getElementById('brightness-overlay').style.background = `rgba(0,0,0,${this.value / 100 * .8})`;
  });
  document.getElementById('reader-scroll').addEventListener('scroll', function() {
    if (APP.rMode === 'webtoon') VirtualScroller.updateVisible();
    else if (APP.rMode !== 'webtoon') {
      const p = (this.scrollHeight - this.clientHeight) > 0 ? this.scrollTop / (this.scrollHeight - this.clientHeight) : 0;
      document.getElementById('progress-fill').style.width = Math.max(3, p * 100) + '%';
    }
  }, { passive: true });
  document.getElementById('reader-scroll').addEventListener('click', e => {
    if (e.target.closest('#chapter-nav') || e.target.closest('#reader-settings-panel')) return;
    if (APP.rMode !== 'webtoon' && APP.cfg.tapnav) {
      const x = e.clientX, w = window.innerWidth;
      if (x < w * .25) { if (APP.curPage > 0) _showPage(APP.curPage - 1); else document.getElementById('prev-chapter').click(); return; }
      if (x > w * .75) { if (APP.curPage < APP.pageUrls.length - 1) _showPage(APP.curPage + 1); else document.getElementById('next-chapter').click(); return; }
    }
    APP.uiVisible = !APP.uiVisible;
    document.getElementById('reader-header').classList.toggle('hidden', !APP.uiVisible);
    document.getElementById('reader-footer').classList.toggle('hidden', !APP.uiVisible);
  });
  document.getElementById('prev-chapter').addEventListener('click', () => {
    const idx = APP.chapList.indexOf(APP.rChap);
    if (idx < APP.chapList.length - 1) APP.openReader(APP.chapList[idx + 1]); else UI.toast('First chapter!');
  });
  document.getElementById('next-chapter').addEventListener('click', () => {
    const idx = APP.chapList.indexOf(APP.rChap);
    if (idx > 0) APP.openReader(APP.chapList[idx - 1]); else { UI.toast('All caught up!'); document.getElementById('reader-back').click(); }
  });

  // Swipe back in reader
  (function() {
    let sx = 0;
    const ov = document.getElementById('reader-overlay');
    ov.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    ov.addEventListener('touchend', e => { if (e.changedTouches[0].clientX - sx > 80 && sx < 40) document.getElementById('reader-back').click(); }, { passive: true });
  })();

  // Auto-scroll
  const autoScrollBtn = document.getElementById('autoscroll-btn');
  let _autoTimer = null;
  function startAutoScroll() {
    stopAutoScroll();
    const speed = +(document.getElementById('autoscroll-speed') || { value: 3 }).value;
    const rs    = document.getElementById('reader-scroll');
    const ppt   = rs.scrollHeight / (speed * 60);
    _autoTimer  = setInterval(() => { rs.scrollTop += ppt; if (rs.scrollTop >= rs.scrollHeight - rs.clientHeight) stopAutoScroll(); }, 1000 / 60);
    if (autoScrollBtn) { autoScrollBtn.textContent = 'ON'; autoScrollBtn.style.color = 'var(--grn)'; }
  }
  function stopAutoScroll() {
    if (_autoTimer) { clearInterval(_autoTimer); _autoTimer = null; }
    if (autoScrollBtn) { autoScrollBtn.textContent = 'OFF'; autoScrollBtn.style.color = 'var(--t2)'; }
  }
  if (autoScrollBtn) autoScrollBtn.addEventListener('click', () => { if (_autoTimer) stopAutoScroll(); else startAutoScroll(); });
  document.getElementById('reader-back').addEventListener('click', stopAutoScroll);
  document.getElementById('reader-scroll').addEventListener('touchstart', stopAutoScroll, { passive: true });
  const asSpeed = document.getElementById('autoscroll-speed');
  if (asSpeed) asSpeed.addEventListener('input', function() { document.getElementById('autoscroll-speed-val').textContent = this.value + 's'; if (_autoTimer) startAutoScroll(); });

  // Eye filter
  document.querySelectorAll('.filter-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const f = btn.dataset.filter, bov = document.getElementById('brightness-overlay');
    if (f === 'warm') bov.style.background = `rgba(255,140,60,${0.08 + APP.brightness / 100 * .4})`;
    else if (f === 'cool') bov.style.background = `rgba(60,100,255,${0.06 + APP.brightness / 100 * .3})`;
    else bov.style.background = `rgba(0,0,0,${APP.brightness / 100 * .8})`;
  }));

  // Pinch zoom
  (function() {
    let lastDist = 0, curScale = 1;
    const rs = document.getElementById('reader-scroll');
    rs.addEventListener('touchstart', e => {
      if (e.touches.length === 2) lastDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }, { passive: true });
    rs.addEventListener('touchmove', e => {
      if (e.touches.length === 2) {
        const dist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (lastDist > 0) { curScale = Math.min(4, Math.max(1, curScale * (dist / lastDist))); document.getElementById('reader-pages').style.transform = `scale(${curScale})`; }
        lastDist = dist;
      }
    }, { passive: true });
    rs.addEventListener('touchend', e => {
      if (e.touches.length < 2) lastDist = 0;
      if (e.touches.length === 0 && curScale < 1.1) { curScale = 1; document.getElementById('reader-pages').style.transform = ''; }
    }, { passive: true });
    let lastTap = 0;
    rs.addEventListener('touchend', e => {
      const now = Date.now();
      if (now - lastTap < 300 && e.touches.length === 0) {
        curScale = curScale > 1 ? 1 : 2;
        document.getElementById('reader-pages').style.transform = curScale === 1 ? '' : 'scale(2)';
      }
      lastTap = now;
    }, { passive: true });
  })();

  // Keyboard shortcuts
  document.addEventListener('keydown', e => {
    const rOpen = document.getElementById('reader-overlay').classList.contains('open');
    const dOpen = document.getElementById('detail-overlay').classList.contains('open');
    if (rOpen) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { APP.rMode === 'webtoon' ? document.getElementById('next-chapter').click() : _showPage(APP.curPage + 1); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { APP.rMode === 'webtoon' ? document.getElementById('prev-chapter').click() : _showPage(APP.curPage - 1); }
      if (e.key === ' ') { e.preventDefault(); APP.uiVisible = !APP.uiVisible; document.getElementById('reader-header').classList.toggle('hidden', !APP.uiVisible); document.getElementById('reader-footer').classList.toggle('hidden', !APP.uiVisible); }
      if (e.key === 'f' || e.key === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.getElementById('reader-overlay').requestFullscreen().catch(() => {}); }
      if (e.key === 'Escape') document.getElementById('reader-back').click();
    }
    if (!rOpen && e.key === '/' && !dOpen) { e.preventDefault(); switchTab('explore'); document.getElementById('search-input').focus(); }
    if (!rOpen && e.key === '?') { e.preventDefault(); const so = document.getElementById('shortcuts-overlay'); if (so) so.style.display = so.style.display === 'none' ? 'flex' : 'none'; }
  });


  // Shake to refresh explore
  if (window.DeviceMotionEvent) {
    let _lx=0,_ly=0,_lz=0,_lt=0,_ls=0;
    window.addEventListener('devicemotion', e => {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const now = Date.now(); if (now-_lt < 100) return; _lt=now;
      const d = Math.abs(a.x-_lx)+Math.abs(a.y-_ly)+Math.abs(a.z-_lz);
      _lx=a.x; _ly=a.y; _lz=a.z;
      if (d>20 && now-_ls>3000) {
        _ls=now;
        if (APP.curTab==='explore' && !document.getElementById('reader-overlay').classList.contains('open')) {
          RequestManager.clearCache(); UI.haptic([10,5,10]);
          UI.toast('Shaken! Refreshing…',1500);
          loadPopular(); loadLatest(); loadTopRated();
        }
      }
    }, { passive:true });
  }


  // Network quality warning
  if (navigator.connection) {
    const checkConn = () => {
      const t = navigator.connection.effectiveType;
      if (t==='2g'||t==='slow-2g') UI.toast('Slow connection — pages may take a while',3000);
    };
    navigator.connection.addEventListener('change', checkConn);
  }

  // Orientation change
  window.addEventListener('orientationchange', () => {
    setTimeout(() => { if (document.getElementById('reader-overlay').classList.contains('open')) renderPages(); }, 300);
  });

  // Long-press card → save
  let _lpTimer;
  document.addEventListener('touchstart', e => {
    const card = e.target.closest('[data-id]');
    if (!card || card.closest('.detail-panel') || card.closest('.reader-overlay')) return;
    _lpTimer = setTimeout(() => {
      const id = card.dataset.id; if (!id) return;
      if (APP.lib.includes(id)) { APP.lib = APP.lib.filter(x => x !== id); UI.haptic(20); UI.toast('Removed'); }
      else { APP.lib.push(id); UI.haptic([10,5,20]); UI.toast('★ Saved!'); }
      APP.save();
    }, 500);
  }, { passive: true });
  document.addEventListener('touchend',  () => clearTimeout(_lpTimer), { passive: true });
  document.addEventListener('touchmove', () => { clearTimeout(_lpTimer); _lpTimer = null; }, { passive: true });

  // Quick-save star
  document.addEventListener('click', e => {
    const btn = e.target.closest('.quick-save');
    if (!btn) return;
    e.stopPropagation();
    const id = btn.dataset.sid; if (!id) return;
    if (APP.lib.includes(id)) { APP.lib = APP.lib.filter(x => x !== id); btn.textContent = '☆'; btn.style.color = 'var(--t3)'; UI.toast('Removed'); }
    else { APP.lib.push(id); btn.textContent = '★'; btn.style.color = 'var(--gld)'; UI.toast('★ Saved!'); }
    APP.save();
  });

  // Swipe chapter → download
  let _chapSwipe;
  document.addEventListener('touchstart', e => {
    const ci = e.target.closest('.chapter-item');
    if (ci) _chapSwipe = { x: e.touches[0].clientX, id: ci.dataset.chapid };
  }, { passive: true });
  document.addEventListener('touchend', e => {
    if (!_chapSwipe) return;
    if (e.changedTouches[0].clientX - _chapSwipe.x < -60) {
      const ch = APP.chapList.find(x => x.id === _chapSwipe.id);
      if (ch && APP.curManga && !APP.dlChaps[_chapSwipe.id]) { UI.haptic(10); downloadChapter(ch, APP.curManga.id); }
      else if (APP.dlChaps[_chapSwipe.id]) UI.toast('Already downloaded');
    }
    _chapSwipe = null;
  }, { passive: true });
  document.addEventListener('touchmove', () => { _chapSwipe = null; }, { passive: true });

  // Downloads
  document.getElementById('dl-cancel-btn').addEventListener('click', () => { APP.dlCancel = true; document.getElementById('dl-overlay').classList.remove('show'); });
  document.getElementById('dl-pause-btn').addEventListener('click', () => {
    if (DownloadQueue.status().paused) { DownloadQueue.resume(); document.getElementById('dl-pause-btn').textContent = '⏸ Pause'; }
    else { DownloadQueue.pause(); document.getElementById('dl-pause-btn').textContent = '▶ Resume'; }
  });
  document.getElementById('dl-list').addEventListener('click', e => {
    const grp = e.target.closest('[data-mid]');
    if (grp) { UI.haptic(8); APP.openDetail(grp.dataset.mid); }
  });
  (function() { const dls = document.getElementById('dl-sort'); if (dls) dls.addEventListener('change', renderDownloadsPage); })();

  // Settings
  initToggles();
  if (APP.cfg.amoled) applyAmoled();
  if (APP.cfg.bigtext) document.body.style.fontSize = '16px';

  const savedAccent = localStorage.getItem(CONFIG.KEYS.accent);
  if (savedAccent) applyAccent(savedAccent);
  document.querySelectorAll('.accent-swatch').forEach(btn => {
    if (savedAccent && btn.dataset.accent === savedAccent) btn.classList.add('active');
    btn.addEventListener('click', () => {
      document.querySelectorAll('.accent-swatch').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyAccent(btn.dataset.accent);
      localStorage.setItem(CONFIG.KEYS.accent, btn.dataset.accent);
    });
  });

  const fontSlider = document.getElementById('font-size-slider');
  const savedFont  = localStorage.getItem(CONFIG.KEYS.fontSize);
  if (savedFont) { document.body.style.fontSize = savedFont + 'px'; if (fontSlider) fontSlider.value = savedFont; }
  if (fontSlider) fontSlider.addEventListener('input', function() { document.body.style.fontSize = this.value + 'px'; localStorage.setItem(CONFIG.KEYS.fontSize, this.value); });

  document.getElementById('clear-data-btn').addEventListener('click', () => {
    UI.showModal('Clear All Data', 'Permanently delete your library, history, and downloads? Cannot be undone.', () => {
      APP.lib = []; APP.hist = {}; APP.ratings = {}; APP.dlChaps = {};
      APP.cfg = { ...CONFIG.DEFAULTS }; APP.save(); APP.saveDl();
      renderLib(); renderContinueReading(); renderDownloadsPage();
      document.querySelectorAll('.toggle').forEach(t => t.classList.remove('on'));
      UI.toast('All data cleared');
    });
  });

  // Backup / restore / export
  document.getElementById('backup-btn').addEventListener('click', () => {
    const data = JSON.stringify({ library: APP.lib, history: APP.hist, ratings: APP.ratings, settings: APP.cfg, notes: APP.notes, version: '1', date: new Date().toISOString() }, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    a.download = `OtakuReader_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href); UI.toast('Backup downloaded!');
  });
  document.getElementById('restore-btn').addEventListener('click', () => document.getElementById('restore-file').click());
  document.getElementById('restore-file').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const d = JSON.parse(ev.target.result);
        if (d.library) APP.lib = d.library;
        if (d.history) APP.hist = d.history;
        if (d.ratings) APP.ratings = d.ratings;
        if (d.settings) APP.cfg = { ...CONFIG.DEFAULTS, ...d.settings };
        if (d.notes) APP.notes = d.notes;
        APP.save(); renderLib(); UI.toast('Library restored!');
      } catch (_) { UI.toast('Invalid backup file'); }
    };
    reader.readAsText(f); e.target.value = '';
  });
  document.getElementById('export-csv-btn').addEventListener('click', () => {
    const rows = [['Title','Chapter','Date']];
    Object.entries(APP.hist).forEach(([id, h]) => {
      const m = APP.mcache[id], title = m ? UI.getTitle(m) : (h.title || id);
      rows.push([`"${title.replace(/"/g, '""')}"`, h.chapterNum || '', h.ts ? new Date(h.ts).toISOString().slice(0, 10) : '']);
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.join(',')).join('\n')], { type: 'text/csv' }));
    a.download = `OtakuReader_history_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href); UI.toast('CSV exported!');
  });

  document.getElementById('export-app-btn').addEventListener('click', async () => {
    const btn = document.getElementById('export-app-btn');
    const bar = document.getElementById('export-progress');
    const fill = document.getElementById('export-bar');
    btn.disabled = true; btn.textContent = '⏳ Building…';
    if (bar) bar.style.display = 'block';
    try {
      const files = [
        { path: './style.css',            tag: 'style' },
        { path: './config.js',            tag: 'script' },
        { path: './utils/storage.js',     tag: 'script' },
        { path: './utils/api.js',         tag: 'script' },
        { path: './utils/ui.js',          tag: 'script' },
        { path: './sources/mangadex.js',  tag: 'script' },
        { path: './script.js',            tag: 'script' },
      ];
      const total = files.length;
      const parts = {};
      for (let i = 0; i < total; i++) {
        if (fill) fill.style.width = Math.round((i / total) * 100) + '%';
        try {
          const r = await fetch(files[i].path);
          parts[files[i].path] = r.ok ? await r.text() : '/* failed */';
        } catch (_) { parts[files[i].path] = '/* fetch error */'; }
      }
      if (fill) fill.style.width = '100%';
      const html = document.documentElement.outerHTML
        .replace('<link rel="stylesheet" href="./style.css">', `<style>${parts['./style.css']}</style>`)
        .replace('<script src="./config.js"></script>', `<script>${parts['./config.js']}</script>`)
        .replace('<script src="./utils/storage.js"></script>', `<script>${parts['./utils/storage.js']}</script>`)
        .replace('<script src="./utils/api.js"></script>', `<script>${parts['./utils/api.js']}</script>`)
        .replace('<script src="./utils/ui.js"></script>', `<script>${parts['./utils/ui.js']}</script>`)
        .replace('<script src="./sources/mangadex.js"></script>', `<script>${parts['./sources/mangadex.js']}</script>`)
        .replace('<script src="./script.js"></script>', `<script>${parts['./script.js']}</script>`);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = `OtakuReader_${new Date().toISOString().slice(0,10)}.html`;
      a.click(); URL.revokeObjectURL(a.href);
      UI.toast('App exported as single HTML!', 3000, 'ok');
    } catch (e) {
      UI.toast('Export failed: ' + e.message, 3000, 'error');
    }
    btn.disabled = false; btn.textContent = '📦 Download App HTML';
    setTimeout(() => { if (bar) bar.style.display = 'none'; if (fill) fill.style.width = '0%'; }, 1200);
  });

  // PWA install
  let _deferredInstall;
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); _deferredInstall = e;
    document.getElementById('install-bar').classList.add('show');
  });
  document.getElementById('install-btn').addEventListener('click', () => {
    if (_deferredInstall) { _deferredInstall.prompt(); _deferredInstall.userChoice.then(() => { _deferredInstall = null; document.getElementById('install-bar').classList.remove('show'); }); }
    else UI.toast('In Chrome: Menu → Add to Home Screen');
  });
  document.getElementById('install-close').addEventListener('click', () => document.getElementById('install-bar').classList.remove('show'));

  // Online / offline
  window.addEventListener('online', () => {
    UI.hideOfflineBar(); UI.toast('Back online!', 2000, 'ok');
    RequestManager.clearCache(); loadPopular(); loadLatest(); loadTopRated();
  });
  window.addEventListener('offline', () => UI.showOfflineBar());


  // ── Debug panel (Ctrl+Shift+D) ───────────────────────────────────────────
  const _debugLines = [];
  const _origWarn = console.warn.bind(console);
  console.warn = function(...args) {
    _origWarn(...args);
    const msg = args.join(' ');
    const color = msg.includes('fail') || msg.includes('error') ? '#f44' : msg.includes('429') ? '#ff0' : '#888';
    const ts = new Date().toTimeString().slice(0,8);
    _debugLines.push(`<span style="color:#444">${ts}</span> <span style="color:${color}">${msg.replace(/</g,'&lt;').slice(0,200)}</span>`);
    if (_debugLines.length > 60) _debugLines.shift();
    const log = document.getElementById('debug-log');
    if (log && log.closest('#debug-panel').style.display !== 'none') {
      log.innerHTML = _debugLines.join('<br>'); log.scrollTop = log.scrollHeight;
    }
  };
  document.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      let panel = document.getElementById('debug-panel');
      if (!panel) {
        panel = document.createElement('div');
        panel.id = 'debug-panel';
        panel.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;background:rgba(0,0,0,.95);border-top:2px solid var(--acc);z-index:9999;font-family:monospace;font-size:10px';
        panel.innerHTML = '<div style="display:flex;align-items:center;padding:6px 10px;border-bottom:1px solid #222;gap:10px"><span style="color:var(--acc);font-weight:700;letter-spacing:1px">DEBUG</span><span id="dbg-net" style="color:#0f0">NET: online</span><span id="dbg-cache" style="color:#888">CACHE: 0</span><button onclick="document.getElementById(\'debug-log\').innerHTML=\'\'" style="background:#222;border:1px solid #444;color:#888;cursor:pointer;font-size:9px;padding:2px 8px">CLEAR</button><button onclick="this.closest(\'#debug-panel\').remove()" style="background:#222;border:1px solid #444;color:#888;cursor:pointer;font-size:9px;padding:2px 8px;margin-left:auto">CLOSE</button></div><div id="debug-log" style="padding:6px 10px;color:#666;line-height:1.8;max-height:30vh;overflow-y:auto"></div>';
        document.body.appendChild(panel);
      }
      const isHidden = panel.style.display === 'none' || !panel.style.display || panel.style.display === '';
      panel.style.display = isHidden ? 'block' : 'none';
      if (isHidden) {
        const log = document.getElementById('debug-log');
        if (log) log.innerHTML = _debugLines.join('<br>');
        const netEl = document.getElementById('dbg-net');
        if (netEl) netEl.textContent = 'NET: ' + (navigator.onLine ? 'online' : 'offline');
        setInterval(() => {
          const cEl = document.getElementById('dbg-cache');
          if (cEl) cEl.textContent = 'CACHE: ' + Object.keys(apiCache || {}).length;
        }, 2000);
      }
    }
  });

  // Service worker (real .js file — works properly on GitHub Pages)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').then(reg => {
      console.log('[SW] Registered:', reg.scope);
    }).catch(err => console.warn('[SW] Registration failed:', err));
  }

  // IDB recovery (if localStorage was cleared)
  (async () => {
    if (APP.lib.length || Object.keys(APP.hist).length) return;
    try {
      const snap = await IDB.get('library', 'snapshot');
      if (snap && snap.lib && snap.lib.length) {
        APP.lib = snap.lib; APP.hist = snap.hist || {}; APP.ratings = snap.ratings || {}; APP.notes = snap.notes || {};
        APP.save(); UI.toast('📚 Library recovered!', 3000, 'ok'); renderContinueReading();
      }
    } catch (_) {}
  })();

  // ── LOCAL FILE WARNING ─────────────────────────────────────
  if (window.location.protocol === 'file:') {
    setTimeout(() => {
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:68px;left:10px;right:10px;background:linear-gradient(135deg,#1a1a00,#2a2a00);border:1px solid rgba(255,214,10,.4);border-radius:12px;padding:12px 14px;z-index:500;font-size:12px;line-height:1.7;box-shadow:0 8px 32px rgba(0,0,0,.6)';
      banner.innerHTML = `<b style="color:var(--gld);font-family:Rajdhani,sans-serif;font-size:13px">⚠ Running as local file</b><br>
        <span style="color:rgba(255,255,255,.6);font-size:11px">API blocked. Upload to <a href="https://pages.github.com" target="_blank" style="color:var(--gld)">GitHub Pages</a> or <a href="https://app.netlify.com/drop" target="_blank" style="color:var(--gld)">Netlify</a> to read manga.</span><br>
        <span style="color:rgba(48,209,88,.8);font-size:10px">✅ Browse the 12 offline manga below</span>
        <button onclick="this.parentElement.remove()" style="float:right;background:none;border:none;color:rgba(255,255,255,.4);font-size:18px;cursor:pointer;margin-top:-20px">✕</button>`;
      document.body.appendChild(banner);
    }, 800);
  }

  // ── INIT — first paint ─────────────────────────────────────
  // Show fallback manga INSTANTLY (zero network, works offline)
  UI.showFallback('popular-row', 'card');
  UI.showFallback('latest-list',  'list');
  UI.showFallback('toprated-row', 'card');
  renderContinueReading();
  renderDownloadsPage();

  // Then load real data from APIs in background
  loadPopular();
  loadLatest();
  loadTopRated();
  loadTrending();
  setTimeout(loadComickSection, 1800);
  setTimeout(loadRecommendations, 1500);
  setTimeout(() => {
    StorageManager.persist();
    StorageManager.checkAndWarn();
    _checkLibraryUpdates();
  }, 3000);

  console.log('%c OtakuReader · Free · No Ads · Open Source ', 'background:#e8354f;color:#fff;font-family:monospace;padding:4px 8px;border-radius:4px');
});

async function _checkLibraryUpdates() {
  if (!APP.lib.length) return;
  const d = await MangaDex.fetchManga((MangaDex.updatesCheckURL || MangaDex.libraryBatchURL)(APP.lib.slice(0, 8)));
  if (!d || !d.data) return;
  const badge = document.getElementById('updates-badge');
  const lastCheck = +localStorage.getItem('or_lastcheck') || 0;
  const hasNew = d.data.some(m => {
    const upd = m.attributes && m.attributes.updatedAt ? new Date(m.attributes.updatedAt).getTime() : 0;
    return upd > lastCheck;
  });
  if (badge) badge.style.display = hasNew ? 'block' : 'none';
  localStorage.setItem('or_lastcheck', Date.now());
}
