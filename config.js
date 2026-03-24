// ═══════════════════════════════════════════════════════════
// OtakuReader — config.js
// All constants, API URLs, and user settings in one place.
// Edit this file to change sources, proxies, or defaults.
// ═══════════════════════════════════════════════════════════

const CONFIG = {

  // ── App identity ─────────────────────────────────────────
  APP_NAME:    'OtakuReader',
  APP_VERSION: 'v1.0',

  // ── MangaDex API ─────────────────────────────────────────
  // Public API — no key required, CORS enabled on GitHub Pages
  MANGADEX_API: 'https://api.mangadex.org',
  MANGADEX_CDN: 'https://uploads.mangadex.org',

  // ── ComicK API ────────────────────────────────────────────
  COMICK_API: 'https://api.comick.fun',

  // ── CORS Proxy rotation ──────────────────────────────────
  // Tried in order when direct request fails (e.g. from file://)
  // On GitHub Pages the direct request works — proxies are fallback only
  PROXIES: [
    url => url,   // direct — works on GitHub Pages
    url => 'https://corsproxy.io/?' + encodeURIComponent(url),
    url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
    url => 'https://cors-anywhere.herokuapp.com/' + url,
    url => 'https://thingproxy.freeboard.io/fetch/' + url,
  ],

  // ── Request settings ─────────────────────────────────────
  REQUEST_TIMEOUT_MS: 12000,  // 12 seconds per attempt
  MAX_RETRIES:        4,      // 5 total attempts (0..4)
  API_CACHE_TTL_MS:   5 * 60 * 1000, // cache responses for 5 minutes

  // ── MangaDex genre tag IDs ────────────────────────────────
  TAGS: {
    action:      '391b0423-d847-456f-aff0-8b0cfc03066b',
    romance:     '423e2eae-a7a2-4a8b-ac03-a8351462d71d',
    fantasy:     'cdc58593-87dd-415e-bbc0-2ec27bf404cc',
    isekai:      'ace04997-f6bd-436e-b261-779182193d3d',
    horror:      'cdad7e68-1419-41dd-bdce-27753074a640',
    'sci-fi':    '256c8bd9-4904-4360-bf4f-508a76d67183',
    sports:      '69964a64-2f90-4d33-beeb-e3bdcec0e19e',
    drama:       'b9af3a63-f058-46de-a9a0-e0c13906197a',
    adventure:   '87cc87cd-a395-47af-b27a-93258283bbc6',
    comedy:      '4d32cc48-9f00-4cca-9b5a-a839f0764984',
    cultivation: '5920b825-4181-4a17-befd-0de3eef69e1a',
  },

  // ── User defaults (saved to localStorage) ────────────────
  DEFAULTS: {
    rtl:       false,   // right-to-left paged mode
    webtoon:   false,   // default reader mode
    datasaver: false,   // load smaller cover images
    showpg:    true,    // show page numbers in reader
    tapnav:    true,    // tap edges to navigate pages
    amoled:    false,   // pure black background
    bigtext:   false,   // larger font size
    incognito: false,   // don't save reading history
  },

  // ── Storage keys ─────────────────────────────────────────
  KEYS: {
    library:   'or_lib',
    history:   'or_hist',
    ratings:   'or_rate',
    settings:  'or_cfg',
    downloads: 'or_dl',
    notes:     'or_notes',
    searches:  'or_searches',
    accent:    'or_accent',
    fontSize:  'or_fontsize',
    streak:    'or_streak',
    analytics: 'or_analytics',
    viewed:    'or_viewed',
  },

  // ── Offline-first fallback manga (SVG covers, zero network) ──
  // Shown instantly on first paint. Real covers load from API after.
  FALLBACK_MANGA: [
    { id: 'a1c7c817-4e59-43b7-9365-09675a149a6f', title: 'Kaguya-sama: Love is War', author: 'Aka Akasaka',       type: 'manga',  year: 2015, status: 'completed', tags: ['Romance','Comedy','Slice of Life'], colors: ['#c62828','#880e4f'] },
    { id: 'c52b2ce3-7f95-469c-96b0-479524fb7a1a', title: 'Chainsaw Man',              author: 'Tatsuki Fujimoto',  type: 'manga',  year: 2018, status: 'ongoing',   tags: ['Action','Horror','Supernatural'],   colors: ['#e53935','#b71c1c'] },
    { id: '37f5cce0-8070-4ada-96e5-fa24b1bd4ff9', title: 'Spy x Family',              author: 'Tatsuya Endo',      type: 'manga',  year: 2019, status: 'ongoing',   tags: ['Action','Comedy','Family'],         colors: ['#1565c0','#0d47a1'] },
    { id: '7c904d49-3e38-4af1-a1bb-43d31b2af3c4', title: 'My Hero Academia',          author: 'Kohei Horikoshi',   type: 'manga',  year: 2014, status: 'ongoing',   tags: ['Action','Fantasy','School'],        colors: ['#1976d2','#006064'] },
    { id: 'f9c33607-9180-4ba6-b85c-e4b5faee7192', title: 'One Punch Man',             author: 'ONE',               type: 'manga',  year: 2012, status: 'ongoing',   tags: ['Action','Comedy','Superhero'],      colors: ['#f57f17','#e65100'] },
    { id: '226eba8c-77ce-4c89-a86d-a1a956420f07', title: 'Vinland Saga',              author: 'Makoto Yukimura',   type: 'manga',  year: 2005, status: 'ongoing',   tags: ['Action','Historical','Drama'],      colors: ['#37474f','#1b5e20'] },
    { id: 'e78a489b-6632-4d61-b00b-5206f5b8b22b', title: 'Berserk',                   author: 'Kentaro Miura',     type: 'manga',  year: 1989, status: 'ongoing',   tags: ['Action','Fantasy','Horror'],        colors: ['#212121','#b71c1c'] },
    { id: 'f61a1b37-7bcf-4d47-9bb7-9b45b2ba0d52', title: 'Tower of God',              author: 'SIU',               type: 'manhwa', year: 2010, status: 'ongoing',   tags: ['Action','Fantasy','Adventure'],     colors: ['#4527a0','#1a237e'] },
    { id: '1c8f0358-d663-4d60-8590-b5e82890a1e3', title: 'Solo Leveling',             author: 'Chugong',           type: 'manhwa', year: 2018, status: 'completed', tags: ['Action','Fantasy','Isekai'],        colors: ['#0d47a1','#1a237e'] },
    { id: 'f45d306d-36cc-41e9-9a66-bf2f2a0de750', title: 'Demon Slayer',              author: 'Koyoharu Gotouge',  type: 'manga',  year: 2016, status: 'completed', tags: ['Action','Supernatural','Historical'],colors: ['#880e4f','#4a148c'] },
    { id: 'b35f67b8-3b5f-4f63-9ce4-ad9c8a0d13c6', title: 'Jujutsu Kaisen',           author: 'Gege Akutami',      type: 'manga',  year: 2018, status: 'ongoing',   tags: ['Action','Supernatural','School'],   colors: ['#311b92','#1a237e'] },
    { id: '0aea9f43-d4a9-4bf7-bebc-550a512f9b95', title: 'Dr. Stone',                 author: 'Riichiro Inagaki',  type: 'manga',  year: 2017, status: 'completed', tags: ['Sci-Fi','Adventure','Comedy'],      colors: ['#1b5e20','#33691e'] },
  ],
};
