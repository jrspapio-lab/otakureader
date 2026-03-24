// ═══════════════════════════════════════════════════════════
// OtakuReader — utils/ui.js
// All DOM rendering: cards, lists, spinners, toasts, overlays.
// ═══════════════════════════════════════════════════════════

'use strict';

// ── SVG placeholder cover (zero network, works offline) ──────────────────────
function makeSVGCover(title, type, c1, c2) {
  const initials = title.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase() || (title[0] || '?').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 280">
    <defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${c1}"/>
      <stop offset="100%" style="stop-color:${c2}"/>
    </linearGradient></defs>
    <rect width="200" height="280" fill="url(#g)"/>
    <rect x="0" y="210" width="200" height="70" fill="rgba(0,0,0,0.65)"/>
    <text x="100" y="125" font-family="Arial,sans-serif" font-size="62" font-weight="bold"
      fill="rgba(255,255,255,0.92)" text-anchor="middle" dominant-baseline="middle">${initials}</text>
    <text x="100" y="237" font-family="Arial,sans-serif" font-size="11"
      fill="rgba(255,255,255,0.85)" text-anchor="middle">${title.slice(0, 22)}</text>
    <text x="100" y="258" font-family="Arial,sans-serif" font-size="9"
      fill="rgba(255,255,255,0.45)" text-anchor="middle">${type.toUpperCase()}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

// Build the offline-first fallback items (no network needed)
function buildFallbackItems() {
  return CONFIG.FALLBACK_MANGA.map(fb => ({
    id: fb.id,
    _fallback: true,
    attributes: {
      title: { en: fb.title },
      description: { en: fb.title + ' — tap to load full details.' },
      status: fb.status,
      year: fb.year,
      originalLanguage: fb.type === 'manhwa' ? 'ko' : fb.type === 'manhua' ? 'zh' : 'ja',
      tags: fb.tags.map(t => ({ attributes: { name: { en: t } } })),
    },
    relationships: [
      { type: 'author',    attributes: { name: fb.author } },
      { type: 'cover_art', attributes: { fileName: '' }, _directUrl: makeSVGCover(fb.title, fb.type, fb.colors[0], fb.colors[1]) },
    ],
  }));
}

// ── Data helpers ──────────────────────────────────────────────────────────────
function getTitle(m) {
  const t = (m.attributes && m.attributes.title) || {};
  return t.en || t['ja-ro'] || t.zh || Object.values(t)[0] || 'Untitled';
}
function getAuthor(m) {
  const a = (m.relationships || []).find(r => r.type === 'author');
  return a && a.attributes && a.attributes.name ? a.attributes.name : 'Unknown';
}
function getType(m) {
  const o = (m.attributes && m.attributes.originalLanguage) || '';
  return o === 'ko' ? 'manhwa' : (o === 'zh' || o === 'zh-hk') ? 'manhua' : 'manga';
}
function getDesc(m) {
  const d = (m.attributes && m.attributes.description) || {};
  return d.en || d['en-us'] || Object.values(d)[0] || 'No description available.';
}
function getCover(m) {
  const direct = (m.relationships || []).find(r => r.type === 'cover_art' && r._directUrl);
  if (direct) return direct._directUrl;
  const c = (m.relationships || []).find(r => r.type === 'cover_art');
  if (c && c.attributes && c.attributes.fileName) {
    const q = APP.cfg.datasaver ? '.256.jpg' : '.512.jpg';
    return `${CONFIG.MANGADEX_CDN}/covers/${m.id}/${c.attributes.fileName}${q}`;
  }
  return '';
}
function typeColor(t) {
  return t === 'manhwa' ? '#0a84ff' : t === 'manhua' ? '#ff9f0a' : '#e8354f';
}
function isDownloaded(mangaId) {
  return Object.values(APP.dlChaps || {}).some(c => c.mangaId === mangaId);
}

// ── Card builders ─────────────────────────────────────────────────────────────
function buildCard(m) {
  const cov   = getCover(m), title = getTitle(m);
  const type  = getType(m),  tc    = typeColor(type);
  const saved = APP.lib.includes(m.id);
  const hasDl = isDownloaded(m.id);
  const hasH  = !!APP.hist[m.id];
  return `<div class="manga-card fade-up" data-id="${m.id}">
    <div class="card-cover">
      ${cov ? `<img src="${cov}" alt="" loading="lazy" crossorigin="anonymous" onerror="this.onerror=null;this.style.display='none'">` : ''}
      <div class="card-fallback">${title[0] || '?'}</div>
      <div class="card-type-badge" style="background:${tc}22;color:${tc};border:1px solid ${tc}44">${type.toUpperCase()}</div>
      <div class="card-saved-badge${saved ? ' show' : ''}">★</div>
      <div class="card-dl-badge${hasDl ? ' show' : ''}">DL</div>
    </div>
    <div class="card-title">${title}</div>
    <div class="card-year">${(m.attributes && m.attributes.year) || ''}</div>
  </div>`;
}

function buildListCard(m) {
  const cov  = getCover(m), title = getTitle(m);
  const type = getType(m),  tc    = typeColor(type);
  const tags = ((m.attributes && m.attributes.tags) || []).slice(0, 2)
    .map(t => t.attributes && t.attributes.name && t.attributes.name.en).filter(Boolean);
  const saved = APP.lib.includes(m.id);
  return `<div class="list-card fade-up" data-id="${m.id}">
    <div class="list-cover">
      ${cov ? `<img src="${cov}" alt="" loading="lazy" crossorigin="anonymous" onerror="this.onerror=null;this.style.display='none'">` : ''}
      <div class="card-fallback">${title[0] || '?'}</div>
    </div>
    <div class="list-info">
      <div class="list-title">${title}</div>
      <div class="list-meta">${getAuthor(m)}${m.attributes && m.attributes.year ? ' · ' + m.attributes.year : ''}</div>
      <div class="list-tags">
        <span class="tag" style="color:${tc};background:${tc}18">${type}</span>
        ${tags.map(t => `<span class="tag">${t}</span>`).join('')}
        ${m.attributes && m.attributes.status === 'ongoing' ? '<span class="tag ongoing">Ongoing</span>' : ''}
      </div>
    </div>
    <div class="list-end">
      <button class="quick-save" data-sid="${m.id}" title="Save to library">${saved ? '★' : '☆'}</button>
      <span class="list-arrow">›</span>
    </div>
  </div>`;
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function spinner(label = 'Loading...') {
  return `<div class="spinner-wrap"><div class="spinner"></div><div class="spinner-label">${label}</div></div>`;
}

// ── Toast ─────────────────────────────────────────────────────────────────────
let _toastTimer;
function toast(msg, dur = 2500, type = '') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (type === 'error' ? ' toast-error' : type === 'ok' ? ' toast-ok' : '');
  // Move toast above detail overlay if it's open
  el.style.bottom = document.getElementById('detail-overlay').classList.contains('open') ? '20px' : '';
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), dur);
}

