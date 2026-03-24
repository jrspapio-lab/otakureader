# OtakuReader

A free, open-source manga reader that runs entirely in your browser.  
No backend. No ads. No account needed.  
Works on Android, iPhone, and desktop.

## ✨ Features

- Search manga from MangaDex + ComicK
- Read any chapter in Webtoon, Paged LTR, or Paged RTL mode
- Download chapters for offline reading
- Library with sort, filter, and search
- Reading history, stats, and streak tracker
- PWA — install on your phone home screen
- Works offline (shows 12 built-in manga when no internet)

---

## 🚀 Deploy to GitHub Pages (Free)

### Option A — Upload files (no Git needed)

1. Go to **github.com** → sign in → **New repository**
2. Name it `otakureader` → set **Public** → click **Create**
3. Click **"uploading an existing file"**
4. Upload ALL files keeping the folder structure:
   ```
   index.html
   style.css
   script.js
   config.js
   manifest.json
   service-worker.js
   .nojekyll
   utils/api.js
   utils/ui.js
   sources/mangadex.js
   ```
5. Click **Commit changes**
6. Go to **Settings → Pages → Deploy from branch → main → / (root) → Save**
7. Wait ~1 minute → your app is live at:
   `https://yourusername.github.io/otakureader/`

### Option B — Git command line

```bash
git init
git add .
git commit -m "OtakuReader v1"
gh repo create otakureader --public --push --source=.
# Then enable GitHub Pages in Settings → Pages
```

---

## 📱 Install on Android

1. Open Chrome on your phone
2. Go to your GitHub Pages URL
3. Tap the **⋮ menu** → **"Add to Home Screen"** or **"Install App"**
4. Tap **Install**

It will appear on your home screen and open full-screen like a real app.

## 📱 Install on iPhone

1. Open **Safari** (must be Safari, not Chrome)
2. Go to your GitHub Pages URL  
3. Tap the **Share** button (box with arrow) at the bottom
4. Scroll down → tap **"Add to Home Screen"** → **Add**

---

## 📁 File Structure

```
/
├── index.html          ← Main app shell (HTML only, no logic)
├── style.css           ← All styles
├── script.js           ← App controller (events, state, navigation)
├── config.js           ← API URLs, settings, fallback data
├── manifest.json       ← PWA manifest
├── service-worker.js   ← Offline support (never breaks API calls)
├── .nojekyll           ← Tells GitHub Pages to skip Jekyll processing
├── README.md           ← This file
├── utils/
│   ├── api.js          ← RequestManager (fetch + retry + proxy rotation)
│   └── ui.js           ← DOM rendering (cards, toasts, spinners)
└── sources/
    └── mangadex.js     ← MangaDex + ComicK API sources
```

---

## 🔌 Adding a New Manga Source

Open `sources/mangadex.js` and copy the `ComicK` block at the bottom.  
Any source that has a public API with CORS headers will work.

You need 4 functions per source:

```js
const MySource = (() => {
  async function fetchPopular()              { /* return array of normalized manga */ }
  async function search(query)               { /* return array of normalized manga */ }
  async function fetchChapters(mangaId)      { /* return array of chapters */ }
  async function fetchPages(chapterId)       { /* return array of image URLs */ }
  return { fetchPopular, search, fetchChapters, fetchPages };
})();
```

Then in `script.js`, add routing in:
- `loadPopular()` — call `MySource.fetchPopular()`
- `doSearch()` — call `MySource.search(q)` in parallel
- `loadChapters()` — check `if (mangaId.startsWith('mysource:'))`
- `APP.openReader()` — check `if (chap.id.startsWith('mysource-ch:'))`

---

## 🛠 How It Works

- **First paint**: 12 built-in manga shown instantly with SVG covers (zero network)
- **API layer**: MangaDex API fetched in background — real covers replace SVG ones
- **CORS**: MangaDex has `Access-Control-Allow-Origin: *` — works directly from GitHub Pages
- **Fallback**: If API fails, 4 proxy servers are tried automatically
- **Service Worker**: Only caches the app shell. **Never** intercepts cross-origin API calls

---

## 📖 Data Sources

| Source | Type | Pages | CORS |
|---|---|---|---|
| MangaDex | Public API | ✅ | ✅ |
| ComicK | Public API | ✅ | ✅ |

---

## 📜 License

MIT — free to use, modify, and distribute.
