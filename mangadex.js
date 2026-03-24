// ═══════════════════════════════════════════════════════════
// OtakuReader — sources/mangadex.js
// MangaDex API source.
// All endpoints, normalizers, and chapter/page loaders.
// To add a new source: copy this file and adapt the functions.
// ═══════════════════════════════════════════════════════════

'use strict';

const MangaDex = (() => {
  const API = CONFIG.MANGADEX_API;
  const CDN = CONFIG.MANGADEX_CDN;

  // ── URL builders ──────────────────────────────────────────
  function popularURL()    { return `${API}/manga?limit=12&order[followedCount]=desc&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=en`; }
  function latestURL()     { return `${API}/manga?limit=15&order[updatedAt]=desc&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=en`; }
  function topRatedURL()   { return `${API}/manga?limit=12&order[rating]=desc&includes[]=cover_art&includes[]=author&contentRating[]=safe&availableTranslatedLanguage[]=en`; }
  function randomURL()     { return `${API}/manga/random?includes[]=cover_art&includes[]=author&contentRating[]=safe`; }
  function detailURL(id)   { return `${API}/manga/${id}?includes[]=cover_art&includes[]=author`; }
  function statsURL(id)    { return `${API}/statistics/manga/${id}`; }
  function atHomeURL(id)   { return `${API}/at-home/server/${id}`; }

  function chaptersURL(mangaId, offset = 0) {
    return `${API}/manga/${mangaId}/feed?limit=96&offset=${offset}&order[chapter]=desc&translatedLanguage[]=en&contentRating[]=safe&contentRating[]=suggestive`;
  }
  function searchURL(query, sortVal, tagId, lang, offset = 0) {
    let url = `${API}/manga?limit=24&offset=${offset}&includes[]=cover_art&includes[]=author&contentRating[]=safe&contentRating[]=suggestive&availableTranslatedLanguage[]=en`;
    if (sortVal && sortVal !== 'relevance') url += `&order[${sortVal}]=desc`;
    if (query)  url += `&title=${encodeURIComponent(query)}`;
    if (tagId)  url += `&includedTags[]=${tagId}`;
    if (lang)   url += `&originalLanguage[]=${lang}`;
    return url;
  }
  function trendingURL(tagId) {
    return `${API}/manga?limit=10&includedTags[]=${tagId}&order[followedCount]=desc&includes[]=cover_art&includes[]=author&contentRating[]=safe&availableTranslatedLanguage[]=en`;
  }
  function updatesCheckURL(ids) {
    return `${API}/manga?${ids.map(id => `ids[]=${id}`).join('&')}&includes[]=cover_art&includes[]=author&limit=8&order[updatedAt]=desc`;
  }
  function libraryBatchURL(ids) {
    return `${API}/manga?${ids.map(id => `ids[]=${id}`).join('&')}&includes[]=cover_art&includes[]=author&limit=100`;
  }
  function recommendURL(tagId, excludeIds) {
    let url = `${API}/manga?limit=8&includes[]=cover_art&includes[]=author&contentRating[]=safe&availableTranslatedLanguage[]=en&order[rating]=desc`;
    if (tagId) url += `&includedTags[]=${tagId}`;
    if (excludeIds && excludeIds.length) url += '&' + excludeIds.slice(0, 5).map(id => `excludedIds[]=${id}`).join('&');
    return url;
  }

  // ── Fetch wrappers ────────────────────────────────────────
  // All fetch calls use fetchWithProxy (spec requirement: always proxy through corsproxy.io)
  // fetchWithProxy returns a Response; .json() parses it.
  // Falls back to api() (RequestManager) which has full retry/rotation.
  async function _fetch(url) {
    try {
      const resp = await fetchWithProxy(url);
      if (resp && resp.ok) return resp.json();
    } catch (_) {}
    return api(url); // fallback to RequestManager with full retry chain
  }
  async function fetchManga(url)     { return _fetch(url); }
  async function fetchChapters(url)  { return _fetch(url); }
  async function fetchAtHome(chapId) { return _fetch(atHomeURL(chapId)); }
  async function fetchStats(mangaId) { return _fetch(statsURL(mangaId)); }

  // ── Page URL builder from at-home response ────────────────
  function buildPageURLs(ah) {
    if (!ah || !ah.baseUrl || !ah.chapter || !ah.chapter.data) return [];
    return ah.chapter.data.map(f => `${ah.baseUrl}/data/${ah.chapter.hash}/${f}`);
  }

  // ── Stats parser ──────────────────────────────────────────
  function parseStats(d, mangaId) {
    if (!d || !d.statistics || !d.statistics[mangaId]) return null;
    const s = d.statistics[mangaId];
    return {
      rating:   s.rating && s.rating.bayesian ? (+s.rating.bayesian).toFixed(2) : null,
      follows:  s.follows || 0,
      comments: s.comments && s.comments.repliesCount || 0,
    };
  }

  return {
    popularURL, latestURL, topRatedURL, randomURL, detailURL, chaptersURL,
    searchURL, trendingURL, libraryBatchURL, recommendURL, updatesCheckURL,
    fetchManga, fetchChapters, fetchAtHome, fetchStats,
    buildPageURLs, parseStats,
  };
})();