// ── Offline bar ───────────────────────────────────────────────────────────────
function showOfflineBar() {
  let bar = document.getElementById('offline-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'offline-bar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;background:#e8354f;color:#fff;font-family:monospace;font-size:11px;text-align:center;padding:7px 14px;letter-spacing:.5px';
    bar.innerHTML = 'NO INTERNET — manga will show when connected &nbsp;<button onclick="location.reload()" style="background:rgba(255,255,255,.2);border:none;color:#fff;padding:2px 8px;border-radius:4px;font-size:10px;cursor:pointer">Retry</button>';
    document.body.prepend(bar);
  }
  bar.style.display = 'block';
}
function hideOfflineBar() {
  const bar = document.getElementById('offline-bar');
  if (bar) bar.style.display = 'none';
}

// ── Delegate click events for dynamic content ─────────────────────────────────
// Attaches a single click handler that bubbles up to open detail
function delegate(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.addEventListener('click', e => {
    const card = e.target.closest('[data-id]');
    if (card) { haptic(8); APP.openDetail(card.dataset.id); }
  });
}

// ── Intersection Observer: lazy load images ───────────────────────────────────
const _imgObserver = new IntersectionObserver(entries => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const img = entry.target;
      if (img.dataset.src) {
        img.src = img.dataset.src;
        img.removeAttribute('data-src');
        _imgObserver.unobserve(img);
      }
    }
  });
}, { rootMargin: '200px' });

function patchImagesForIO(containerId) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.querySelectorAll('img[loading="lazy"]').forEach(img => {
    if (img.src && !img.dataset.src) {
      img.dataset.src = img.src;
      img.src = '';
      _imgObserver.observe(img);
    }
  });
}

