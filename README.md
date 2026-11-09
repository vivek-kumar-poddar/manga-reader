# Manga Reader 1.7.1

A local-first manga reader built with React, TypeScript, Vite, Tailwind, Radix Dialog, and IndexedDB. No backend is required. Your manga images stay in the folders you select.

## Development handoff

Read `migrate-to-rust.txt` first, then `re-code.txt`. `AGENTS.md` requires
this order for coding agents. Completed steps carry compact changes, verification,
and constraints; detailed evidence lives in `docs/verification.md`.

Baseline checks (isolated browser storage; no personal library access):

```sh
npm ci
npx playwright install chromium
npm run test:baseline
npm run format:check
```

This builds the production app and runs browser tests against dedicated ports
4173 (development) and 4174 (production preview). Results, traces on failure, and
backup exports go to ignored `test-results/`. Fixture definitions are in
`tests/fixtures/`; see `docs/verification.md` for measurements and limitations.

`npm run test:limits` runs the resource-boundary checks. Shared data contracts live
in `src/model.ts`; limits and guards live in `src/limits.ts`. Policy, units,
enforcement, and loop termination are documented in `docs/limits.md`.

## Run locally

Install Node.js 22 LTS (22.12 or newer), or Node.js 24 LTS. Extract this ZIP, open a terminal in its folder, and run:

```sh
npm ci
npm run dev
```

Open the localhost URL printed in the terminal. Use that same browser profile and URL for your saved library. Browser storage is separate for each origin; the hosted site's library does not automatically transfer to localhost. Export metadata from Settings → Storage on the hosted site and import it locally, then re-link your folders.

## Production build and offline mode

```sh
npm run build
npm run preview
```

The generated `dist/` folder is a complete static deployment. Upload its contents to Cloudflare Pages, Netlify, Vercel, or another static HTTPS host. Hash routing does not require route rewrites. Do not open `index.html` using a `file://` URL; use the local server. The PWA service worker is enabled in production builds, not the development server. Load the preview or deployed app once online and allow installation to finish before testing offline use. Local files must still be available.

Hashed assets can be cached for one year. HTML and service worker responses should be revalidated. `_headers` is supplied for hosts that support it; configure equivalent headers on other hosts.

## Desktop App (Tauri v2 & Rust)

Manga Reader includes a native Windows desktop application powered by a lightweight Rust backend (Tauri v2).

```sh
# Run in desktop development mode (hot-reloaded Vite + native Rust backend):
npm run tauri:dev

# Build native Windows installer (NSIS bundle in src-tauri/target/release/bundle/nsis/):
npm run tauri:build
```

## Supported sources

- Images directly in a folder, imported as one chapter.
- A manga folder containing chapter folders.
- Nested volumes, chapters, and extras, preserving their relative grouping.
- A parent collection, explicitly split into one title per immediate subfolder in the preview.
- Several folders dropped together.
- Individually selected images, imported as one title.

The What's supported button shows six folder examples. Every import has a grouping preview, sorting choice, and update/add-separately choice. Re-linking preserves matching page paths and uniquely matching renamed chapter metadata. Unchanged image dimensions are reused using path, file size, and modification time. Cancellation keeps previously completed titles and leaves the currently incomplete title untouched.

JPEG, PNG, WebP, GIF, AVIF, BMP, SVG, and other formats work when the browser can decode them. HEIC/TIFF compatibility is browser-dependent. Corrupt, empty, unavailable, or timed-out images appear in a downloadable report. Hidden/system entries are ignored. Folder traversal stops beyond 64 levels and reports the limitation. Empty folders are omitted. ZIP/CBZ/RAR/PDF and encrypted archives are not supported: extract image files first.

## Reading

The top bar groups back/title on the left, fitting/pixel-width/mode selectors in the center, and keyboard/theme/settings on the right. The bottom bar groups previous/compact chapter selector/next on the left, current-page/drag-to-seek/total-page controls in the center, and completion/zoom/autoplay/options on the right. Moving directly to the next chapter marks the chapter you leave as completed. Zoom and autoplay options open compact menus. On small screens the header selectors scroll horizontally within their center group; both bars remain one row.

Continuous reading has zero page gaps, dimensions reserved before display, lazy image loading through a shared observer, and a bounded loading queue. Single-page mode supports right-to-left navigation, optional two-page spreads on wide screens, and an optional separate first page. Landscape pages remain separate. Touch supports native pinch zoom/panning; swipes do not turn pages while zoomed. Reader zoom controls are also available.

Progress is stored separately from metadata, at most about every 1.5 seconds while moving, and flushed on navigation, visibility changes, and user-approved updates. Page paths and offsets preserve position through layout changes and inserted/reordered pages. If a saved page is missing, the nearest remaining position is used. Reaching the bottom of a chapter's final page marks it read. Bookmarks store the page and offset.