// ═══════════════════════════════════════════════════════════
// ComicK source — second source for more manga coverage
// To add YOUR source: copy this block, adapt to your API
// ═══════════════════════════════════════════════════════════
const ComicK = (() => {
  const API = CONFIG.COMICK_API;

  // Normalizer: ComicK JSON → app internal format
  function normalize(m) {
    const lang = m.country === 'kr' ? 'ko' : m.country === 'cn' ? 'zh' : 'ja';
    const coverUrl = m.cover_url
      || (m.md_covers && m.md_covers[0] && `https://meo.comick.pictures/${m.md_covers[0].b2key}`)
      || '';
    return {
      id: 'comick:' + (m.hid || m.slug),
      _source: 'comick',
      _comickHid: m.hid,
      attributes: {
        title: { en: m.title || m.slug || 'Unknown' },
        description: { en: (m.desc || m.summary || '').replace(/<[^>]*>/g, '') || '—' },
        status: m.status === 2 ? 'completed' : 'ongoing',
        year: m.year || null,
        originalLanguage: lang,
        tags: (m.genres || []).map(g => ({ attributes: { name: { en: g.name || g } } })),
      },
      relationships: [
        { type: 'author',    attributes: { name: (m.author_name || []).join(', ') || 'Unknown' } },
        { type: 'cover_art', attributes: { fileName: '' }, _directUrl: coverUrl },
      ],
    };
  }

  async function fetchPopular() {
    const d = await api(`${API}/v1.0/search?type=comic&limit=12&page=1&sort=follow&tachiyomi=true`);
    return Array.isArray(d) ? d.map(normalize) : [];
  }

  async function search(q) {
    if (!q || q.length < 2) return [];
    const d = await api(`${API}/v1.0/search?q=${encodeURIComponent(q)}&limit=12&tachiyomi=true`);
    return Array.isArray(d) ? d.map(normalize) : [];
  }

  async function fetchChapters(mangaId) {
    const hid = mangaId.replace('comick:', '');
    const d = await api(`${API}/comic/${hid}/chapters?lang=en&limit=100&page=1`);
    if (!d || !d.chapters) return [];
    return d.chapters.map(c => ({
      id: 'comick-ch:' + c.hid,
      _source: 'comick',
      attributes: {
        chapter: String(c.chap || '?'),
        title: c.title || '',
        translatedLanguage: 'en',
        publishAt: c.created_at || new Date().toISOString(),
      },
    }));
  }

  async function fetchPages(chapterId) {
    const hid = chapterId.replace('comick-ch:', '');
    const d = await api(`${API}/chapter/${hid}?tachiyomi=true`);
    if (!d || !d.chapter || !d.chapter.md_images) return [];
    return d.chapter.md_images.map(img => `https://meo.comick.pictures/${img.b2key}`);
  }

  async function fetchDetail(mangaId) {
    const hid = mangaId.replace('comick:', '');
    const d = await api(`${API}/comic/${hid}?tachiyomi=true`);
    return d && d.comic ? normalize(d.comic) : null;
  }

  return { normalize, fetchPopular, search, fetchChapters, fetchPages, fetchDetail };
})();