// ── Show fallback manga when API fails ────────────────────────────────────────
function showFallback(containerId, type = 'card') {
  const el = document.getElementById(containerId);
  if (!el) return;
  const items = buildFallbackItems();
  items.forEach(m => { APP.mcache[m.id] = m; });
  if (type === 'card') {
    el.innerHTML = items.slice(0, 8).map(buildCard).join('');
  } else {
    el.innerHTML = items.slice(0, 6).map(buildListCard).join('');
  }
  delegate(containerId);
  patchImagesForIO(containerId);
}

// ── Haptic feedback ───────────────────────────────────────────────────────────
function haptic(pattern) {
  if (navigator.vibrate) navigator.vibrate(pattern);
}

// ── Custom modal (replaces browser confirm()) ─────────────────────────────────
function showModal(title, msg, onOk) {
  const ov = document.getElementById('modal-overlay');
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-msg').textContent   = msg;
  ov.style.display = 'flex';
  const ok     = document.getElementById('modal-ok');
  const cancel = document.getElementById('modal-cancel');
  const close  = () => {
    ov.style.display = 'none';
    ok.replaceWith(ok.cloneNode(true));
    cancel.replaceWith(cancel.cloneNode(true));
  };
  document.getElementById('modal-ok')    .addEventListener('click', () => { close(); haptic(10); onOk(); }, { once: true });
  document.getElementById('modal-cancel').addEventListener('click', () => { close(); haptic(5); }, { once: true });
}


// ═══════════════════════════════════════════════════════════════════════════
// REQUIRED RENDER FUNCTIONS (spec requirement)
// These translate API data → DOM.
// Each updates a dedicated container element in index.html.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * renderSearchResults(results, containerId)
 * Renders an array of MangaDex manga objects as list cards.
 * @param {Array}  results     - array of normalised manga objects
 * @param {string} containerId - id of the container element (default 'results-list')
 */
function renderSearchResults(results, containerId = 'results-list') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!results || !results.length) {
    el.innerHTML = '<div class="no-results">No results found.<br>Try different keywords or check your connection.</div>';
    return;
  }
  el.innerHTML = results.map(buildListCard).join('');
  results.forEach(m => { if (APP && APP.mcache) APP.mcache[m.id] = m; });
  // Use delegation via replaceWith to clear any prior listeners, then re-attach once
  const fresh = el.cloneNode(false);
  fresh.innerHTML = el.innerHTML;
  el.parentNode && el.parentNode.replaceChild(fresh, el);
  fresh.addEventListener('click', e => {
    const card = e.target.closest('[data-id]');
    if (card && typeof APP !== 'undefined' && APP.openDetail) {
      haptic(8); APP.openDetail(card.dataset.id);
    }
  });
  if (typeof patchImagesForIO === 'function') patchImagesForIO(containerId);
}

/**
 * renderMangaDetails(manga)
 * Populates the detail overlay with metadata for one manga.
 * @param {Object} manga - normalised manga object
 */
function renderMangaDetails(manga) {
  if (!manga || !manga.attributes) return;
  const title  = getTitle(manga);
  const author = getAuthor(manga);
  const desc   = getDesc(manga);
  const cov    = getCover(manga);
  const type   = getType(manga);
  const tc     = typeColor(type);
  const tags   = ((manga.attributes.tags) || []).slice(0, 8)
    .map(t => t.attributes && t.attributes.name && t.attributes.name.en).filter(Boolean);

  // Blur hero background
  const blur = document.getElementById('detail-blur');
  if (blur) blur.style.backgroundImage = cov ? `url('${cov}')` : 'linear-gradient(135deg,#0a0a20,#1a1a3e)';

  // Cover image
  const ci = document.getElementById('detail-cover');
  const cf = document.getElementById('detail-cover-fallback');
  if (ci) { ci.src = cov || ''; ci.style.display = cov ? '' : 'none'; }
  if (cf) cf.textContent = title[0] || '?';

  // Type badge
  const typeEl = document.getElementById('detail-type');
  if (typeEl) { typeEl.textContent = type.toUpperCase(); typeEl.style.color = tc; }

  // Text fields
  _setText('detail-title',  title);
  _setText('detail-author', 'by ' + author);
  _setText('detail-year',   (manga.attributes.year) || '—');

  // Status (colour-coded)
  const statusEl = document.getElementById('detail-status');
  if (statusEl) {
    const st = manga.attributes.status || '—';
    statusEl.textContent = st;
    statusEl.style.color = st === 'ongoing' ? 'var(--grn)' : st === 'completed' ? 'var(--blu)' : 'var(--acc)';
  }

  // Description (collapsed by default, with read-more)
  const descEl = document.getElementById('detail-desc');
  if (descEl) { descEl.textContent = desc; descEl.className = 'detail-desc collapsed'; }
  const readMoreEl = document.getElementById('detail-read-more');
  if (readMoreEl) readMoreEl.textContent = 'Read more';

  // Genre pills — tappable to search that genre
  const genresEl = document.getElementById('detail-genres');
  if (genresEl) {
    genresEl.innerHTML = tags.map(t =>
      `<span class="genre-pill" onclick="searchByTag('${t}')" style="cursor:pointer">${t}</span>`
    ).join('') + `<span class="genre-pill" style="color:${tc};border-color:${tc}44;cursor:pointer" onclick="doSearch()">${type}</span>`;
  }
}