Auto-scroll uses seconds per visible screen height, independent of image length: at 3 seconds, a 600px-tall viewport scrolls 200px per second. It adapts to viewport changes on desktop and mobile; larger time values scroll more slowly. Single-page mode uses the same setting as seconds per page or spread. Mouse/touch/keyboard interaction pauses it, and held pointers/keys keep it paused. End behavior can stop, move to the next chapter, or replay. A new app version displays an update prompt; it does not automatically interrupt reading.

## Storage and limitations

New imports allow up to 1,000 titles, 1,000 chapters and 10,000 pages per title,
and 1,000 bookmarks per chapter. Backups are limited to 32 MiB and 100,000 pages
total. Images must fit 16 million pixels and 32,768 pixels per side. Oversized
inputs report a limit error; existing records are not deleted to enforce a limit.

- The local database contains metadata, small cover images, preferences, bookmarks, and progress. Supported browser folder handles may be retained.
- Original manga pages are not stored in the offline cache. The cache holds app assets only.
- Standard folder/file selection requires selecting files again after reload. Browser permissions and embedded contexts can restrict retained folder access.
- Storage protection is best effort. Export backups before clearing browser data or switching devices.
- Backups do not contain manga images or permissions.
- The application never writes to your manga folders.
- A browser crash or forced process termination can lose the most recent unsaved interval; no browser application can guarantee completion of asynchronous writes during forced termination.

## Project layout

`src/data.ts` contains persistence, migration, indexing, and folder handling. `src/Reader.tsx` contains reader behavior. `src/PageImage.tsx` owns shared lazy loading. `src/ImportDialogs.tsx` contains import previews and supported-folder examples. `src/SettingsPanel.tsx` contains tabbed settings. `src/updates.ts` handles user-approved app updates.

The downloadable project omits site-provider credentials and `.openai/hosting.json`. Those are not needed for local use or static deployment.

All dropdown menus share an accessible custom Radix Select design with keyboard navigation, typeahead, and viewport-aware positioning. The welcome line rotates through 20 messages using the browser’s local calendar date and changes at local midnight, including while the app is open.

### Updating

Use Save & reload to save progress and activate a downloaded update. The button shows progress and reports failures instead of silently stopping. Manual refresh instructions are available in the update banner. If an older build has a stuck update button, return to the library, close all Reader tabs/app windows, and reopen online. Never clear site data to update; it holds your saved library and progress.

### Readable local links

Reader URLs use `/folder-name/ch1`, `/folder-name/ch2`, etc. Chapter numbers follow the indexed reading order (including prologues and extras). Spaces and punctuation become hyphens, Latin accents are normalized, emojis are removed, and other writing systems are retained. Emoji-only names use `manga`. Duplicate names receive stable suffixes (`-2`, `-3`). Existing libraries receive saved slugs automatically; re-indexing preserves them and old hash/ID bookmarks redirect. Links work only where that title exists in the browser library.

Host at the domain root with an SPA fallback: unknown paths must serve `index.html` with status 200. Cloudflare Pages provides this fallback automatically when no `404.html` is supplied. `npm run dev` and `npm run preview` support these paths locally. Do not open `dist/index.html` directly as a file.

Offline startup requires one completed online visit to the production build on HTTPS or localhost. Both `/manga-reader` and `/manga-reader/` then open the cached app without waiting for the network. Deploy the rebuilt `dist/` together with the `public/_headers` rules: `sw.js` needs `Service-Worker-Allowed: /` to register the scope covering the URL without a trailing slash. The parent `build-all.sh` already merges these rules into the deployment root. The development server does not install the offline worker.

Interface controls use neutral 1px borders and square icon buttons at every screen size. Compact screens use two rows for reader controls to preserve touch targets. Notifications dismiss after three seconds; update prompts stay visible. Press feedback respects the system and in-app reduced-motion settings.

Shelf sorting offers recent activity, title, newest added, and completion percentage; the preference saves locally. A 2px chapter-progress line appears while both reader bars are hidden. The upload area has two equally sized actions with more vertical space.

Bookmarks live at `/bookmarks` with removable page cards. The homepage shows a saved-page carousel with wheel, arrow, keyboard, mouse-drag and native touch scrolling. Opening a bookmark restores its chapter, page and reading offset. Thumbnails load as they approach the viewport; saved covers are used when local page access is unavailable.

Indexing lists the full folder tree but checks dimensions only for the first five sorted chapters. Later chapters are prepared on demand with cancellation and locally cached dimensions, without rewriting reading progress. PNG/GIF and ordinary JPEG sizes use bounded header reads; other formats and EXIF JPEGs use browser decoding. Discovery reuses returned file handles, and dimension work uses a bounded three-worker queue with batched progress updates.

Discovery now measures the first five chapters during the scan, retaining temporary measurements for confirmation. Cancel discards temporary measurements; save reuses them. Remaining dimensions prepare in a bounded background queue after commit, with foreground chapter preparation taking priority. The completion dialog shows cover, title, chapter/page totals and OK, stacking vertically on phones.
