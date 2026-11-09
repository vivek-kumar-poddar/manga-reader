# Re-code verification

Read `../re-code.txt` first. Step IDs below refer to that plan.

## Viewport auto-scroll — 2026-09-30

- User-requested maintenance under G8/G13/G17/G18; numbered steps 04–20 stay pending.
- `src/Reader.tsx` now computes continuous speed as visible viewport height divided
  by saved seconds. Page dimensions no longer affect velocity, including when
  crossing boundaries between short pages and long webtoons. The animation reads
  `visualViewport.height` each frame, with `innerHeight` fallback, and carries
  fractional pixels so slow settings do not stall on integer scroll positions.
- Both the reader popup and `src/SettingsPanel.tsx` say “Seconds per screen” in
  continuous mode and “Seconds per page” in single mode, with explanatory text.
  `src/model.ts` documents the units; README includes the 600px / 3s = 200px/s example.
  Saved numbers and schema are unchanged. Single-page/spread timing, readiness,
  current-position scrolling, interaction pauses, pinch-zoom pause, chapter-end
  next/replay/stop, and frame-delta cap are preserved.
- Browser API references: [visible height in CSS pixels](https://developer.mozilla.org/en-US/docs/Web/API/VisualViewport/height),
  [layout viewport fallback](https://developer.mozilla.org/en-US/docs/Web/API/Window/innerHeight),
  [elapsed-time animation](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame).
- `tests/autoplay.spec.ts`: 800/14000/2400px source heights, boundary crossings at
  1280×800 and 390×660 viewport sizes (3-second rates within 10%), resize to 480px
  high during playback (160px/s ±10%), 120-second custom setting (~6.7px/s), settings
  units, and prior manual navigation/reread/single-page/chapter-end regressions.
  `tests/autoplay-production.spec.ts` now asserts viewport-based rates and runs
  with the offline project against generated production assets.
- `npm run build`: PASS; TypeScript and PWA generation succeed. Existing Vite
  chunk-size warning remains (500.67 kB JS). Generated dist assets/index/worker
  retained together. Targeted Prettier checks: PASS.
- Initial browser run: 17/18 PASS, including all new checks. Repeated-chapter tests
  exposed a test synchronization race: URL updates precede React rendering the
  destination controls, so immediate input used the previous chapter's handler.
  Traced this in production; tests now wait for the chapter selector's visible
  destination before interacting. Production regression then passed. No restore
  logic changes retained. An intermediate development run was invalidated by
  editing handoff/docs while Vite watched them (full-page reload lost fixture
  session files). Final clean run pending; do not edit watched files during tests.
- Scope: this Documents workspace and its generated build. Tests use synthetic
  SVGs and isolated storage; mobile sizes are Chromium simulation, not physical
  device/browser-chrome testing. Separate Desktop copy and live site not changed.

## Autoplay position and timing — 2026-09-30

- User-requested maintenance under G7/G10/G18; numbered steps 04–20 remain pending.
- Reproduced against the original reader: a next chapter saved at its ending was
  immediately skipped (chapter 2 → 3 → 4), and a manually selected single page
  inherited the previous page's elapsed countdown. Uniform-page continuous motion
  already passed the 2/5-second rate checks; those remain regression coverage.
- `src/Reader.tsx`: automatic chapter advance resets only the destination to its
  beginning. Manual navigation still restores saved progress. Playback is suspended
  synchronously during chapter changes and gated on current chapter readiness.
  Start/restore/input/speed changes reset the playback clock; continuous playback
  locates the page from actual scrollY via binary search rather than lagging capture
  state. Existing seconds-per-page, resume delay, and save guards remain in place.
- `tests/autoplay.spec.ts`, included in the baseline project: six Chromium tests
  cover chapter 3/page 4 → chapter 2/page 8, manual backward scroll during playback,
  pause and restart at chapter 9/page 5, 2/5-second rates (within 30% timing tolerance),
  fresh single-page countdown, saved-end chapter advance, replay, and stop.
  Synthetic SVGs, isolated browser storage; no personal library access.
- `npm run build`: PASS (TypeScript and production/PWA generation). Existing bundle
  is now 500.02 kB and emits Vite's chunk-size warning; build succeeds.
- `npx playwright test --project=baseline --project=offline`: **13/13 PASS**
  (6 autoplay, 5 existing baseline, 2 production offline/reconnect checks).
- `npx prettier --check src/Reader.tsx tests/autoplay.spec.ts playwright.config.ts`:
  PASS. Generated `dist/` assets, index and service worker retained together.
- Scope: Documents/convertvkp/manga-reader source and build. No service was listening
  on port 5173 during this task; the separate Desktop copy and live deployment were
  not changed. No schema or library-data migration.

## Requested UI fix — 2026-09-30

Follow-up after user reported no visible change:

- Root delivery error: the earlier turn restored old tracked `dist/` after a
  successful build. `.gitignore` documents that deployment copies these files
  without rebuilding. Source checks therefore did not verify deployable output.
  Rebuilt and retained generated HTML, hashed JS/CSS and service worker together.
- Outside dismissal now uses capture-phase pointerdown and click, so a child
  stopping event bubbling cannot prevent it. Explicit icon classes cross-fade
  and rotate over 0.3s ease-in-out. Upload area and button transitions use the
  same timing; button states are dark idle, white on area hover, dark on direct
  hover in both themes. Reduced-motion rules remain effective.
- `npm run build`: PASS. Ad hoc Playwright test served actual `dist/` mounted at
  `/manga-reader/` on port 4181, using an isolated browser and synthetic backup
  imported through Settings. PASS: two-title import; outside/second-menu/action/
  Escape dismissal; dismissal with stopped bubbling; keyboard activation; icon
  opacity; all three button colors in light/dark; computed 0.3s ease-in-out;
  reduced-motion override; zero page errors.
- Plain Vite preview at `/manga-reader/` initially failed to serve relative assets
  under that mount. A static server mounting dist at the deployment path was used
  for the successful check. No router or deployment-path changes were made.
- This verifies local production artifacts, not a remote deployment. Prior full
  regression-suite and native-permission limitations below still apply.

- Separate user-requested maintenance; numbered refactor steps 04–20 remain pending.
- `src/App.tsx`: card menus dismiss on outside click, another menu, Escape, or an
  action; keyboard dismissal returns focus to the summary. `src/style.css` switches
  ellipsis/cross by native details state. Listeners are removed on unmount.
- Upload-area hover makes Choose a folder white with dark text; direct button
  hover retains its existing colors in both themes. Existing edits in
  `src/controls.css` were preserved.
- Folder labels distinguish temporary imports; access is queried again on focus
  and visibility return, with stale async responses ignored. Reader gate and Help
  explain remembered access and browser-controlled choices. No schema changes,
  permission escalation, automatic retries, or data clearing.
- `npm run build`: PASS (TypeScript, Vite, service worker).
- Ad hoc Playwright checks at `/manga-reader/` in an isolated Chromium context:
  PASS for outside click, opening a second menu, cross/ellipsis visibility,
  Enter/Escape, menu-action dismissal, computed upload/button hover colors in light
  and dark modes, and fallback-folder guidance. Synthetic records only.
- `npx playwright test --project=baseline --project=offline`: first baseline test
  timed out; run stopped. Existing tests navigate to `/`, while `src/main.tsx`
  configures BrowserRouter basename `/manga-reader`; the root renders blank.
  This run does not establish regression-suite success.
- Additional stored-handle permission-transition check was inconclusive: Chromium
  closed its protocol session after reloading an OPFS-handle fixture. Native
  permission UI and focus-triggered permission transitions still need manual
  verification in a normal browser profile; do not count these as passed.
- Browser behavior reference: [Chrome persistent file permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api).
  The app can request read access from a user gesture, but cannot force persistent
  permission or reset the browser's prompt choices.

## 01 — Baseline (2026-09-28)

- Guidelines: G7/G8/G18. No application source changes in this step.
- Original `npm run build`: PASS; TypeScript + Vite + PWA generation.
- `npm run test:e2e`: 6/6 PASS, no skipped tests (8.0 s).
- UI: import six pages/two chapters; jump to page 2; bookmark; export; reload;
  permission gate; re-link same files; restore page 2 and bookmark.
- Restore: v2 backup retains position fraction 0.25 and bookmarks.
- Migration: real v1 IndexedDB upgrades to v2; cover, read marker, position,
  bookmark and dark setting preserved.
- Fault fixtures: corrupt PNG reported; duplicate names remain separate by path;
  pre-aborted scan commits no extra title; 66-level OPFS traversal reports limit.
- Production: activated service worker reopens the app shell offline.
- Retained evidence: `baseline/before-format/backup.json`,
  `baseline/before-format/measurements.json`; legacy fixture: `backup(1)` in
  `../tests/fixtures/library.ts`. All data is synthetic.

Environment: Windows x64, i7-14700K, 68,427,071,488 bytes RAM; Node 22.23.3;
headless Chromium 153.0.8010.12; 1280 x 800 viewport; one test worker.

| Measurement                             | Before formatting |
| --------------------------------------- | ----------------: |
| Small UI import, 6 SVGs / 720 bytes     |            287 ms |
| Large index, 1,000 SVGs / 120,000 bytes |          1,752 ms |
| Large reader render wait                |            557 ms |
| Live document elements                  |             2,133 |
| JS used heap snapshot                   |  21,155,268 bytes |
| Production JavaScript                   |     491,392 bytes |
| Production CSS                          |      58,364 bytes |

These are single-run observations, not release budgets. Synthetic SVGs exercise
layout and orchestration, not real comic decoding. Heap snapshot is neither peak
usage nor a leak test. Import uses development React; offline check uses production.
Real-device/mobile, cross-browser, quota, race, and failed-migration coverage remain
for later steps. Successful baseline migration does not prove rollback behavior.

Test-authoring corrections: scoped duplicate title headings to the library card;
revealed auto-hidden bars before Home; used a viewport mouse click instead of
locator.click(body), which scrolls the document and invalidates the position test.
No application behavior was altered to make these checks pass.

## 02 — Readable source

- Guidelines: G1/G2/G14. Prettier 3.9.9 formats source, CSS, configuration, tests,
  and documentation; no intentional logic, database schema, or API changes.
- Added `.prettierrc.json`, `.prettierignore`, `format`, and `format:check`.
- `npm run format:check`: PASS. `data.ts` required a second formatter pass to
  stabilize chained-call layout; only whitespace changed on that pass.
- `npm run test:baseline`: production build PASS; same six browser checks PASS.
- Retained after-format backup/measurements: `baseline/after-format/`.
- Initial after-format observations: small import 260 ms; large index 1,777 ms;
  render wait 564 ms; 2,133 document elements; 21,291,164 bytes used JS heap.
  Single samples show no material performance change; they are not statistical
  evidence. Full build hashes, sizes, and environment are in measurements.json.
- Next: step 03 contracts/limits. Validation, atomic restore, save durability,
  queue bounds, and all other functional fixes remain pending; formatting does
  not fix those defects. Preserve the baseline workflows when implementing them.

## Reproduce

```sh
npm ci
npx playwright install chromium
npm run test:baseline
```

Dedicated ports 4173/4174 must be free. Test contexts never open an existing browser
profile. Results are under ignored `test-results/`; fixture output is under ignored
`tests/fixtures/generated/`. Use `node scripts/capture-baseline.mjs before-format`
or `after-format` only to deliberately replace the corresponding retained evidence.
The capture script expects the original six checks: run
`npx playwright test --project=baseline --project=offline` before using it.

## 03 — Shared contracts and limits

- Guidelines: G3/G4/G5/G17. Model types/defaults moved to `src/model.ts`;
  compatibility re-exports retained in `data.ts`; no database schema change.
- `src/limits.ts`: frozen policy, count/path/pixel guards, typed-record resource
  checks, single-settlement deadline helper. Units, rationale, enforcement,
  capacity behavior and loop audit are in `docs/limits.md`.
- `data.ts`: cap backup/source counts, paths, images and metadata writes; check
  new-title capacity in the existing transaction; cap scan backlog/active task
  retention and background queue; bound browser I/O and legacy callbacks.
- `SettingsPanel.importData`: size before text/JSON; `Reader.toggleBookmark`:
  refuse overflow before mutation; `PageImage`: queue overflow retry, preserved
  1/2 workers, resize deadlines and bitmap/canvas cleanup; `imageDimensions`:
  named header-byte cap and pixel checks; `updates`: named existing deadlines;
  `paths.uniqueSlug`: finite candidate bound with unchanged suffix behavior.
- Boundary testing found and fixed legacy traversal counting a leaf file as an
  extra directory: both native and legacy paths now allow 64 folders. A root
  cover no longer incorrectly consumes an extra chapter slot at the limit.
- `npm run format:check`: PASS. `npm run test:baseline`: production build PASS;
  **20/20 browser tests PASS** (14 limits +6 original checks; 16.4 s).
  After making count fixtures use unique keys and valid bookmark references for
  step-04 compatibility, the affected backup-boundary test passed again (1/1).
  Tests cover exact/over count/byte/path/pixel
  limits; title writes at capacity; no-read/no-write rejection; queue saturation
  and retry at desktop/mobile widths; 3 scan workers; 5 warm chapters; 64-title
  background capacity/resume; deadlined/repeating readers; abort/late rejection;
  pure model import and old export compatibility.
- Test clock is paused for exact deadlines; background checks advance both the
  100-ms scheduler delay and zero-delay preparation yield. No production code
  bypasses were added to make the scheduler test pass.
- Unknown-record validation/duplicates (04), atomic restore (08), progress
  durability (09), removable queues (12), full image handling (13) remain pending.
  Existing stored records are not silently trimmed. New ceilings are engineering
  policy, not measured mobile peak-memory guarantees. Preserve original snapshots.

## Local and hosted routing — 2026-09-30

- Confirmed process serving the user's `http://localhost:5173/` runs from
  `C:/Users/VKPs/Desktop/manga-reader`. Earlier edits targeted the separate
  Documents/convertvkp copy. Applied only requested menu, hover and permission
  changes to Desktop source, preserving its layout and other differences.
- Both copies: source `index.html` establishes `/` or `/manga-reader/` as the
  document base before app startup; `src/main.tsx` uses that base for BrowserRouter
  and legacy hash redirects; `src/updates.ts` registers sw.js at that base rather
  than relative to a chapter URL. Vite `base: './'` is unchanged. Dist is generated
  only by npm run build, not manually edited.
- Actual localhost:5173, isolated Chromium: root renders; cross opacity reaches 1;
  outside click closes details; white area-hover/dark direct-hover colors and
  0.3s duration pass in both themes. No personal browser profile used.
- Both source copies: npm run build PASS. Documents copy:
  npx playwright test --project=baseline --project=offline: 6/6 PASS.
- Production root preview and locally mounted `/manga-reader/`: library and
  direct missing-title/ch1 routes render on navigation/reload; legacy hash route
  preserves hosted prefix; worker scope is `/manga-reader/`; offline shell works.
  These are local hosted-path checks, not verification of the deployed website.
- Deep-link checks also observed speculative relative asset requests returning
  404 before the dynamic base takes effect; the final correctly based requests
  load and the page renders. A zero-network-error assertion therefore failed;
  do not describe these checks as zero failed requests. No page-render failure.
- Hosting must rewrite chapter URLs to the app's index.html. Neither Vite's asset
  base nor React Router can configure the remote server's rewrite rules.

## Reconnect chapter reload — 2026-09-30

- Live HTTP inspection: `/manga-reader/` returns Reader HTML, but the reported
  `/manga-reader/survival-story-of-a-sword-king-in-a-fantasy-world/ch1` returns the
  parent website HTML with status 200. The app cannot show its permission gate
  when it is not loaded. This is separate from IndexedDB folder permission.
- `public/_redirects`: narrow Cloudflare Pages 200 rewrites for chapter, bookmarks
  and legacy read routes. Parent `../build-all.sh` copies this file into the root
  of `build/`; a nested app `_redirects` is not the deployment-level configuration.
  Existing parent routing generation is preserved. Assets/worker filenames used
  by this build do not match these route rules.
- `vite.config.ts`: precached index.html navigation fallback replaces navigation
  NetworkFirst caching, which accepted unrelated parent HTML with HTTP 200.
  Assets/file URLs are excluded. Both Desktop and Documents source copies updated.
- Both `npm run build` commands PASS. Documents:
  `npx playwright test --project=baseline --project=offline`: **7/7 PASS**.
- Added production regression `cancelled folder reconnect stays available after
chapter reloads`: native-picker AbortError simulated, reconnect screen and URL
  persist, online and offline reloads return to gate, retry remains enabled, saved
  title remains. Existing successful re-link/progress/bookmark tests also pass.
- Hosted-path harness uses actual generated dist and source rewrite patterns:
  without a worker, direct chapter navigation/reload loads the permission gate;
  with an activated worker and server deliberately returning unrelated HTTP 200
  HTML for chapter routes, navigation/reload still loads Reader's permission gate.
  This emulates static rules; it is not a Cloudflare deployment test.
- Extracted actual `create_routes_config` function executed in an isolated
  test-results directory: PASS, root build/_redirects equals source rules.
  Full parent build/deployment not run. Initial extraction accidentally ended
  inside a quoted JSON block; corrected harness completed successfully.
- Source: https://developers.cloudflare.com/pages/configuration/redirects/
  Root rewrite rules and updated service worker need deployment. Existing clients
  use the normal Save & reload update flow; library storage is not cleared.

## Simplicity and UI improvement plan — 2026-10-01

- Documentation-only request: updated `re-code.txt` and
  `programming-guidelines.txt`; application source, generated assets, storage,
  and runtime behavior are unchanged.
- Read the full handoff and guidelines first. Reviewed `src/App.tsx` (`Library`,
  `sortedLibrary`, `setSettings`), `src/Reader.tsx` (`ReaderView`, navigation and
  playback handlers), `src/SettingsPanel.tsx`, `src/model.ts`, and
  `src/DailyWelcome.tsx` to ground the recommendations in existing code.
- Evidence: `Library` renders a large upload zone even with a populated shelf,
  repeated introductory/helper text, a bookmark preview, and card actions.
  Its comparator uses nested ternaries. Reading preferences appear in both
  reader controls and Settings; setting writes already have an App owner.
  These observations motivate the proposed cleanup; no visual usability or
  performance improvement has been measured in this documentation change.
- Added pending steps 21–22 for a compact populated library and simpler reader
  controls. Steps 04–20 remain pending in their original order; completed steps
  01–03 and earlier maintenance records are preserved. UI checks are specified
  in the plan and have not been run.
- Coding guidance favors clear task functions, simple collection methods, and
  typed lookups where useful. Retains explicit guards and bounded sequential
  loops; rejects async `forEach`, unbounded parallel work, dense expression
  rewrites, and speculative abstractions.
- `git diff --check`: PASS. `npx prettier --check docs/verification.md`: PASS.
  PowerShell heading comparison against Git HEAD: PASS; all original 20 step
  headings/statuses preserved, 22 total numbered steps, new steps pending.
- No build or browser tests requested or run for these documentation edits.

## Continue Reading overlay — 2026-10-03

- User-requested maintenance, separate from numbered refactoring steps 04–22.
  Preserves completed steps 01–03 and existing uncommitted documentation edits.
- `src/Reader.tsx`: take a copy of the last saved chapter/page/fraction from
  IndexedDB before applying an entry URL's page/offset. Ongoing progress writes
  cannot move this visit's Continue target. Corrected legacy `?chapter=` handling
  when applying a page override. No schema changes or duplicate localStorage state.
- Show a bottom-centered, nonblocking `Continue Reading` action and accessible
  close button while away from the saved location (2-pixel rounding tolerance).
  Closing keeps the current reading position; using the action restores instantly
  through the existing measured layout lifecycle, including same-chapter jumps.
  Both actions clear the prompt for this reader visit. Fresh titles have no prompt.
- Autoplay uses its existing clock/settings and controls. Continue never starts
  playback, and stops active playback so the destination remains stationary.
  The overlay is not a blocking dialog; single-page swipes ignore its controls.
  `src/style.css` places it above the bottom toolbar, including the taller mobile
  toolbar; buttons have 44-pixel minimum touch targets and use theme colors.
- `npm run build`: PASS (TypeScript and generated production/PWA assets).
  Vite reports the existing main-chunk size advisory. Generated `dist` retained.
- `npx playwright test --project=baseline --project=offline`: existing 19 checks
  all PASS, covering autoplay speed/timing, chapter-end actions, import, bookmarks,
  migration, re-link, backup, large chapters, and production/offline behavior.
  The initial new tests had five failures: mobile clearance required more space;
  the persistence assertion needed to allow records without positions; synthetic
  single-page fixtures needed enough height to make their halfway anchor reachable.
- After fixing clearance and the fixtures/assertion,
  `npx playwright test tests/continue-reading.spec.ts --project=baseline`: **8/8 PASS**.
  Covers chapter 3/page 16/50% from chapter 1/page 7 and from the same chapter,
  continuous/single-page modes, fixed destination after progress writes, dismissal,
  mobile centering/toolbar clearance, active autoplay, no prior progress, and
  leaving/reopening at the saved location before browsing elsewhere again.
- Existing geometry/browser scroll bounds still apply: a saved fractional anchor
  cannot be placed at the viewport top if that would scroll beyond the document
  bottom (for example a short single page after resizing). No extra blank scrolling
  space was introduced. Native device safe-area behavior was not hardware-tested.
- `npx prettier --check src/Reader.tsx tests/continue-reading.spec.ts playwright.config.ts`:
  PASS. Existing CSS formatting preserved outside the new styles.
  `git diff --check`: PASS. Final docs checked with Prettier as well.

## Manga detail page and direct resume — 2026-10-03

- Supersedes the Continue Reading overlay above at the user's request. Removed
  its snapshot state, notification UI/styles and obsolete notification tests.
- Homepage manga cards continue directly to the saved chapter/page/fraction;
  the click reads current IndexedDB metadata so a stale shelf summary cannot
  select the wrong chapter. Existing Reader geometry restores the precise offset
  instantly. Autoplay remains independent and starts disabled on reader entry.
- Added `src/MangaDetails.tsx` at `/:slug/`. Homepage `View chapters` links and
  the reader title open it. The reader title captures/flushes progress first.
  It displays a larger cover on the left, title on the right, total chapters and
  pages, and actual saved chapter/page (or Not started yet). Refreshes metadata
  on entry, library changes, window focus and visibility return; stale async
  responses are ignored. Storage failures show a retry action.
- Chapter links retain original chapter indexes and saved per-chapter progress.
  Sort options: first chapter first, last chapter first, unread first. Sorting
  changes only the visible list. Responsive grid: 4 columns above 1000px,
  2 columns through 1000px, 1 column through 600px.
- Existing `/slug/ch3` and legacy reader URLs remain supported. Added the hosted
  `/manga-reader/:slug/` rewrite in `public/_redirects`; the parent build script
  already copies this file to its deployment root. No hosted deployment performed.
- `npm run build`: PASS; regenerated tracked `dist`, including redirect/PWA assets.
  Existing Vite main-chunk size advisory remains.
- `npx playwright test --project=baseline --project=offline`: **24/24 PASS**.
  Five new tests cover exact homepage resume with no notification, reader-to-detail
  navigation and progress, counts, chapter links/sorting, reload, focus refresh,
  and 4/2/1-column layout with no horizontal overflow at 1280/800/390px.
  All 19 existing baseline/autoplay/production/offline regressions pass.
- Inspected `test-results/manga-details-1280.png` and `manga-details-390.png`:
  large cover, readable metadata, chapter list and mobile layout verified.
  The existing shelf cover's fixed height is overridden for the detail page.
- Targeted Prettier checks and `git diff --check`: PASS. Prior uncommitted
  guideline/planning edits preserved; numbered refactoring steps remain unchanged.

## Chapter-number search — 2026-10-03

- Replaced the detail page's Chapters heading with a labeled search form in
  `src/MangaDetails.tsx`; retained sorting beside it and responsive layout.
- Filters immediately by the one-based chapter number used in reader routes.
  Leading zeroes are accepted; empty input restores all chapters in the selected
  order. Invalid/missing numbers show a no-results message. Enter does not reload
  or navigate away. Chapter links and persisted reading positions are unchanged.
- Extended the existing detail workflow check for `03`, absent chapter `99`,
  clearing search, preserved reverse sorting and canonical result links.
- `npm run build`: PASS; generated `dist` rebuilt. Existing chunk-size advisory.
- `npx playwright test tests/manga-details.spec.ts --project=baseline`: **5/5 PASS**,
  including resume, search/sort, reload/focus refresh and desktop/tablet/mobile grids.
- Targeted Prettier and `git diff --check`: PASS. Numbered plan statuses unchanged.

## Inline homepage chapter link — 2026-10-03

- Inspected `Screenshot 2026-10-03 024405.png`: View chapters was visually below
  the card. Moved the link inside the card beside Continue/Start reading and used
  the requested text `Chpaters`.
- `src/App.tsx` uses sibling button/link controls in an action row; the resume
  button has a stretched click area covering the card content. The chapter link
  remains independently clickable and keyboard-accessible, without nested controls.
- `npm run build`: PASS; generated deployment assets retained. Existing bundle
  size advisory remains. Baseline/detail browser suites: **10/10 PASS**.
- Extended existing responsive checks: chapter action lies to the right and on
  the same centerline at 1280/800/390px, and still opens details. **3/3 PASS**.
  Inspected `test-results/manga-card-390.png` to confirm the compact action row.
- Targeted Prettier and `git diff --check`: PASS. Storage/resume behavior and
  numbered refactor statuses unchanged.

## Long-panel preparation and recovery — 2026-10-06

User-requested maintenance; numbered refactor steps 04–22 remain pending. Related
principles: G4/G5/G6/G7/G17/G18; targeted correction to step 03 dimension policy.

Confirmed causes in source:

- `assertImageDimensions` rejected any source over 32,768 pixels per axis or
  16,000,000 pixels total, even when its browser decoder supported the image.
  Import, re-link, chapter preparation and display shared this rejection.
- The chapter warning discarded `Issue.reason`; its suggested page retry only
  reloaded the image and never repaired pending dimensions/layout.
- Rejected discovery promises remained in `scanned`, reusing a stale failure
  during subsequent indexing. Failed entries are now evicted without automatic
  retry loops.
- Optional mobile bitmap/canvas conversion could allocate another large surface.
  It now bypasses originals above the existing work budgets. Known-header large
  covers are optional and skipped before decoding; reader originals remain intact.

Source dimensions must remain positive safe integers with a safely representable
area. Header reads, queue capacities, concurrency, deadlines, path limits and
stale-write checks remain. The fallback dimension decoder now settles once and
clears its image source on every exit. Schema, reading positions and bookmarks
are unchanged. Failed pages remain pending; explicit retry reruns preparation,
updates geometry and clears the preparation warning. Up to three file/reason
pairs appear in the warning, with remaining pending pages marked in the reader.

Verification:

- `npm run build`: PASS (existing bundle-size advisory only); tracked `dist/`
  rebuilt, including matching entry bundle and service-worker precache.
- `npx playwright test --project=page-preparation`: 5/5 PASS in Chromium.
  Real PNG fixtures: 64 × 40,000 and 800 × 21,000 prepare, persist and decode;
  import/re-link accept the same fixtures. Positions/bookmarks survive preparation.
  Mobile viewport 390 × 844 displays a 1200 × 15,000 original in low-quality mode
  with zero optional bitmap calls. A failed discovery read succeeds on later
  indexing. Empty/corrupt/missing/permission-denied files retain distinct reasons,
  and replacement files recover. Reader UI retry repairs a pending 80 × 40,000
  SVG and its aspect ratio without re-linking.
- Targeted Prettier checks and `git diff --check`: PASS.

Limits: browser decoder/memory limits still apply; no promise that arbitrary-size
images work on every device. Physical phones, Safari and real native filesystem
permission prompts were not tested. Existing baseline/autoplay/limits/offline
suites and fixture files were already deleted in the working tree; those deletions
were preserved, and those suites were not run. The new suite is independent.

## Offline entry URL — 2026-10-15

User-requested maintenance (G7/G11/G18); numbered steps 04–22 remain pending.

- Reproduced against the live production site in a fresh Chromium context: after
  installing the worker online, `/manga-reader/` rendered offline, while
  `/manga-reader` failed with `net::ERR_INTERNET_DISCONNECTED`. The live server
  redirects the bare URL into `/manga-reader/`, but that redirect requires a
  network connection; the existing worker scope excluded the bare URL.
- `src/updates.ts` registers scope `/manga-reader` for hosted installs, and retires
  the old exact `/manga-reader/` registration only after the replacement activates.
  Existing tabs are not forcibly reloaded; Save & reload remains intact.
- `src/main.tsx` removes the trailing slash from the router basename so the bare
  URL renders after the worker serves its cached shell. Legacy hash matching keeps
  a path boundary. `vite.config.ts` excludes sibling prefixes from shell fallback.
- `public/_headers` supplies `Service-Worker-Allowed: /`; the existing parent
  deployment header merger carries it to the root `_headers`. The actual hosted
  registration remains limited to `/manga-reader`. Root hosting still uses `/`.
- `npm run build`: PASS, including TypeScript and regenerated tracked `dist/`;
  existing bundle-size advisory only. Targeted Prettier and `git diff --check`: PASS.
- Temporary ignored harness `node test-results/offline-check.mjs`: PASS against
  built files served locally with the required header. Started with HEAD's old
  build, explicitly activated its update, then verified migration left exactly
  one active registration at the new scope. Checked bare entry, slash entry,
  bookmarks and chapter route with Chromium offline, then with networking enabled
  but the server deliberately never responding: all eight rendered in 22–28 ms.
  A separate fresh context installed at the domain root and reloaded offline: PASS.
  Chapter check verifies app startup/missing-title UI, not filesystem permission.
- No new permanent test suite, dependencies, schema changes, or library writes.
  Live deployment was not performed. Updated build and headers must be deployed
  together, then downloaded online before the fix can work offline. Development
  mode intentionally does not register a worker. Native mobile/Safari not checked.

## Step 04 — Input and Backup Validation — 2026-11-06

- Re-code plan step 04 under G5/G7/G15 completed.
- Created `src/validation.ts` implementing `validateBackup`, `parsePosition`, `parseSettings`,
  `parseManga`, `parseChapter`, `parsePage`, and `validateRelativePath`.
- Untrusted data (external backup JSON, imported positions, settings payloads) is validated
  at the ingestion boundary before dereferencing or persisting to IndexedDB.
- Checks:
  - Null/undefined roots and non-objects throw `ValidationError`.
  - Unsupported backup versions (other than 1 or 2) throw `ValidationError`.
  - Traversal path attempts (`../escape`, `dir/../escape`, `/absolute`, `dir/./curr`, Windows `\`) throw `ValidationError`.
  - Fractional or non-integer `Position.page` indexes throw `ValidationError`.
  - `NaN` or infinite position fractions throw `ValidationError`.
  - Malformed bookmark collections throw `ValidationError`.
  - Duplicate page paths within a chapter throw `ValidationError`.
  - Non-integer or non-positive page pixel dimensions throw `ValidationError`.
  - Duplicate manga IDs across a single backup payload throw `ValidationError`.
  - Allowlisted record construction: `parseSettings` and `parseManga` extract only validated fields,
    stripping arbitrary unvalidated properties and falling back to safe defaults without spreading.
- Re-exported compatibility signatures from `src/data.ts`.
- Added unit test suite `tests/validation.spec.ts` and npm script `test:validation`.
- Verified: `npm run test:validation` (13/13 unit tests PASS in 432ms); `npm run build` PASS; `npm run electron:compile` PASS.

## Step 05 — Validate Stored Settings and Metadata on Read — 2026-11-06

- Re-code plan step 05 under G5/G7/G12 completed.
- Integrated validators directly into IndexedDB read paths and settings writes:
  - `src/App.tsx`: App initialization now passes retrieved settings through `parseSettings`,
    migrating legacy properties (`advance: false` -> `endAction: 'stop'`), computing missing `customSeconds`,
    and preserving `shelfSort` without blind object spreading.
  - `src/App.tsx`: `setSettings` strictly validates setting payloads before saving to IndexedDB.
  - `src/data.ts`: `listLibrary` validates all stored summaries through `parseSummary`, discarding
    corrupt or empty summary entries so damaged records cannot crash the library view.
  - `src/data.ts`: `getManga` validates retrieved manga records through `parseManga`, safely
    attaches blobs, validates progress positions via `parsePosition`, and normalizes bookmarks.
    Malformed records return `undefined` with a console warning rather than throwing uncaught TypeErrors.
  - `src/validation.ts`: Extended `parseManga` to preserve `localPath`, `handle`, and `cover` for local
    storage reads, while stripping them for external backup validation. Added `parseSummary`.
- Extended `tests/validation.spec.ts` with coverage for `parseSummary` sanitization, `shelfSort` preservation,
  legacy setting migration, and `localPath` desktop persistence.
- Verified: `npm run test:validation` (16/16 unit tests PASS in 528ms); `npm run build` PASS; `npm run electron:compile` PASS.

## Electron Startup Route Bug & Desktop Packaging v1.1.0 — 2026-11-06

- Diagnosed and resolved the root cause of the `"This title isn’t in your library."` start-page bug on Electron app launch:
  - Root cause 1 (Preload CommonJS vs ESM): Root `package.json` specifies `"type": "module"`. When `electron/preload.ts` was compiled with `tsc`, it emitted ES module syntax (`import { contextBridge, ipcRenderer } from 'electron'`). Electron's `webPreferences.preload` runner uses CommonJS `require()`, throwing `REQUIRE ERROR: The requested module 'electron' does not provide an export named 'contextBridge'`.
  - Root cause 2 (Electron API missing): Because the preload script crashed during evaluation, `contextBridge.exposeInMainWorld('electronAPI', ...)` never executed, leaving `window.electronAPI` undefined.
  - Root cause 3 (Router fallback): In `src/main.tsx`, `isElectron` evaluated solely based on `!!window.electronAPI?.isElectron`. With `window.electronAPI` undefined, the app defaulted to `BrowserRouter`.
  - Root cause 4 (Route collision with `/:slug`): Electron loads production assets via `file:///.../dist/index.html`. `BrowserRouter` parsed the pathname as `/index.html`. In `src/App.tsx`, `<Route path="/:slug" element={<MangaDetails />} />` matched with `:slug = "index.html"`. `MangaDetails` queried IndexedDB for a title named `"index.html"`, found no match, and displayed `"This title isn’t in your library."`.
- Applied three layers of defense:
  1. Preload CommonJS fix: Created `electron/preload.cjs` using native `require('electron')`, immune to package `"type": "module"`. Updated `electron/main.ts` `PRELOAD_PATH` to point to `preload.cjs`. Updated `package.json` `"electron:compile"` script to copy `electron/preload.cjs` into `electron-dist/preload.cjs`.
  2. Router detection & HashRouter normalization: Broadened `isElectron` detection in `src/main.tsx` to check `location.protocol === 'file:' || navigator.userAgent.includes('Electron') || !!window.electronAPI?.isElectron`. In Electron with `HashRouter`, explicitly initializes `location.hash = '#/'` if empty.
  3. Route guards: Added an explicit `<Route path="/index.html" element={<Library ... />} />` in `src/App.tsx` ahead of `/:slug`. Added an automatic navigation redirect in `src/MangaDetails.tsx` if `slug === 'index.html'` (`nav('/', { replace: true })`).
- Set Inter font size to 16px: Updated `:root` and `body` in `src/style.css` to base `16px`, and updated all UI font-size declarations across `src/style.css` and `src/controls.css` to `16px`. Adjusted page input widths to prevent truncation on narrow viewports.
- Verified:
  - `npm run test:validation`: PASS (16/16 unit tests in 472ms).
  - `npm run build`: PASS.
  - `npm run electron:compile`: PASS.
  - `npm run format:check`: PASS.
  - `npm run electron:build`: PASS. Successfully built `release/Manga Reader Setup 1.1.0.exe` (112,980,308 bytes).