/**
 * renderChapters(chapters, containerId)
 * Renders a chapter list inside the detail overlay.
 * @param {Array}  chapters    - array of chapter objects (MangaDex feed format)
 * @param {string} containerId - target element id (default 'chapters-list')
 */
function renderChapters(chapters, containerId = 'chapters-list') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!chapters || !chapters.length) {
    el.innerHTML = '<div class="error-box">No English chapters found yet.</div>';
    return;
  }
  el.innerHTML = chapters.slice(0, 80).map(c => {
    const num   = (c.attributes && c.attributes.chapter) || '?';
    const title = (c.attributes && c.attributes.title)   || '';
    const date  = (c.attributes && c.attributes.publishAt) ? c.attributes.publishAt.slice(0, 10) : '';
    const read  = APP && APP.hist && APP.curManga &&
                  APP.hist[APP.curManga.id] &&
                  parseFloat(num) < parseFloat((APP.hist[APP.curManga.id].chapterNum) || 0);
    const dl    = APP && APP.dlChaps && !!APP.dlChaps[c.id];
    return `<div class="chapter-item" data-chapid="${c.id}">
      <div class="chapter-info">
        <div class="chapter-num${read ? ' read' : ''}">${read ? '✓ ' : ''}Chapter ${num}${title ? ' — ' + title : ''}${dl ? ' 💾' : ''}</div>
        <div class="chapter-date">${date}</div>
      </div>
      <button class="chapter-dl-btn${dl ? ' downloaded' : ''}" data-dlbtn="${c.id}">${dl ? '✅' : '⬇'}</button>
      <div class="chapter-dot${read ? ' read' : ''}"></div>
    </div>`;
  }).join('') + (chapters.length > 80 ? `<div class="no-results" style="padding:8px 14px;font-size:11px">Showing 80 of ${chapters.length} chapters</div>` : '');
}

/**
 * renderReader(pageUrls, containerId)
 * Renders manga page images vertically inside the reader.
 * Supports VirtualScroller when available; falls back to static <img> list.
 * @param {string[]} pageUrls   - array of image URLs
 * @param {string}   containerId - target element id (default 'reader-pages')
 */
function renderReader(pageUrls, containerId = 'reader-pages') {
  const el = document.getElementById(containerId);
  if (!el) return;
  if (!pageUrls || !pageUrls.length) {
    el.innerHTML = '<div class="error-box" style="margin:40px auto;max-width:400px"><b>No pages found.</b><br>This chapter may not be available.</div>';
    return;
  }
  // Use VirtualScroller if in scope (handles 200+ pages efficiently)
  if (typeof VirtualScroller !== 'undefined') {
    el.innerHTML = '';
    VirtualScroller.init(pageUrls, el);
    return;
  }
  // Fallback: render all images statically (works for short chapters)
  el.innerHTML = pageUrls.map((url, i) =>
    `<img src="${url}" alt="Page ${i + 1}" crossorigin="anonymous" loading="lazy"
      style="width:100%;display:block;max-width:800px;margin:0 auto"
      onerror="this.style.background='var(--bg4)';this.style.minHeight='400px'">`
  ).join('');
}

// ── Private helper ────────────────────────────────────────────────────────────
function _setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}


// Expose to global
const UI = { showOfflineBar, hideOfflineBar, toast, showFallback, delegate,
             patchImagesForIO, buildCard, buildListCard, spinner, showModal,
             haptic, getTitle, getAuthor, getType, getDesc, getCover, typeColor,
             isDownloaded, buildFallbackItems,
             renderSearchResults, renderMangaDetails, renderChapters, renderReader };
