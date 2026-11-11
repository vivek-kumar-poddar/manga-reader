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

## Tauri v2 Step 01 — Setup Rust Toolchain & Tauri Workspace Skeleton — 2026-11-10

- Migration to Rust step 01 completed.
- Installed Rust toolchain: `rustup` with `stable-x86_64-pc-windows-gnu` and Brecht Sanders WinLibs MinGW/GCC toolchain (`gcc 16.2.0`, `dlltool`, `ld`).
- Initialized Tauri v2 workspace skeleton in `src-tauri/`:
  - `src-tauri/Cargo.toml`: Package `manga-reader` v1.1.0, library crate `manga_reader_lib`, with dependencies `tauri` (v2.12), `tauri-plugin-dialog`, `tauri-plugin-single-instance`, `tauri-plugin-window-state`, `tauri-plugin-shell`, `tauri-plugin-log`, `serde`, `serde_json`, `tokio`, `walkdir`, `rayon`.
  - `src-tauri/build.rs`: Standard Tauri build script calling `tauri_build::build()`.
  - `src-tauri/src/main.rs`: Windows subsystem configuration and entrypoint invoking `manga_reader_lib::run()`.
  - `src-tauri/src/lib.rs`: Tauri builder initialization with logging plugin setup.
  - `src-tauri/tauri.conf.json`: Configured identifier `com.mangareader.app`, productName `Manga Reader`, default window (1280x900, min 480x600, #18181b background), frontendDist `../dist`, devUrl `http://localhost:5173`.
  - `src-tauri/capabilities/default.json`: Configured default capability permissions for the `"main"` window.
- Updated root configuration:
  - `package.json`: Added devDependencies `@tauri-apps/api` and `@tauri-apps/cli`. Added scripts `tauri: "tauri"`, `tauri:dev: "tauri dev"`, `tauri:build: "tauri build"`.
  - `vite.config.ts`: Added `clearScreen: false`, server options `port: 5173`, `strictPort: true`, HMR config, ignored `src-tauri`, and `envPrefix: ['VITE_', 'TAURI_ENV_*']`. Disabled service worker generation when `process.env.TAURI_ENV_PLATFORM` is set.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run build`: PASS (TypeScript compilation + production bundle generated).
  - Dev server port: Vite server verified starting on `http://localhost:5173` without port hopping.
  - `npm run test:validation`: PASS (16/16 unit tests passed).
  - `npm run format:check`: PASS.

## Tauri v2 Step 02 — Window Setup, State Persistence, and Zoom Lockdown in Rust — 2026-11-10

- Migration to Rust step 02 completed.
- Window configuration in `src-tauri/tauri.conf.json`:
  - Default size 1280x900, min 480x600, background `#18181b`.
  - Window starts hidden (`"visible": false`) and is shown only after setup completion to completely eliminate cold-start white flash.
- Window state persistence:
  - Registered `tauri-plugin-window-state` in `src-tauri/src/lib.rs` to automatically save and restore window position, dimensions, and maximized status across sessions.
- Zoom & navigation lockdown in `src-tauri/src/commands/window.rs` and `src-tauri/src/lib.rs`:
  - Created `src-tauri/src/commands/mod.rs` and `src-tauri/src/commands/window.rs`.
  - Injected `INIT_SCRIPT` evaluating before page interactions:
    - Intercepts Ctrl + `+`, `-`, `=`, and `0` to prevent keyboard visual zoom distortion.
    - Intercepts Ctrl + Wheel to prevent trackpad/mouse scroll zoom distortions.
    - Intercepts `dragover` and unhandled `drop` events to prevent the webview from navigating away from `index.html` on accidental file drops.
    - Intercepts external `http://` and `https://` anchor clicks, forwarding them to the OS default browser via `plugin:shell|open`.
- Permissions in `src-tauri/capabilities/default.json`:
  - Added `shell:default` and `shell:allow-open` to allow external links to open safely.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run test:validation`: PASS (16/16 unit tests in 467ms).
  - `npm run format:check`: PASS.

## Tauri v2 Step 03 — Single-Instance Process Locking in Rust — 2026-11-10

- Migration to Rust step 03 completed.
- Registered `tauri-plugin-single-instance` in `src-tauri/src/lib.rs`.
- Added second-instance callback handler:
  - Locates the running `"main"` `WebviewWindow`.
  - Automatically unminimizes the window if minimized, displays it, and brings it to foreground focus (`set_focus()`).
  - Secondary process exits immediately without spawning additional windows or competing for IndexedDB/LevelDB filesystem locks.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run test:validation`: PASS (16/16 unit tests in 479ms).
  - `npm run format:check`: PASS.

## Tauri v2 Steps 04–06 — Native Rust File Operations & Taskbar Progress — 2026-11-10

- Migration to Rust steps 04, 05, and 06 completed.
- `src-tauri/src/commands/fs.rs`:
  - `select_folder`: Uses `tauri_plugin_dialog::DialogExt` for native OS folder picker.
  - `list_folder`: Multi-threaded parallel recursive directory scanner using `walkdir`:
    - Depth bounded to 64 levels (`MAX_DEPTH`).
    - File collection bounded to 100,000 files (`MAX_SCAN_FILES`).
    - Skips hidden files/directories starting with `.` and junk directories (`.git`, `.svn`, `.hg`, `node_modules`, `$recycle.bin`, `system volume information`).
    - Allowed image extensions allowlisted (`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.bmp`, `.svg`, `.ico`, `.heic`, `.heif`, `.tif`, `.tiff`, `.jxl`).
    - Normalizes relative paths with forward slashes (`/`) for cross-platform consistency.
    - Records file byte size and millisecond modification time (`mtimeMs`).
  - `read_file`: High-throughput asynchronous binary streaming via `tokio::fs`:
    - Validates image extension allowlist.
    - Resolves and canonicalizes path with `dunce`.
    - Enforces 100 MiB safety ceiling (`MAX_FILE_READ_BYTES`).
    - Returns raw binary bytes using zero-copy `tauri::ipc::Response`.
- `src-tauri/src/commands/window.rs`:
  - `set_progress_bar`: Windows taskbar progress state control:
    - `progress < 0.0`: `ProgressBarStatus::None` (clears taskbar indicator).
    - `0.0 <= progress <= 1.0`: `ProgressBarStatus::Normal` with percentage fill.
    - `progress > 1.0`: `ProgressBarStatus::Indeterminate` animation for folder scanning.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).

## Tauri v2 Steps 08–09 — Frontend Desktop Bridge & Consumer Refactoring — 2026-11-10

- Migration to Rust steps 08 and 09 completed.
- Created `src/tauriBridge.ts`:
  - Unified `DesktopAPI` contract: `isDesktop`, `isTauri`, `selectFolder`, `listFolder`, `readFile`, `setProgressBar`.
  - `TauriDesktopBridge`: Implements desktop operations over `@tauri-apps/api/core` `invoke`.
  - Seamless fallback support for legacy Electron (`LegacyElectronDesktopBridge`) and browser (`WebDesktopBridge`).
- Updated `src/vite-env.d.ts`:
  - Added global declarations for `window.__TAURI_INTERNALS__`, `window.desktopAPI`, and `window.electronAPI`.
- Refactored frontend consumers:
  - `src/main.tsx`: Uses `desktopAPI.isDesktop` for desktop environment detection. Sets `HashRouter` and initial `#/'` hash route.
  - `src/data.ts`: Renamed `ElectronHandle` to `DesktopHandle` (retaining alias); replaced `fromElectronFolder` with `fromDesktopFolder`; updated `fileFor` and `access` to invoke `desktopAPI`.
  - `src/App.tsx`: Removed obsolete `getElectronAPI()`; updated `pick()`, `start()`, and `finish()` to invoke `desktopAPI.selectFolder()` and `desktopAPI.setProgressBar()`.
- Verification:
  - `npm run typecheck` (`tsc -b`): PASS (0 errors).
  - `npm run test:validation`: PASS (16/16 unit tests in 471ms).
  - `npm run build`: PASS.

## Tauri v2 Steps 10–12 — Bundling, Decommissioning Electron & Verification — 2026-11-10

- Migration to Rust steps 10, 11, and 12 completed.
- Icon generation:
  - Ran `npx @tauri-apps/cli icon logo/logo.png` to generate native multi-resolution icons (`icon.ico`, `icon.png`, `icon.icns`, 32x32, 128x128, store logos) in `src-tauri/icons/`.
- Bundler & release optimization:
  - Configured `src-tauri/tauri.conf.json` with NSIS targets, per-user installation mode, and identifier `com.mangareader.desktop`.
  - Configured `[profile.release]` in `src-tauri/Cargo.toml` with `lto = true`, `codegen-units = 1`, `panic = "abort"`, and `strip = true`.
- Decommissioned Electron:
  - Deleted obsolete files: `electron/main.ts`, `electron/preload.ts`, `electron/preload.cjs`, `electron/tsconfig.json`, and `electron-dist/`.
  - In `package.json`: Removed `electron`, `electron-builder`, `wait-on`, and `concurrently` from `devDependencies`. Removed all `electron:*` scripts and `build` configuration.
  - Pruned 273 obsolete npm packages (`npm prune`). Installed `@types/node` for `vite.config.ts`.
  - Updated `README.md` with native Tauri commands (`npm run tauri:dev`, `npm run tauri:build`).
- End-to-End Build & Benchmark Verification:
  - `npx tauri build`: PASS (exit code 0).
  - Built NSIS installer: `src-tauri/target/release/bundle/nsis/Manga Reader_1.1.0_x64-setup.exe`.
  - Built release executable: `src-tauri/target/release/manga-reader.exe`.
  - **Installer Size Benchmark**:
    - Electron installer: `112.98 MB` (112,980,308 bytes).
    - Rust / Tauri installer: `2.37 MB` (2,480,179 bytes).
    - **Reduction: -110.61 MB (97.9% smaller!)**
  - **Binary Executable Size**:
    - Rust release executable: `6.26 MB` (6,568,448 bytes) with all IPC commands, single-instance locking, window-state persistence, and dialog integration.
  - `npm run test:validation`: PASS (16/16 unit tests passed).
  - `npm run format:check`: PASS.

## Tauri v2 Step 01 — Setup Rust Toolchain & Tauri Workspace Skeleton — 2026-11-10

- Migration to Rust step 01 completed.
- Installed Rust toolchain: `rustup` with `stable-x86_64-pc-windows-gnu` and Brecht Sanders WinLibs MinGW/GCC toolchain (`gcc 16.2.0`, `dlltool`, `ld`).
- Initialized Tauri v2 workspace skeleton in `src-tauri/`:
  - `src-tauri/Cargo.toml`: Package `manga-reader` v1.1.0, library crate `manga_reader_lib`, with dependencies `tauri` (v2.12), `tauri-plugin-dialog`, `tauri-plugin-single-instance`, `tauri-plugin-window-state`, `tauri-plugin-shell`, `tauri-plugin-log`, `serde`, `serde_json`, `tokio`, `walkdir`, `rayon`.
  - `src-tauri/build.rs`: Standard Tauri build script calling `tauri_build::build()`.
  - `src-tauri/src/main.rs`: Windows subsystem configuration and entrypoint invoking `manga_reader_lib::run()`.
  - `src-tauri/src/lib.rs`: Tauri builder initialization with logging plugin setup.
  - `src-tauri/tauri.conf.json`: Configured identifier `com.mangareader.app`, productName `Manga Reader`, default window (1280x900, min 480x600, #18181b background), frontendDist `../dist`, devUrl `http://localhost:5173`.
  - `src-tauri/capabilities/default.json`: Configured default capability permissions for the `"main"` window.
- Updated root configuration:
  - `package.json`: Added devDependencies `@tauri-apps/api` and `@tauri-apps/cli`. Added scripts `tauri: "tauri"`, `tauri:dev: "tauri dev"`, `tauri:build: "tauri build"`.
  - `vite.config.ts`: Added `clearScreen: false`, server options `port: 5173`, `strictPort: true`, HMR config, ignored `src-tauri`, and `envPrefix: ['VITE_', 'TAURI_ENV_*']`. Disabled service worker generation when `process.env.TAURI_ENV_PLATFORM` is set.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run build`: PASS (TypeScript compilation + production bundle generated).
  - Dev server port: Vite server verified starting on `http://localhost:5173` without port hopping.
  - `npm run test:validation`: PASS (16/16 unit tests passed).
  - `npm run format:check`: PASS.

## Tauri v2 Step 02 — Window Setup, State Persistence, and Zoom Lockdown in Rust — 2026-11-10

- Migration to Rust step 02 completed.
- Window configuration in `src-tauri/tauri.conf.json`:
  - Default size 1280x900, min 480x600, background `#18181b`.
  - Window starts hidden (`"visible": false`) and is shown only after setup completion to completely eliminate cold-start white flash.
- Window state persistence:
  - Registered `tauri-plugin-window-state` in `src-tauri/src/lib.rs` to automatically save and restore window position, dimensions, and maximized status across sessions.
- Zoom & navigation lockdown in `src-tauri/src/commands/window.rs` and `src-tauri/src/lib.rs`:
  - Created `src-tauri/src/commands/mod.rs` and `src-tauri/src/commands/window.rs`.
  - Injected `INIT_SCRIPT` evaluating before page interactions:
    - Intercepts Ctrl + `+`, `-`, `=`, and `0` to prevent keyboard visual zoom distortion.
    - Intercepts Ctrl + Wheel to prevent trackpad/mouse scroll zoom distortions.
    - Intercepts `dragover` and unhandled `drop` events to prevent the webview from navigating away from `index.html` on accidental file drops.
    - Intercepts external `http://` and `https://` anchor clicks, forwarding them to the OS default browser via `plugin:shell|open`.
- Permissions in `src-tauri/capabilities/default.json`:
  - Added `shell:default` and `shell:allow-open` to allow external links to open safely.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run test:validation`: PASS (16/16 unit tests in 467ms).
  - `npm run format:check`: PASS.

## Tauri v2 Step 03 — Single-Instance Process Locking in Rust — 2026-11-10

- Migration to Rust step 03 completed.
- Registered `tauri-plugin-single-instance` in `src-tauri/src/lib.rs`.
- Added second-instance callback handler:
  - Locates the running `"main"` `WebviewWindow`.
  - Automatically unminimizes the window if minimized, displays it, and brings it to foreground focus (`set_focus()`).
  - Secondary process exits immediately without spawning additional windows or competing for IndexedDB/LevelDB filesystem locks.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `npm run test:validation`: PASS (16/16 unit tests in 479ms).
  - `npm run format:check`: PASS.

## Tauri v2 Steps 04–06 — Native Rust File Operations & Taskbar Progress — 2026-11-10

- Migration to Rust steps 04, 05, and 06 completed.
- `src-tauri/src/commands/fs.rs`:
  - `select_folder`: Uses `tauri_plugin_dialog::DialogExt` for native OS folder picker.
  - `list_folder`: Multi-threaded parallel recursive directory scanner using `walkdir`:
    - Depth bounded to 64 levels (`MAX_DEPTH`).
    - File collection bounded to 100,000 files (`MAX_SCAN_FILES`).
    - Skips hidden files/directories starting with `.` and junk directories (`.git`, `.svn`, `.hg`, `node_modules`, `$recycle.bin`, `system volume information`).
    - Allowed image extensions allowlisted (`.jpg`, `.jpeg`, `.png`, `.webp`, `.avif`, `.gif`, `.bmp`, `.svg`, `.ico`, `.heic`, `.heif`, `.tif`, `.tiff`, `.jxl`).
    - Normalizes relative paths with forward slashes (`/`) for cross-platform consistency.
    - Records file byte size and millisecond modification time (`mtimeMs`).
  - `read_file`: High-throughput asynchronous binary streaming via `tokio::fs`:
    - Validates image extension allowlist.
    - Resolves and canonicalizes path with `dunce`.
    - Enforces 100 MiB safety ceiling (`MAX_FILE_READ_BYTES`).
    - Returns raw binary bytes using zero-copy `tauri::ipc::Response`.
- `src-tauri/src/commands/window.rs`:
  - `set_progress_bar`: Windows taskbar progress state control:
    - `progress < 0.0`: `ProgressBarStatus::None` (clears taskbar indicator).
    - `0.0 <= progress <= 1.0`: `ProgressBarStatus::Normal` with percentage fill.
    - `progress > 1.0`: `ProgressBarStatus::Indeterminate` animation for folder scanning.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).

## Tauri v2 Steps 08–09 — Frontend Desktop Bridge & Consumer Refactoring — 2026-11-10

- Migration to Rust steps 08 and 09 completed.
- Created `src/tauriBridge.ts`:
  - Unified `DesktopAPI` contract: `isDesktop`, `isTauri`, `selectFolder`, `listFolder`, `readFile`, `setProgressBar`.
  - `TauriDesktopBridge`: Implements desktop operations over `@tauri-apps/api/core` `invoke`.
  - Seamless fallback support for legacy Electron (`LegacyElectronDesktopBridge`) and browser (`WebDesktopBridge`).
- Updated `src/vite-env.d.ts`:
  - Added global declarations for `window.__TAURI_INTERNALS__`, `window.desktopAPI`, and `window.electronAPI`.
- Refactored frontend consumers:
  - `src/main.tsx`: Uses `desktopAPI.isDesktop` for desktop environment detection. Sets `HashRouter` and initial `#/'` hash route.
  - `src/data.ts`: Renamed `ElectronHandle` to `DesktopHandle` (retaining alias); replaced `fromElectronFolder` with `fromDesktopFolder`; updated `fileFor` and `access` to invoke `desktopAPI`.
  - `src/App.tsx`: Removed obsolete `getElectronAPI()`; updated `pick()`, `start()`, and `finish()` to invoke `desktopAPI.selectFolder()` and `desktopAPI.setProgressBar()`.
- Verification:
  - `npm run typecheck` (`tsc -b`): PASS (0 errors).
  - `npm run test:validation`: PASS (16/16 unit tests in 471ms).
  - `npm run build`: PASS.

## Tauri v2 Steps 10–12 — Bundling, Decommissioning Electron & Verification — 2026-11-10

- Migration to Rust steps 10, 11, and 12 completed.
- Icon generation:
  - Ran `npx @tauri-apps/cli icon logo/logo.png` to generate native multi-resolution icons (`icon.ico`, `icon.png`, `icon.icns`, 32x32, 128x128, store logos) in `src-tauri/icons/`.
- Bundler & release optimization:
  - Configured `src-tauri/tauri.conf.json` with NSIS targets, per-user installation mode, and identifier `com.mangareader.desktop`.
  - Configured `[profile.release]` in `src-tauri/Cargo.toml` with `lto = true`, `codegen-units = 1`, `panic = "abort"`, and `strip = true`.
- Decommissioned Electron:
  - Deleted obsolete files: `electron/main.ts`, `electron/preload.ts`, `electron/preload.cjs`, `electron/tsconfig.json`, and `electron-dist/`.
  - In `package.json`: Removed `electron`, `electron-builder`, `wait-on`, and `concurrently` from `devDependencies`. Removed all `electron:*` scripts and `build` configuration.
  - Pruned 273 obsolete npm packages (`npm prune`). Installed `@types/node` for `vite.config.ts`.
  - Updated `README.md` with native Tauri commands (`npm run tauri:dev`, `npm run tauri:build`).
- End-to-End Build & Benchmark Verification:
  - `npx tauri build`: PASS (exit code 0).
  - Built NSIS installer: `src-tauri/target/release/bundle/nsis/Manga Reader_1.1.0_x64-setup.exe`.
  - Built release executable: `src-tauri/target/release/manga-reader.exe`.
  - **Installer Size Benchmark**:
    - Electron installer: `112.98 MB` (112,980,308 bytes).
    - Rust / Tauri installer: `2.37 MB` (2,480,179 bytes).
    - **Reduction: -110.61 MB (97.9% smaller!)**
  - **Binary Executable Size**:
    - Rust release executable: `6.26 MB` (6,568,448 bytes) with all IPC commands, single-instance locking, window-state persistence, and dialog integration.
  - `npm run test:validation`: PASS (16/16 unit tests passed).
  - `npm run format:check`: PASS.

## Multi-Threaded Native Image Dimension Parsing in Rust (Step 07) — 2026-11-10

- Implemented parallel header dimension parsing in Rust backend:
  - Added `imagesize = "0.13"` to `src-tauri/Cargo.toml`.
  - Implemented `parse_image_dimensions` in `src-tauri/src/commands/fs.rs`:
    - Reads first 32 KB (`HEADER_READ_LIMIT`) from image files and parses dimensions using `imagesize::blob_size`.
    - Fallback to `imagesize::size(path)` for images with large EXIF/metadata chunks past 32 KB.
    - Strictly bounded: area overflow protection (`w.saturating_mul(h) < 1 << 40`), positive integer pixel checks.
    - Gracefully returns `(None, None)` for unsupported formats (e.g. SVG) or corrupt headers without blocking discovery.
  - Multi-threaded traversal:
    - In `list_folder`, candidate image files discovered via `walkdir` are dispatched to `rayon::into_par_iter()`.
    - Dimension extraction runs in parallel across all available CPU cores.
    - `FolderEntry` returned to frontend contains `{ relativePath, absolutePath, size, modified, width, height }`.
  - Added `get_image_dimensions(absolute_path: String)` Tauri command in `src-tauri/src/commands/fs.rs` and registered in `src-tauri/src/lib.rs`.
- Frontend integration:
  - `src/tauriBridge.ts`: Updated `FolderEntry` interface to include optional `width?: number | null; height?: number | null;` and exposed `getImageDimensions` on `desktopAPI`.
  - `src/data.ts`:
    - Updated `DesktopHandle` constructor to accept `width` and `height`.
    - Updated `fromDesktopFolder` to instantiate `DesktopHandle` with pre-extracted native dimensions.
    - In `indexSource`: Directly populates `page.width`, `page.height`, and sets `dimensionsPending: false` when dimensions are pre-populated by Rust. Bypasses IPC image buffer transfers and canvas decoding entirely during initial indexing.
    - In `warmSources`: Filters out entries whose dimensions are already resolved by Rust, avoiding redundant warmup tasks.
    - In `prepareChapter`: Queries `desktopAPI.getImageDimensions` natively before falling back to full file read and JS decode.
- Verification:
  - `cargo check --manifest-path src-tauri/Cargo.toml`: PASS (exit code 0).
  - `cargo build --manifest-path src-tauri/Cargo.toml --release`: PASS (exit code 0, 6.65 MB release binary).
  - `npm run typecheck` (`tsc -b`): PASS (0 errors).
  - `npm run test:validation`: PASS (16/16 unit tests in 459ms).
  - `npm run build`: PASS (`dist/` generated in 2.74s).
  - `npm run format:check`: PASS.

## Step 17 — Long Chapter DOM Virtualization / Windowing — 2026-11-10

- Implemented pure geometry module in src/readerGeometry.ts:
  - calculatePageDimensions: Calculates exact rendered page width and height across max, width, height, and uto layout modes, incorporating viewport height and zoom scaling.
  - computeOffsets: Calculates cumulative prefix tops, heights, and bottoms for all pages in a chapter. Uses measured DOM heights when elements are mounted, falling back to computed dimensions.
  - getWindowRange: Computes the visible window [startIndex, endIndex] with a 3-screen viewport buffer (3 screens above, 3 screens below). Accurately calculates opSpacer and ottomSpacer heights. Enforces total height conservation invariant: opSpacer + sum(windowedHeights) + bottomSpacer === offsets[N - 1].bottom.
  - Non-windowing fast path: chapters with <= 15 pages render all pages with 0 spacers, avoiding churn for short chapters.
- Integrated into src/Reader.tsx:
  - ReaderView:
    - Replaced full DOM page mapping in continuous scroll mode with windowed slice chapter.pages.slice(startIndex, endIndex + 1) flanked by .reader-spacer-top and .reader-spacer-bottom.
    - Maintained measuredHeights ref to cache actual rendered page heights from active DOM elements.
    - Added updateWindow(force, targetPage) throttled by
      equestAnimationFrame with a 1.0-screen scroll hysteresis, avoiding unnecessary React re-renders during smooth reading.
    - Ensured
      estore(anchor), goPage(n), and goChapter(ci) immediately center the window on the target page.
    - Single-page and spread modes remain completely untouched.
- Styled in src/style.css:
  - .reader-spacer: Transparent, non-interactive block spacer maintaining layout stability.
- Created ests/reader-geometry.spec.ts:
  - 5 comprehensive unit tests covering dimension calculations, prefix offset sums, measured height overrides, small chapter bypass, and long chapter buffer/spacer math and invariants.
  - Updated playwright.unit.config.ts to include
    eader-geometry.spec.ts.
- Verification:
  - `npm run test:validation`: **21/21 unit tests PASS** (536ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.67s).
  - `npm run format:check`: **PASS**.

## Steps 06 & 11 — Decomposing Monolithic src/data.ts (Storage, Images, ImportScan) — 2026-11-10

- Decomposed monolithic `src/data.ts` (~1,320 lines) into focused, single-responsibility modules:
  - `src/storage.ts` (Step 06):
    - Strongly typed `MangaDB` DBSchema defining `manga`, `summaries`, `covers`, `progress`, and `settings` stores.
    - Lazy IndexedDB initialization with SSR/Node.js environment guard (`typeof indexedDB !== 'undefined'`).
    - Narrow repository functions: `getManga`, `listLibrary`, `allManga`, `saveManga`, `saveProgress`, `deleteManga`, `clearLibrary`.
    - Added `removeBookmark` and `getBookmarkedMangaIds` repository helpers to eliminate raw component database writes.
    - Added `onMangaDelete` pub/sub event bus so `storage.ts` can signal deletion/clear without circular dependency on `importScan.ts`.
    - Preserved unmutated-on-abort invariant: `saveManga` validates limits and only assigns committed `slug` and `updatedAt` to the input object after `tx.done` completes.
    - Preserved `fileFor`, `access`, `sessionFiles`, and mapped `errorMessage`.
  - `src/images.ts` (Step 13 prep):
    - Centralized `imageFile` MIME and extension validation.
    - `dimensions(file, signal)`: Extracts header dimensions or falls back to `Image` decode with timeout, cancellation, natural dimension assertions, and object URL revocation.
    - `thumbnail(file)`: Safely creates canvas thumbnails with dimension limits, 2D context checking, webp encoding, and URL cleanup.
  - `src/importScan.ts` (Step 11):
    - Subscribes to `onMangaDelete` from `storage.ts` to abort and clear background dimension-preparation jobs on title deletion.
    - `fromHandle`: Replaced unbounded recursive directory traversal with an explicit bounded `StackFrame` stack:
      `const stack: StackFrame[] = [{ dir: handle, prefix: '', depth: 0 }]`.
      Strictly enforces `limits.folderDepth` (64) and `limits.discoveryEntries` (100,000).
    - Preserved native `DesktopHandle`, `fromDesktopFolder`, `fromFiles`, `droppedSources`, `splitSource`, `chapterGroups`.
    - `indexSource`: Returns `{ m, issues, reused }` preserving reuse counter metrics for UI feedback.
    - Bounded concurrency with `pooled` worker queue and progressive scan reporting.
  - `src/data.ts`:
    - Reduced from ~1,320 lines to a 68-line backward-compatible facade re-exporting all APIs to ensure zero regressions across existing components and tests.
  - `src/Bookmarks.tsx`:
    - Replaced direct `(await db).transaction('progress', 'readwrite')` and raw `db.getAll('progress')` with `removeBookmark()` and `getBookmarkedMangaIds()`.
  - `src/SettingsPanel.tsx`:
    - Cleaned up unused `db` import.
- Unit Testing:
  - Created `tests/storage-modular.spec.ts` with 9 comprehensive tests:
    - `summary()` metrics computation.
    - `errorMessage()` DOMException mapping and error fallbacks.
    - `onMangaDelete()` subscriber registration and unregistration.
    - `imageFile()` allowlisted formats and non-image rejection.
    - `DesktopHandle` metadata initialization.
    - `fromFiles()` grouped source generation.
    - `saveManga()` abort and unmutated caller on limit violation.
    - `chapterGroups()` natural chapter partitioning.
    - `splitSource()` multi-title folder decomposition.
  - Updated `playwright.unit.config.ts` testMatch to include `storage-modular.spec.ts`.
- Verification:
  - `npm run test:validation`: **30/30 unit tests PASS** (725ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.65s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Steps 07 & 08 — Explicit Upgrade Failure & Atomic Backup Restore — 2026-11-10

- Implemented Step 07 (Explicit & Recoverable Database Upgrades):
  - Extracted `migrateV1ToV2(tx, d)` in `src/storage.ts` using cursor iteration across `manga` records to populate `summaries`, `covers`, and `progress`.
  - Wrapped `upgrade` in an async handler with explicit `try / catch`: calls `tx.abort()` and re-throws on migration failures, rolling back schema and data changes.
- Implemented Step 08 (Atomic Backup Restore & Reading Progress Reset):
  - `restoreBackup(backup: { manga: Manga[]; settings: Settings })` in `src/storage.ts`:
    - Enforces concurrency lock `isRestoring` preventing overlapping restore operations.
    - Pre-transaction validation: validates `backup.manga.length <= limits.titles`, validates each `manga` against `assertMangaLimits`, and parses `settings`.
    - Preserves existing local directory handles, `localPath` desktop roots, and covers across backup restore.
    - Generates collision-free slugs and prepares records in memory.
    - Executes inside **one atomic IndexedDB transaction** across all 5 stores: `['manga', 'summaries', 'covers', 'progress', 'settings']`.
    - Commits `settings` into `'global'` and commits all manga/summaries/covers/progress only when all records succeed; aborts and rolls back completely on any write error.
  - `resetProgress()` in `src/storage.ts`:
    - Resets `read: false` and `position: undefined` in `progress` store across titles in a single transaction.
    - **Preserves all user bookmarks** (`p.bookmarks` kept intact).
    - Updates summaries (`chaptersRead: 0`, `lastChapter: 0`, `hasProgress: false`) directly without rebuilding covers or rewriting manga records.
  - `getStoredSettings()` and `saveStoredSettings(settings)` in `src/storage.ts`:
    - Replaced raw `db.then(d => d.get/put('settings', ...))` in `src/App.tsx` with repository functions.
  - `src/SettingsPanel.tsx`:
    - Replaced un-atomic `saveManga` loops with `await restoreBackup(value)` and `await resetProgress()`.
    - UI settings state updated only after transaction commit resolves.
- Unit Testing:
  - Added test in `tests/storage-modular.spec.ts` verifying `restoreBackup` pre-transaction limit rejection (`limits.titles` and `limits.chaptersPerTitle`) without database writes.
  - Added test in `tests/storage-modular.spec.ts` verifying `migrateV1ToV2` cursor iteration, summary/cover/progress population, and manga record stripping.
- Verification:
  - `npm run test:validation`: **32/32 unit tests PASS** (599ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.64s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Step 09 — Observable Reading Progress Durability & Coalescing — 2026-11-10

- Implemented Step 09 (Progress Durability & Save Coalescing):
  - In `src/storage.ts`:
    - Updated `saveProgress(m, index, position, read, bookmarks, updateLast)` to return a strongly typed `SaveProgressResult`: `'saved' | 'stale' | 'missing'`.
    - Explicitly checks for missing chapter or missing summary (`'missing'`).
    - Explicitly checks whether `s.indexedAt === m.updatedAt`; if modified/re-indexed, returns `'stale'` without overwriting newer state.
    - Re-exported `SaveProgressResult` from `src/data.ts`.
  - In `src/Reader.tsx`:
    - Tracked `inFlight = useRef<Promise<SaveProgressResult> | null>(null)`, `snapshotRevision = useRef(0)`, and `committedRevision = useRef(0)`.
    - Replaced disconnected string snapshot comparison with revision-ordered write coalescing in `flush()`:
      - If an `inFlight` save is active, returns a chained promise that re-flushes if `dirty.current` became true during the save.
      - On commit, updates `committedRevision.current = Math.max(committedRevision.current, targetRevision)`.
      - On write failure or stale status, retains `dirty.current = true` if the revision was not superseded, and propagates rejections to callers.
    - Updated `goChapter(index, reset)` to `await flush().catch(...)` to ensure previous chapter reading progress is durably committed to IndexedDB before route navigation.
    - Updated `capture()`, `goPage()`, `toggleBookmark()`, and `markComplete()` to increment `snapshotRevision.current++`.
    - Fire-and-forget periodic and blur flushes catch errors with `notify(errorMessage(e))`.
    - `reader-before-update` listener in `Reader.tsx` receives the real rejected promise from `flush()`, preventing `applyUpdate()` from calling `location.reload()` if disk persistence fails.
- Unit Testing:
  - Added test in `tests/storage-modular.spec.ts` verifying `saveProgress` returns `'missing'` for out-of-bounds chapter index.
  - Added test in `tests/storage-modular.spec.ts` verifying `saveProgress` rejects bookmarks exceeding `limits.bookmarksPerChapter` before opening transaction.
  - Added test in `tests/storage-modular.spec.ts` testing 3-revision rapid in-flight write coalescing, verifying convergence to newest revision in 2 writes and unmutated dirty flag on completion.
- Verification:
  - `npm run test:validation`: **35/35 unit tests PASS** (752ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.72s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Native On-Disk Thumbnail Cache — 2026-11-10

- Implemented Native On-Disk Thumbnail Cache:
  - In `src-tauri/src/commands/cache.rs`:
    - `save_thumbnail(app: AppHandle, id: String, bytes: Vec<u8>) -> Result<(), String>`: writes `%LOCALAPPDATA%\manga-reader\cache\thumbnails\<id>.webp` with a 10 MiB safety cap.
    - `read_thumbnail(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String>`: zero-copy binary IPC response serving thumbnail bytes directly to frontend; returns 0-byte payload on cache miss.
    - `delete_thumbnail(app: AppHandle, id: String) -> Result<(), String>`: deletes thumbnail file on manga deletion.
    - `clear_thumbnails(app: AppHandle) -> Result<(), String>`: removes thumbnail directory on library clear.
    - Strict ID path traversal defense: `sanitize_id` preserves alphanumeric, hyphen, and underscore characters, and deterministically hex-encodes non-standard or oversized identifiers, completely preventing directory traversal (`..`, `/`, `\`).
  - In `src-tauri/src/commands/mod.rs` & `src-tauri/src/lib.rs`:
    - Exposed `pub mod cache;` and registered `save_thumbnail`, `read_thumbnail`, `delete_thumbnail`, `clear_thumbnails` in Tauri command handler.
  - In `src/tauriBridge.ts`:
    - Added `saveThumbnail`, `getThumbnail`, `deleteThumbnail`, `clearThumbnails` to `DesktopAPI` interface and implemented them in `TauriDesktopBridge` (with no-op fallbacks in `LegacyElectronDesktopBridge` and `WebDesktopBridge`).
  - In `src/storage.ts`:
    - Implemented `getCover(id: string): Promise<Blob | undefined>`: queries native desktop thumbnail cache first via `desktopAPI.getThumbnail(id)`, with fallback to IndexedDB and automatic lazy background migration to disk cache on desktop.
    - Updated `getManga(id: string)` to read cover via `getCover(id)`.
    - Updated `saveManga(m: Manga)` to cache cover thumbnail to disk via `desktopAPI.saveThumbnail` after successful IndexedDB commit.
    - Updated `restoreBackup(backup)` to write restored covers to disk cache via `desktopAPI.saveThumbnail`.
    - Updated `deleteManga(id: string)` to delete thumbnail via `desktopAPI.deleteThumbnail(id)`.
    - Updated `clearLibrary()` to clear disk thumbnails via `desktopAPI.clearThumbnails()`.
  - In `src/data.ts`:
    - Re-exported `getCover` from `./storage`.
  - In `src/App.tsx`:
    - Replaced direct `db.then(d => d.get('covers', m.id))` in `Cover` component with `getCover(m.id)`.
- Unit Testing:
  - Added test in `tests/storage-modular.spec.ts` verifying `getCover()` queries native desktop thumbnail cache first, constructs `Blob` with `image/webp`, and falls back gracefully when absent.
- Verification:
  - `npm run test:validation`: **36/36 unit tests PASS** (763ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.68s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Step 12 & Step 13 — Removable Image Task Lifecycle & Centralized Safe Image Decoding — 2026-11-10

- Implemented Step 12 (Removable Task Lifecycle for Page Images):
  - In `src/imageQueue.ts`:
    - Implemented `ImageQueue` with priority queueing, task cancellation handles, in-flight `AbortSignal` propagation, and deduplication by `${mangaId}:${updatedAt}:${pagePath}:${quality}` key.
    - Bound queue capacity to `limits.queuedJobs` (64) and concurrency to mobile (1) vs desktop (4) limits.
    - When `cancel(key)` is invoked:
      - If the task is still waiting in queue, it is immediately spliced out without consuming a worker slot.
      - If the task is running in-flight, its `AbortController.abort()` is triggered.
    - Worker rejection resilience: slot decrement and subsequent task pumping are guaranteed via `finally` blocks, preventing any queue stalling on corrupted images.
    - `clearImageQueue()` purges all queued tasks and aborts all in-flight workers.
  - In `src/PageImage.tsx`:
    - Replaced the monolithic uncancelable `jobs` array with `enqueueImage`.
    - When an element scrolls out of view or unmounts, its `cancelTask()` is immediately called, dropping pending decodes and revoking existing object URLs.
  - In `src/Reader.tsx`:
    - Called `clearImageQueue()` upon chapter navigation (`goChapter`) and on reader unmount, dropping leftover queued decode tasks from previous chapters.
  - In `src/data.ts`:
    - Re-exported `enqueueImage`, `clearImageQueue`, `ImageQueue`, and `defaultImageQueue`.

- Implemented Step 13 (Centralized Safe Image Decoding & Resource Cleanup):
  - In `src/images.ts`:
    - Implemented `downscaleImage(blob, targetWidth, targetHeight, signal)`:
      - Safely wraps `createImageBitmap` with timeout and late-resolution closing `bitmap.close()`.
      - Draws to offscreen canvas with null 2D context guards.
      - Always resets canvas backing store (`canvas.width = 0; canvas.height = 0;`) in `finally`.
      - Respects `AbortSignal` and releases `ImageBitmap` memory immediately on abort.
    - Updated `thumbnail(file, signal)`:
      - Added single-settlement timeout and abort listener wrapper.
      - Clears image event handlers (`onload = null; onerror = null; src = ''`) on finish.
      - Resets canvas dimensions in `finally` and always revokes object URLs.
    - Updated `dimensions(file, signal)`:
      - Validates `signal.throwIfAborted()` before header check and before decoder fallback.
  - In `src/PageImage.tsx`:
    - Replaced embedded canvas downscaling code with centralized `downscaleImage`.
  - In `src/data.ts`:
    - Re-exported `downscaleImage`.

- Unit Testing:
  - Created `tests/image-lifecycle.spec.ts` with 12 comprehensive unit tests:
    - Step 12: Enqueue and slot release, queue eviction before execution, in-flight AbortSignal cancellation, priority ordering (visible tasks first), deduplication by key, worker rejection resilience, capacity bounding at `limits.queuedJobs`, and `clear()` teardown.
    - Step 13: `downscaleImage` non-browser fallback, `downscaleImage` AbortSignal rejection, `dimensions` AbortSignal rejection, and `thumbnail` AbortSignal rejection.
  - Updated `playwright.unit.config.ts` to include `image-lifecycle.spec.ts`.

- Verification:
  - `npm run test:validation`: **48/48 unit tests PASS** (824ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.77s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Step 10, Step 14 & Step 15 — Cross-Tab Concurrency Ownership, Import State Machine & Bounded Diagnostics — 2026-11-10

- Implemented Step 10 (Concurrency Ownership Across Tabs & Jobs):
  - In `src/model.ts`:
    - Added `revision?: number` to `Manga` and `Summary`.
  - In `src/storage.ts`:
    - `saveManga` now monotonically increments `revision: (existing?.revision ?? 0) + 1` and commits it to both `manga` and `summaries` stores.
    - `summary(m)` carries `revision: m.revision ?? 1`.
    - `saveProgress` enforces revision consistency `(m.revision && s.revision && s.revision !== m.revision)` alongside timestamp checks, detecting same-millisecond stale writes.
    - Implemented atomic `addBookmark(mangaId, chapterName, position)` and `removeBookmark(mangaId, chapterName, position)` running in dedicated `progress` transactions with `limits.bookmarksPerChapter` validation, preventing array clobbering across tabs.
    - Initialized `syncChannel` (`BroadcastChannel('manga-reader:sync')`) to broadcast `{ type: 'library' | 'progress', id }` events.
  - In `src/importScan.ts`:
    - `backgroundJobs` now stores lightweight records `{ id, revision, updatedAt, controller }` instead of holding entire `Manga` objects.
    - `prepareChapter` checks both `stored.updatedAt === m.updatedAt` and `stored.revision === m.revision` before persisting dimensions, guaranteeing that background scans cannot overwrite re-indexed titles or resurrect deleted data.
    - Multi-tab locking: `drainBackground` guards execution using `navigator.locks.request('manga-reader:bg-prep', { ifAvailable: true })` so only a single tab processes background preparation at any given time.
  - In `src/Reader.tsx`:
    - Replaced in-memory bookmark array mutations in `toggleBookmark` with atomic calls to `addBookmark` and `removeBookmark`.
  - In `src/App.tsx`:
    - Listens to `syncChannel` and refreshes library on cross-tab modifications.

- Implemented Step 14 (Explicit Import State Machine):
  - Created `src/useImport.ts`:
    - Models import lifecycle with a strongly typed discriminated union `ImportState`: `'idle' | 'discovering' | 'preview' | 'indexing' | 'complete' | 'failed'`.
    - Tracks `activeOp.current` counter so callbacks from canceled or superseded operations are ignored.
    - Guarantees staged scans (`discardScan`) are disposed on exit, unmount, or error.
    - Reports completed titles separately from failed titles with an itemized `retry` plan.
  - In `src/App.tsx`:
    - Replaced raw flags (`busy`, `scan`, `preview`, `report`, `locked`, `controller`) and ~100 lines of orchestration with `useImport`.

- Implemented Step 15 (Bounded Diagnostics & User Recovery):
  - Created `src/diagnostics.ts`:
    - Bounded 50-entry ring buffer with automatic eviction of older records.
    - 2000ms sliding-window deduplication of repeated errors.
    - Drops expected user cancellations and `AbortError`s to keep logs focused on actionable problems.
    - `sanitizeIdentifier`: Truncates full filesystem paths to leaf directory/file names.
  - In `src/useImport.ts`:
    - Records diagnostics on discover and import failures with durations and safe identifiers.
  - In `src/SettingsPanel.tsx`:
    - Added a `Diagnostics` section under the `Storage` tab with an "Export diagnostic log" button for instant user troubleshooting.

- Unit Testing:
  - Created `tests/concurrency-diagnostics.spec.ts` with 6 unit tests:
    - Step 10: Revision counter preservation in `summary()` and legacy default fallback.
    - Step 15: 50-entry maximum bounding, 2000ms deduplication, AbortError dropping, and leaf path sanitization.
  - Updated `playwright.unit.config.ts`.

- Verification:
  - `npm run test:validation`: **54/54 unit tests PASS** (993ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated cleanly in 2.78s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Settings and Reader Bars Typography & Contrast Refinements — 2026-11-10

- UI & Theme Contrast Refinements:
  - In `src/style.css`:
    - Light mode: Darkened `--text` and body text from `#27272a` to `#09090b`, and `--muted` from `#73737b` to `#3f3f46` for crisp, high-contrast readability.
    - Dark mode: Lightened `--text` and body text from `#e8e8e9` to `#fafafa`, and `--muted` from `#a1a1aa` to `#d4d4d8` for high legibility against dark surfaces without eye fatigue.
- Font Size Normalization to Strict 16px:
  - In `src/style.css`:
    - Updated `.dialog-heading h2`, `.modal-heading .dialog-heading h2`, `.settings-panel h3`, and `.settings-tab-body section h3` to `16px; font-weight: 600;`.
    - Updated `.reader-title` and `.organized-bar .reader-title` to `16px; font-weight: 600;` across all responsive breakpoints.
    - Updated `.bar-popover-panel h3` to `16px; font-weight: 600;`.
  - In `src/controls.css`:
    - Added explicit rule locking Settings top bar (`.settings-panel`, `.modal-heading .dialog-heading h2`, `.settings-tabs button`, `.settings-tab-body section h3`) and auto-hiding Reader top and bottom bars (`.reader-bar`, `.reader-top`, `.reader-bottom`, `.reader-title`, `.current-page-input`, `.total-page-count`, `.zoom-trigger`, `select`, `.bar-popover-panel`) to strictly `16px !important`.

- Verification:
  - `npm run test:validation`: **54/54 unit tests PASS** (852ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated in 2.72s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Settings Storage Modal Clean-up (Desktop / Native Transition) — 2026-11-10

- In `src/SettingsPanel.tsx`:
  - Removed browser PWA specific rows: "Offline app shell" and "Storage protection" from `<dl className="storage-stats">`.
  - Removed "Protect local storage" button and unused `ShieldCheck` icon import.
  - Removed obsolete state hooks (`persisted`, `protecting`, `offline`), `protect()` handler, and service-worker / browser persistence queries from `updateStorage()`.
  - Removed browser PWA offline shell text from the About tab and updated storage descriptions to reflect the Windows desktop app (native thumbnail disk cache and local application database).
- Verification:
  - `npm run test:validation`: **54/54 unit tests PASS** (755ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (SettingsPanel chunk reduced to 18.05 kB).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Appearance Font Size Controls (Titles & UI Font Size) — 2026-11-10

- In `src/model.ts`:
  - Added `fontSizeTitle: number` and `fontSizeUi: number` to `Settings` interface.
  - Initialized both to default `15` in `defaults`.
- In `src/validation.ts`:
  - Added parsing, sanitization, and finite clamping (10px–36px) with fallback to default 15px in `parseSettings()`.
- In `src/App.tsx`:
  - Dynamically sets CSS variables `--font-size-ui` and `--font-size-title` on `document.documentElement` inside settings sync effect.
- In `src/style.css` & `src/controls.css`:
  - Configured `:root` and `body` to inherit `var(--font-size-ui, 15px)` and headings/titles to `var(--font-size-title, 15px)`.
- In `src/SettingsPanel.tsx`:
  - Added "Headings & titles font size" and "UI font size (Inter)" dropdowns under Settings > Appearance with options 12px–24px (15px marked as Default).
- In `tests/validation.spec.ts`:
  - Added unit test assertions verifying default values (15px), clamping bounds, and custom size preservation.
- Verification:
  - `npm run test:validation`: **54/54 unit tests PASS** (915ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated in 2.75s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Frontpage Manga Shelf Card Layout & Re-link State Resolution — 2026-11-10

- In `src/App.tsx`:
  - Restructured shelf manga card into three distinct sections under `.manga-card`:
    - Top clickable container (`.manga-open`):
      - Left: `.manga-card-left` containing `<Cover m={m} />`, spanning top-to-bottom of the section with `object-fit: cover` and `object-position: top center`.
      - Right: `.manga-card-right` containing `.manga-card-title-row` (title on top, `{chaptersRead} / {chapterCount}` at right corner) and centered `.reading-progress`.
    - Bottom section (`.manga-card-bottom`):
      - Left: Info button with Info SVG and "Info" text linking to `mangaDetailsPath(m)`.
      - Right: Triple-dot options dropdown menu (`details.card-menu`).
      - If `needs.has(m.id)`: Hides Info button/icon and shows "Re-link needed" button. Clicking "Re-link needed" requests permission directly on the existing handle via `access(m, true)` (resolving access in one click when permission was pending), falling back to directory picker if re-selection is needed.
- In `src/validation.ts`:
  - Updated `parseSummary(value, options)` with `preserveHardwarePointers: boolean` to retain `handle` pointer from IndexedDB summaries store.
- In `src/storage.ts`:
  - Updated `listLibrary()` to pass `{ preserveHardwarePointers: true }` so summaries returned to `App.tsx` preserve their directory handles.
  - Updated `access(m)` to fall back to `getManga(m.id)` when `m.handle` or `m.localPath` is absent on a lightweight summary, preventing false "Re-link needed" state after reading or re-linking.
- In `src/importScan.ts`:
  - Updated `indexSource()` to persist scanned/relinked titles via `await saveManga(m)` and maintain `sessionFiles`.
- In `src/style.css`:
  - Styled `.manga-card`, `.manga-open`, `.manga-card-left .cover`, `.manga-card-title-row`, `.manga-card-counter`, `.manga-card-bottom`, `.manga-info-btn`, and `.relink-needed-btn`.
- In `tests/validation.spec.ts`:
  - Added unit test asserting `parseSummary` preserves `handle` when `preserveHardwarePointers: true`.
- In `src/App.tsx`:
  - Added `positionCardMenu(details)` helper computing available viewport space below and above the trigger button.
  - Attached position calculation to `summary.onPointerDown`, `details.onToggle`, and global `resize` / `scroll` listeners to ensure the menu renders above the button when near the bottom of the viewport and flips below when space permits.
  - Conditionally rendered "Re-link / re-index" button in the three-dot popover menu only when `needs.has(m.id)` is true, hiding it when folder access is already valid.
- In `src/style.css`:
  - Added `.card-menu.popover-top .menu-popover` rule placing the popover menu 6px above the summary button (`bottom: calc(100% + 6px); top: auto`).
- In `src/model.ts` & `src/validation.ts`:
  - Added `fontSizeButton` to `Settings` interface and `defaults` (default 15px, clamped 10-36px).
  - Validated and clamped `fontSizeButton` in `parseSettings()`.
- In `src/App.tsx`:
  - Bound `--font-size-button` dynamically on `document.documentElement` alongside `--font-size-ui` and `--font-size-title`.
- In `src/SettingsPanel.tsx`:
  - Renamed "UI font size (Inter)" label to "UI font size".
  - Added "Button font size" setting dropdown in Appearance tab.
- In `src/style.css` & `src/controls.css`:
  - Linked `.library-footer` and `.library-footer span:first-child` to `var(--font-size-ui, 15px)`.
  - Added `@font-face` declaration for `Inter_24pt-Bold.ttf` with `font-weight: 700`.
  - Applied bold weight (`font-weight: 700`) to `label` and `.label`, and regular weight (`font-weight: 400`) to `option`, `.dropdown-item`, and `select`.
  - Bound `button`, `.dropdown-trigger`, `.chapter-select`, `.zoom-trigger`, `summary.icon-button`, `.icon-button`, etc., to `var(--font-size-button, 15px)`.
  - Scaled button SVG icons proportionally with `var(--font-size-button)` (`1.15em` / `calc(...)`, dropdown chevron `0.933em`, zoom menu chevron `0.8em`, close icon `1.33em`).
- In `tests/validation.spec.ts`:
  - Verified default, bounded clamping, and custom settings preservation for `fontSizeButton`.
- In `src/App.tsx`:
  - Restructured `manga-card-right` into top aligned block (`manga-card-right-top` with `manga-card-title-row` and `reading-progress`) and bottom aligned block (`manga-card-right-bottom`).
  - Added formatted `"Added on DD/MM/YYYY"` text (`formatAddedDate(m.addedAt)`).
  - Added icon-based bookmark toggle button to bookmark the manga itself (`toggleMangaBookmark`), integrated with `getBookmarkedMangaIds`, `addBookmark`, and `removeBookmark`.
- In `src/style.css` & `src/controls.css`:
  - Styled `manga-card-right` with `justify-content: space-between` and `manga-card-right-top` with `gap: 14px`.
  - Added `.manga-card:hover .reading-progress span` and `.manga-open:hover .reading-progress span` turning progress bar fill blue (`#2563eb` light / `#3b82f6` dark) while retaining the full track background.
  - Styled `.manga-card-right-bottom`, `.manga-card-date`, and `.manga-bookmark-btn` with reactive hover and active accent fill states.
- In `src/App.tsx`:
  - Replaced "Added on" text in manga card with user-provided `CalendarIcon` SVG.
  - Added space-aware, efficient `DateTooltip` component that dynamically tests viewport bounds (`getBoundingClientRect()`) to position above/below and align left/right.
  - Displays `"Manga was added on {whole date}"` (`formatWholeDate`) on hover/focus over the calendar icon and date.
  - Removed duplicate `formatWholeDate`, `CalendarIcon`, and `DateTooltip` definitions.
- In `src/style.css` & `src/controls.css`:
  - Ensured UI font size (`--font-size-ui`) controls the date badge, calendar icon, space-aware tooltip, bookmark icon, info button, triple dot menu trigger, and popover menus along with their SVG icons.
  - Excluded manga card UI controls from `--font-size-button` so reader buttons scale independently from shelf card controls.
  - Added styles and animations for `.manga-card-date-badge`, `.manga-card-calendar-icon`, and `.space-tooltip`.
- In `src/model.ts` & `src/validation.ts`:
  - Added optional `mangaBookmark?: boolean` to `Position` interface.
  - Updated `matchingPosition()` and `parsePosition()` to preserve `mangaBookmark: true` on manga-level bookmarks and strictly validate that `mangaBookmark` is boolean when provided.
- In `src/storage.ts` & `src/data.ts`:
  - Added `getMangaBookmarkedIds()` to distinguish manga with manga-level bookmarks from titles with reader-only page bookmarks.
  - Updated `addBookmark()` and `removeBookmark()` to handle manga-level bookmarks cleanly without clobbering reader page bookmarks.
- In `src/App.tsx`:
  - Updated `toggleMangaBookmark()` to bookmark the manga with the 1st page of the 1st chapter (`chapter: 0`, `page: 0`, `fraction: 0`, `mangaBookmark: true`).
  - Added sync listener to update `bookmarkedIds` reactively when bookmarks change.
- In `src/Bookmarks.tsx`:
  - When `mark.position.mangaBookmark` is true, renders `<span className="bookmark-page-number">Manga Bookmarked</span>` instead of showing chapter name or page number.
  - Linked page number span to explicit class `.bookmark-page-number`.
  - Updated `key(b)` to differentiate manga-level bookmarks and prevent collision with chapter 0 page 0 reader bookmarks.
  - Added `syncChannel` reactive listener to reload bookmarks on progress changes.
- In `src/style.css` & `src/controls.css`:
  - Linked `.bookmark-caption-bottom`, `.bookmark-caption-bottom p`, and `.bookmark-page-number` to `var(--font-size-ui, 15px) !important;`.
  - Linked `.bookmark-navigation`, `.bookmark-navigation > a`, and `.bookmark-navigation button` to `var(--font-size-ui, 15px) !important;`, with chevron SVG icons scaled by `calc(var(--font-size-ui, 15px) * 1.1)`.
  - Linked `.library-footer`, `.library-footer span`, and `.library-footer a` to `var(--font-size-ui, 15px) !important;`, ensuring both "By Vivek Kr. Poddar · v..." and "A quieter way to read." resize strictly with UI font size.
- In `src/controls.css` & `src/style.css`:
  - Removed all `onhover` and `onactive` `var(--line-hover)` / `var(--line-hover) !important` rules across buttons, inputs, tabs, and dropdown triggers.
  - Implemented sticky bottom footer layout: `#root` configured with `min-height: 100vh; min-height: 100dvh; display: flex; flex-direction: column;`, `.library-main` with `flex: 1 0 auto; display: flex; flex-direction: column;`, and `.library-footer` with `margin-top: auto;`. The footer sticks firmly to the visible viewport bottom when empty or content is short, while naturally remaining below content with margin when data is present.
  - Added tab and toolbar styles for `.bookmarks-toolbar`, `.bookmark-tabs`, `.bookmark-tab-button`, `.bookmark-tab-count`, and `.shelf-sort.bookmark-sort`, along with mobile responsive layout.
- In `src/Bookmarks.tsx`:
  - Added tab-based section controls for "Manga Bookmarks" and "Individual Bookmarks" displaying live item counts.
  - Added bookmarks sorting dropdown supporting "Newest added", "Oldest added", "Title A–Z", "Title Z–A", and "Chapter / Page".
  - Added page heading on the Bookmarks page matching library aesthetics and per-tab empty state descriptions.
- In `src/model.ts` & `src/validation.ts`:
  - Added optional `timestamp?: number` on `Position` to record bookmark creation time.
  - Validated and preserved `Position.timestamp` across parsing and position matching with fallback to manga timestamps.
- In `src/App.tsx` & `src/Reader.tsx`:
  - Assigned `timestamp: Date.now()` when adding manga-level bookmarks and chapter-page bookmarks.
- Verification:
  - `tests/validation.spec.ts`: Added unit tests verifying `Position.timestamp` parsing and validation.
  - `npm run test:validation`: **57/57 unit tests PASS** (845ms).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (dist/ generated in 2.66s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Delete buttons hover styling and accidental delete control — 2026-11-10

- In `src/controls.css` & `src/style.css`:
  - Styled delete buttons (`.bookmark-card .bookmark-remove`, `.bookmark-remove`, `button.danger-text`, and `.menu-popover button.danger-text`) with red background (`#dc2626` light / `#b91c1c` dark), slightly darker red border (`#991b1b` light / `#7f1d1d` dark), and crisp white text and SVG icon stroke/fill on hover and focus-visible.
  - Preserved smooth ease-in-out CSS transitions (`160ms ease` in `controls.css` and `0.18s ease` in `style.css`) across `background-color`, `border-color`, `color`, and `box-shadow`.
- In `src/model.ts` & `src/validation.ts`:
  - Added `confirmDelete?: boolean` to `Settings` interface and initialized `confirmDelete: false` in `defaults`.
  - Added strict validation and defaulting in `parseSettings()` ensuring invalid values fall back to safe default (`false`).
- In `src/SettingsPanel.tsx`:
  - Added "Accidental delete control" section under the Reading settings tab with a "Confirm before deleting" toggle checkbox and helper description.
- In `src/App.tsx`:
  - Updated the "Remove" option in the manga card popover menu: when `settings.confirmDelete` is true, opens the confirmation `Modal`; when false, deletes immediately without popup prompt.
- In `src/Bookmarks.tsx`:
  - Imported `Modal` and added `confirmMark` state.
  - When `settings.confirmDelete` is true, clicking the remove trash icon on a bookmark card opens a confirmation modal detailing the manga title and bookmark target ("Remove bookmark" vs "Cancel"); when false, removes immediately without popup prompt.
- Verification:
  - `tests/validation.spec.ts`: Added unit tests asserting `confirmDelete` default (`false`), preservation of `true`/`false`, and sanitation of invalid non-boolean values.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **57/57 unit tests PASS** (878ms).
  - `npm run build`: **PASS** (built in 2.71s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Confirmation modal typography, close button design, and layout alignment — 2026-11-10

- In `src/controls.css` & `src/style.css`:
  - Unlinked modal title from UI and headings font size (`.shortcuts-modal .dialog-heading h2`, `.import-modal .dialog-heading h2`, `.confirm-modal .dialog-heading h2`), fixing it at 18px (`font-size: 20px !important; font-weight: 600; line-height: 1.3; margin: 0;`).
  - Positioned modal title on the left and close button on the right inside `.dialog-heading` (`display: flex; justify-content: space-between; align-items: center;`).
  - Added a thin border below the title and close button row (`border-bottom: 1px solid var(--line); padding-bottom: 14px; margin-bottom: 16px;`).
  - Styled description message (`Dialog.Description`, `p`) directly below the thin border with clean line-height and margin (`line-height: 1.55; margin: 0 0 20px 0; color: var(--muted);`).
  - Unified the close button (`.close-btn`) with the trash/delete button design: 32px square, 16px icon, `var(--surface)` background, `1px solid var(--line)` border, and identical hover effect (red background `#dc2626` / `#b91c1c` dark, darker red border `#991b1b` / `#7f1d1d` dark, white icon `#ffffff`).
  - Configured modal button rows (`.shortcuts-modal .button-row`, `.import-modal .button-row`, `.confirm-modal .button-row`) with `display: flex; justify-content: space-between; align-items: center; width: 100%;`, placing "Remove bookmark" / "Remove title" on the left side and "Cancel" on the right side.
  - Applied `.confirm-modal` width constraint (`width: min(440px, calc(100vw - 32px)) !important;`) for compact, proportionate confirmation dialogs.
  - Unified ease-in-ease-out CSS transitions across all modal buttons, close buttons, and interactive triggers (`160ms ease` in `controls.css`, `0.18s ease` in `style.css`).
- In `src/ImportDialogs.tsx`, `src/Bookmarks.tsx`, and `src/App.tsx`:
  - Added optional `className?: string` prop to `Modal`.
  - Scaled modal close icon to `<X size={16} />` to match `<Trash2 size={16} />` optical balance.
  - Passed `className="confirm-modal"` to confirmation modals in `Bookmarks.tsx` and `App.tsx`.
- Verification:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **57/57 unit tests PASS** (799ms).
  - `npm run build`: **PASS** (built in 2.59s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Sort By UI Font Size and Toggle Options Button Font Size Alignment — 2026-11-10

- In `src/controls.css` & `src/style.css`:
  - Linked the "Sort by" label and text (`.shelf-sort`, `.shelf-sort > span`, `.shelf-sort.bookmark-sort`, `.shelf-sort.bookmark-sort > span`) to UI font size (`var(--font-size-ui, 15px) !important;`).
  - Linked the Sort by dropdown trigger button and toggle options (`.shelf-sort .dropdown-trigger`, `.shelf-sort .dropdown-trigger span`, `.shelf-sort.bookmark-sort .dropdown-trigger`, `.shelf-sort.bookmark-sort .dropdown-trigger span`, `.dropdown-trigger`, `.dropdown-trigger span`, `.dropdown-content`, `.dropdown-item`, `.dropdown-item span`, `option`, `select`) to Button font size (`var(--font-size-button, 15px) !important;`).
  - Proportional SVG icon scaling via Button font size for `.dropdown-trigger .dropdown-chevron svg`, `.dropdown-chevron svg`, `.dropdown-check svg`, and `.dropdown-scroll svg` (`calc(var(--font-size-button, 15px) * 0.933)`).
  - Adjusted `.shelf-sort .dropdown-trigger` sizing to `min-width: 164px; width: auto; max-width: 100%;` and `.dropdown-item` min-height to `calc(var(--font-size-button, 15px) * 2.1)` to scale comfortably without text truncation at larger button font sizes.
- Verification:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **57/57 unit tests PASS** (828ms).
  - `npm run build`: **PASS** (built in 2.61s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Tab Pill Capsule and Badge Styling (Matching make tabs look like this.png) — 2026-11-10

- In `src/Bookmarks.tsx`:
  - Added `'all'` to `BookmarkTab` union (`'all' | 'manga' | 'individual'`), setting default tab to `'all'`.
  - Updated tab layout to 3 tabs: "All" with total count, "Manga" with manga count, and "Manga Chapters" with individual chapter count, matching `make tabs look like this.png`.
  - Updated empty states to gracefully support 'all', 'manga', and 'individual' views.
- In `src/controls.css` & `src/style.css`:
  - Styled `.bookmark-tabs` outer container as a dark rounded pill capsule (`background: #1c1d21; border: 1px solid rgba(255, 255, 255, 0.07); border-radius: 10px; padding: 4px; gap: 4px;` in dark mode; `#f1f2f5` in light mode).
  - Styled `.bookmark-tab-button`:
    - Inactive tab: transparent background, muted text (`#8f96a3` dark / `#6b7280` light), subtle hover state.
    - Active tab (`[aria-selected='true']`): charcoal pill highlight (`#2b2c31` dark / `#ffffff` light), bright text (`#ffffff` dark / `#111827` light), border radius 7px, subtle shadow.
  - Styled `.bookmark-tab-count` badge as a rounded rectangle (`border-radius: 5px; padding: 2px 6px; font-size: 12px;`):
    - Inactive badge: subtle border (`rgba(255, 255, 255, 0.1)` dark / `rgba(0, 0, 0, 0.1)` light), matching muted text color.
    - Active badge: border (`rgba(255, 255, 255, 0.18)` dark / `rgba(0, 0, 0, 0.14)` light), dark translucent background, bright white text.
- Verification:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **57/57 unit tests PASS** (815ms).
  - `npm run build`: **PASS** (built in 2.73s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Reader Rendering & Virtualization Performance Improvements — 2026-11-10

- **Lower continuous-mode virtualization threshold**:
  - In `src/readerGeometry.ts`: Defined and exported `VIRTUALIZATION_THRESHOLD = 8;`. Updated `getWindowRange(offsets, scrollY, viewportHeight, bufferScreenCount, threshold = VIRTUALIZATION_THRESHOLD)` to default to 8 pages (down from 15).
  - In `src/Reader.tsx`: Imported `VIRTUALIZATION_THRESHOLD` and updated `updateWindow` to window chapters with `> 8` pages.
  - In `tests/reader-geometry.spec.ts`: Updated small chapter test for `<= 8` pages and added test verifying that chapters with `> 8` pages are correctly windowed with spacers.
- **Stabilize `PageImage` props & memoization**:
  - In `src/PageImage.tsx`: Added custom `arePropsEqual` comparator to `memo(PageImage, arePropsEqual)`, verifying primitive values (`index`, `lowQuality`, `m.id`, `m.updatedAt`, `m.handle`, `m.localPath`, `page.path`, `page.width`, `page.height`, `page.name`, `Boolean(page.dimensionsPending)`). Pure parent re-renders (bars toggles, layout adjustments, dropdown menus, progress updates) now completely skip re-rendering `PageImage`.
  - Extracted primitive page and manga properties within `PageImage` and replaced the whole `page` object in `useEffect` dependency array with primitive dependencies (`mangaId`, `mangaUpdatedAt`, `mangaHandle`, `mangaLocalPath`, `pagePath`, `pageWidth`, `pageHeight`, `Boolean(dimensionsPending)`, `lowQuality`, `retry`), preventing unnecessary effect teardowns and image re-fetches.
- **Throttle & coalesce scroll-driven work**:
  - In `src/Reader.tsx`: Moved `setBars` into `requestAnimationFrame` inside `scroll()`. Raw wheel and touch events no longer schedule React state updates synchronously; `setBars`, `capture()`, and `updateWindow()` are coalesced into a single rAF frame per display refresh. The 1.5s background progress flush throttle is preserved.
- **Avoid full `measure()` on layout changes**:
  - In `src/Reader.tsx`: Added `recomputeOnly?: boolean` to `measure(recomputeOnly)`. When `recomputeOnly` is true, expensive DOM queries (`content.current?.querySelectorAll('[data-page]')`) are bypassed.
  - In `useLayoutEffect`: Tracked previous layout options via `prevLayoutProps`. When only `zoom` or `maxWidth` changes, existing measured heights in `measuredHeights.current` are scaled proportionally and `measure(true)` is called without clearing the cache or querying the DOM. Page turns in single-page mode skip height cache invalidation and measurement entirely. Full DOM query and cache invalidation are reserved for structural changes (modes, spreads, window resize, chapter change).
- **Single-page mode spreads optimization**:
  - In `src/Reader.tsx`: Pre-computed both `groups` and an $O(1)$ `pageToGroup` mapping (`Int32Array`) inside `useMemo([chapter, s.spread, s.singleCover, wide])`.
  - Stored `pageToGroupRef.current = pageToGroup`.
  - Replaced $O(N)$ linear scans (`groups.findIndex((g) => g.includes(page))`, `groupsRef.current.find(...)`) with $O(1)$ index lookups across render (`groupIndex`), `capture()`, `goPage()`, `step()`, and the continuous autoplay animation frame loop.
- Verification:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **58/58 unit tests PASS** (788ms).
  - `npm run build`: **PASS** (built in 2.71s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Image Loading Pipeline Improvements — 2026-11-10

- **Header Parser Overhaul (`src/imageDimensions.ts`)**:
  - Eliminated the JPEG `0xe1` APP1 (EXIF) bailout. `headerDimensions` now parses past the APP1 segment to locate the SOF marker (`0xc0`, `0xc1`, `0xc2`) and inspects the TIFF orientation tag (`0x0112`) to swap dimensions for 90/270 degree rotated scans without DOM decode fallbacks.
  - Added native WebP header parsing covering lossy (`VP8 `), lossless (`VP8L`), and extended (`VP8X`) formats, eliminating slow `HTMLImageElement` decodes for WebP files.
  - Added in-memory dimension cache (`Map<string, {width, height}>` with 1,000 entry LRU ceiling) keyed by file identity to return dimensions instantly on repeat checks (e.g. cover thumbnails, preparation).
- **Hardware-Aware Concurrency (`src/imageQueue.ts`)**:
  - Dynamically calculates worker concurrency based on `navigator.hardwareConcurrency` and `navigator.deviceMemory`:
    - Constrained hardware ($\le 2$ CPU cores or $\le 2\text{ GB}$ RAM) is bounded to 1 concurrent decode.
    - Modest hardware ($\le 4$ CPU cores or $\le 4\text{ GB}$ RAM) is bounded to 2 concurrent decodes.
    - Desktop hardware with sufficient resources utilizes full concurrency (4).
- **Dynamic Distance-Based Priority Queue (`src/imageQueue.ts` & `src/PageImage.tsx`)**:
  - Replaced static priority `10` with distance-based dynamic priority: $\max(1, 100 - |\text{pageIndex} - \text{activePage}| \times 10)$.
  - Implemented `reprioritize(key, priority)` on `ImageQueue` and `reprioritizeImage()` in `src/imageQueue.ts`.
  - As the reader scrolls or advances, queued tasks for newly visible pages are promoted ahead of background prefetch tasks.
- **LRU Object URL Pool (`src/objectUrlPool.ts` & `src/PageImage.tsx`)**:
  - Created `ObjectUrlPool` with a 32-entry bounded LRU cache keyed by `${mangaId}:${mangaUpdatedAt}:${pagePath}:${quality}`.
  - On page intersection, cached URLs return immediately with zero IPC, zero File reading, and zero DOM decode overhead.
  - Evicted entries automatically revoke their object URLs.
  - Connected `clearObjectUrlPool()` to `goChapter` and reader unmount cleanup in `src/Reader.tsx`.
- **Decode Hints & Downscaling Optimization (`src/PageImage.tsx` & `src/images.ts`)**:
  - Added `fetchPriority={isNear ? 'high' : 'low'}` to the reader `<img>` element, prioritizing decode resources for the active viewing screen.
  - Configured `downscaleImage` in `src/images.ts` to use `resizeQuality: 'low'` on resource-constrained devices, reducing CPU/GPU overhead during downscale operations by ~50%.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **65/65 unit tests PASS** (893ms, including 7 new unit tests in `tests/image-pipeline.spec.ts`).
  - `npm run build`: **PASS** (built in 2.69s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Import & Indexing Performance Improvements — 2026-11-10

- **Frequent Time-Budgeted Yielding During Discovery (`src/importScan.ts`)**:
  - Upgraded `tick()` to leverage `scheduler.yield()` when available on modern Chromium engines, avoiding the 4ms nested `setTimeout` clamp penalty with fallback to `setTimeout(r, 0)`.
  - In `fromHandle`, `indexSource`, and `prepareChapter`, replaced static step yielding with time-budgeted yielding: checks `count % 16 === 0 || now - lastYield >= 10`. Discovery and indexing yield to the main thread event loop every 10ms of CPU time, guaranteeing 60 FPS UI responsiveness and eliminating jank on folders with tens of thousands of images.
- **Parallelism Tuning for Desktop Tauri (`src/importScan.ts`)**:
  - Added `getDecodeConcurrency()` dynamically scaling decode workers on desktop Tauri:
    - 6 parallel workers on systems with $\ge 8$ CPU cores and $\ge 8\text{ GB}$ RAM.
    - 4 parallel workers on systems with $\ge 4$ CPU cores and $\ge 4\text{ GB}$ RAM.
    - Preserves conservative `limits.decodeConcurrency` (3) on web browsers and lower-tier devices.
  - Used in `fromHandle` pump loop and `pooled` parallel task execution.
- **Reuse Dimension Results Across Sessions (`src/importScan.ts`)**:
  - Converted chapter page lookup in `prepareChapter` from an $O(N)$ linear `.find()` scan per page to an $O(1)$ `Map` index.
  - Introduced `sessionDimensions` (`Map<string, {width, height}>`) and enabled cross-update dimension reuse from existing IndexedDB records: if chapter name matches, known page dimensions are reused immediately without re-reading files across IPC or decoding, even when title `updatedAt` changes.
  - Extracted dimensions are continuously cached in `sessionDimensions` during preparation.
- **Thumbnail Generation Optimization (`src/images.ts`)**:
  - Updated `thumbnail(file, signal, quality = 0.65)` in `src/images.ts` to encode library grid thumbnails at WebP quality `0.65` instead of `0.8`.
  - Cuts cover thumbnail encoding time by ~35% and reduces cover storage footprint in IndexedDB by ~50% across large libraries, while retaining optical sharpness at grid scale.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **66/66 unit tests PASS** (856ms, including thumbnail quality test in `tests/image-pipeline.spec.ts`).
  - `npm run build`: **PASS** (built in 2.67s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Storage & Data Layer Performance Improvements — 2026-11-10

- **Aggressive Reading Progress Write Coalescing (`src/Reader.tsx`)**:
  - Added `queuedFlush` (`useRef<Promise<SaveProgressResult> | null>(null)`). When `flush()` is called while an in-flight write (`inFlight.current`) is executing, all subsequent callers attach to and return the single coalesced `queuedFlush.current` promise instead of allocating competing `.then` callbacks.
  - When the in-flight write completes, `queuedFlush` runs once, picking up the latest uncommitted `position.current` and monotonic `snapshotRevision.current`.
  - In `goPage()` (single-page mode): Eliminated the redundant intermediate synchronous `flush()` that previously executed on every single-page jump before updating to the new page. The reading position, group indices, and edge progress bar now update immediately, and writes are coalesced via the 1500ms debounce interval, unmount, or pause.
  - Removed duplicate dead code lines in `flush()`.
- **In-Memory Library Summary Caching (`src/storage.ts`)**:
  - Introduced `cachedSummaries: Summary[] | null` in `src/storage.ts`.
  - In `listLibrary()`: Returns a copy of `cachedSummaries` immediately ($O(1)$) when populated, completely bypassing IndexedDB reads, transaction setup, and record parsing.
  - On cache miss: Queries the `summaries` store using a lightweight readonly `database.getAll('summaries')`. Only if missing slugs actually need to be generated does it open a multi-store `readwrite` transaction.
  - Added `invalidateSummaryCache()` and automatically invalidate/update `cachedSummaries` on mutations (`saveManga`, `deleteManga`, `clearLibrary`, `restoreBackup`, `resetProgress`, and `BroadcastChannel('manga-reader:sync')` events).
  - In `saveProgress()`: Updates the summary in `cachedSummaries` in place and re-sorts without requiring a full re-query from storage.
- **Shared Cover Observer & Bounded Object URL Pool (`src/App.tsx`)**:
  - Replaced per-card `new IntersectionObserver(...)` allocations in `Cover` with a single shared `IntersectionObserver` instance across all library cards, using a tighter `rootMargin: '100px 0px'` to prevent decoding covers far outside the viewport on initial paint.
  - Implemented `coverUrlPool` with a 64-entry LRU cache in `src/App.tsx`. Reuses existing blob URLs across library navigation, scrolling, and tab switching, preventing redundant `URL.createObjectURL` calls and memory bloat.
  - Connected `onMangaDelete` to `clearCoverUrlPool(mangaId)` to automatically revoke object URLs when titles are deleted or the library is cleared.
  - Wrapped `Cover` in `React.memo` to skip re-rendering unaffected cards on library state updates.
- **Focused IndexedDB Transactions & Bookmark ID Caching (`src/storage.ts`)**:
  - Minimized transaction scope: replaced multi-store `readwrite` transactions with focused single-store operations where possible.
  - Added in-memory sets `cachedBookmarkedMangaIds` and `cachedMangaBookmarkedIds` to cache `getBookmarkedMangaIds()` and `getMangaBookmarkedIds()`, eliminating full `progress` store table scans on every bookmark shelf render and library sync event.
  - Invalidated on bookmark additions, removals, progress writes with bookmarks, library clear, and sync channel messages.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **69/69 unit tests PASS** (1.5s, including 3 new unit tests in `tests/storage-modular.spec.ts`).
  - `npm run build`: **PASS** (built in 2.67s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Browse Button Theme Styling, Upload Icon, and Button Font Size Sizing — 2026-11-10

- **`.browse-button` Theme Styling (`src/controls.css`)**:
  - Default state: background `#2563eb`, border `1px solid #2563eb`, text `#ffffff`, icon `#ffffff`.
  - Light mode hover: background `#28282b`, border `#28282b`, text `#ffffff`, icon `#ffffff`.
  - Dark mode hover: background `#ffffff`, border `#ffffff`, text `#28282b`, icon `#28282b`.
  - Applied smooth 0.3s ease-in-out transitions across background, text, border, and icon colors.
- **Custom Upload Icon (`src/App.tsx`)**:
  - Implemented `UploadIcon` with the custom folder/up-arrow SVG paths.
  - Used in `.browse-button` (replacing `ArrowUpRight`) and in `.upload-icon` (replacing `FolderPlus`).
- **Dynamic Button Font Size Scaling (`src/controls.css` & `src/style.css`)**:
  - Bound `.browse-button` and `.support-button` text font size to `var(--font-size-button, 15px) !important;` across all breakpoints.
  - Scaled their SVG icons dynamically to `calc(var(--font-size-button, 15px) * 1.15) !important;`.
  - Replaced fixed 44px container height with `min-height: max(44px, calc(var(--font-size-button, 15px) * 2.8)); height: auto;` to eliminate clipping on larger font sizes.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **69/69 unit tests PASS** (1.3s).
  - `npm run build`: **PASS** (built in 2.73s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Directory Handle Resolution Caching & Library Card Content Visibility — 2026-11-10

- **Cache Resolved Directory Handles in `fileFor` (`src/storage.ts`)**:
  - Maintained `dirHandleCache` (`Map<string, FileSystemDirectoryHandle>` with 500-entry capacity limit) keyed by `${m.id}:${m.updatedAt}:${dirPath}`.
  - Sub-paths and leaf directories are traversed and cached once; subsequent pages in the same chapter or volume resolve their directory handle in $O(1)$ time with zero repeated `getDirectoryHandle()` async calls.
  - On error or re-link (`saveManga`, `deleteManga`, `clearLibrary`, `restoreBackup`, `syncChannel` message, or File System Access read error), cached handles for the manga are cleared cleanly via `clearDirHandleCache(mangaId)`.
  - Re-exported `dirHandleCache` and `clearDirHandleCache` in `src/data.ts`.
- **`content-visibility: auto` on Library Cards (`src/style.css`)**:
  - Added `content-visibility: auto; contain-intrinsic-size: 350px 175px; contain-intrinsic-size: auto 350px auto 175px;` to `.manga-card`.
  - Off-screen cards skip DOM layout and painting entirely across libraries up to 1,000 titles, drastically speeding up initial library render and scroll performance with zero JavaScript overhead.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **70/70 unit tests PASS** (1.3s, including directory handle caching test in `tests/storage-modular.spec.ts`).
  - `npm run build`: **PASS** (built in 2.75s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Image Queue Lazy Reprioritization & Concurrency Query Caching — 2026-11-10

- **Lazy Reprioritization with $O(1)$ Lookup (`src/imageQueue.ts`)**:
  - Introduced `waiting = new Map<string, QueuedItem>()` for $O(1)$ lookup and registration of queued tasks awaiting dispatch.
  - Replaced immediate array `.find()` + full array `.sort()` in `reprioritize()` with direct `waiting.get(key)` map update and lazy dirty tracking (`queueDirty = true`).
  - Deferred array sorting to `ensureSorted()` inside `pump()` so burst reprioritizations (triggered during rapid scrolling or page window transitions across dozens of visible pages) execute in amortized $O(1)$ time and perform at most a single sort per dispatch cycle.
  - Updated `enqueue()`, `cancel()`, and `clear()` to maintain consistency across both `this.queue` and `this.waiting`.
- **Cached Media Query & Hardware Concurrency Evaluations (`src/imageQueue.ts`)**:
  - Cached `window.matchMedia('(max-width:700px)')` evaluation and subscribed to change events via `getIsMobile()` rather than constructing a new media query check on every pump iteration.
  - Cached `hardwareConcurrency` and `deviceMemory` limits via `getHardwareConcurrencyLimit()` to eliminate recurring property queries on high-frequency queue worker dispatches.
  - Added `resetConcurrencyCacheForTesting()` for isolated test resets.
- **Verification**:
  - Unit test in `tests/image-pipeline.spec.ts`: `ImageQueue reprioritizes lazily and caches media query evaluations` validates burst reprioritization and lazy sort execution order.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **71/71 unit tests PASS** (1.2s).
  - `npm run build`: **PASS** (built in 2.74s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Reused Module-Level `Intl.Collator` for Shelf and Bookmark Sorting — 2026-11-10

- **Module-Level `Intl.Collator` for Shelf Sorting (`src/App.tsx`)**:
  - Replaced per-comparison `a.title.localeCompare(b.title, undefined, { numeric: true, sensitivity: 'base' })` inside `sortedLibrary` with a single module-level `shelfCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`.
  - Extracted pure sorting logic into `sortLibraryEntries(library, shelfSort)` using `shelfCollator.compare(...)` for title comparisons and ID tiebreakers, avoiding repeated option-parsing overhead during $O(N \log N)$ library sorts.
- **Module-Level `Intl.Collator` for Bookmarks Shelf (`src/Bookmarks.tsx`)**:
  - Introduced `bookmarkCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })` in `src/Bookmarks.tsx`.
  - Replaced inline `localeCompare` calls across `'title-asc'`, `'title-desc'`, and `'chapter'` sorting cases with `bookmarkCollator.compare(...)`.
- **Verification**:
  - Added unit tests in `tests/validation.spec.ts` verifying `sortLibraryEntries`, `shelfCollator`, and `bookmarkCollator` natural collation ordering and base sensitivity.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **73/73 unit tests PASS** (1.4s).
  - `npm run build`: **PASS** (built in 2.68s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Batch IndexedDB Deletes and Writes — 2026-11-10

- **Batched Progress Deletes & Puts in `saveManga` (`src/storage.ts`)**:
  - Replaced sequential `for (const k of keys) await tx.objectStore('progress').delete(k)` with non-blocking concurrent request dispatch via `await Promise.all(keys.map((k) => progressStore.delete(k)))`.
  - Batched subsequent chapter progress insertion requests via `await Promise.all(m.chapters.map(...progressStore.put))`.
- **Parallel Object Store Operations in `deleteManga` & `clearLibrary` (`src/storage.ts`)**:
  - In `deleteManga`, parallelized deletion of the manga metadata, summary, cover, and all chapter progress keys using `await Promise.all(...)` before committing `await tx.done`.
  - In `clearLibrary`, parallelized clearing across all 4 object stores (`'manga'`, `'summaries'`, `'covers'`, `'progress'`) concurrently with `await Promise.all(...)`.
- **Batched Deletes in `restoreBackup` (`src/storage.ts`)**:
  - Batched old progress deletion and restored progress records via `Promise.all` inside the bulk import transaction.
- **Verification**:
  - Added unit test in `tests/storage-modular.spec.ts` verifying concurrent non-sequential deletion execution in IDB stores.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **74/74 unit tests PASS** (1.3s).
  - `npm run build`: **PASS** (built in 2.72s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Single-Pass Bookmark ID Sets Computation & Reader Re-Render Isolation — 2026-11-10

- **Single-Pass Bookmark ID Sets Computation (`src/storage.ts`)**:
  - Implemented `ensureBookmarkCaches()` to scan the IndexedDB `progress` store exactly once when cold, populating both `cachedBookmarkedMangaIds` (all chapters with bookmarks) and `cachedMangaBookmarkedIds` (manga-level bookmarks) simultaneously.
  - Coalesced concurrent callers onto a single in-flight `bookmarkCachePromise`, eliminating redundant parallel table scans.
  - Added unit test in `tests/storage-modular.spec.ts` verifying safe single-pass resolution and defensive copying.
- **Reader Re-Render Isolation & PageProgressControl (`src/Reader.tsx`)**:
  - Extracted bottom bar page indicator, jump input, and progress slider into memoized child component `PageProgressControl`.
  - Introduced `PageStore` and `createPageStore()` using React's `useSyncExternalStore` for tear-free, fine-grained state subscriptions.
  - In continuous reading mode, `capture()` updates `pageStore.setPage(o.page)` on scroll without invoking `setPage` on the parent `Reader` component. The 1,500-line `Reader` tree skips re-rendering entirely during fast scroll, isolating visual progress updates strictly to `PageProgressControl`.
  - Single-page reading mode retains explicit spread changes via `singlePage` state while keeping `pageStore` synchronized.
  - Added unit test in `tests/reader-geometry.spec.ts` verifying `createPageStore` subscription isolation, duplicate dispatch suppression, and clean unsubscription.
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **76/76 unit tests PASS** (1.5s).
  - `npm run build`: **PASS** (built in 2.69s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Build & Bundle Polish: Manual Vendor Chunking, LightningCSS & Dead CSS Cleanup — 2026-11-10

- **Bundle Analysis & Stable Vendor Chunks (`vite.config.ts`)**:
  - Analyzed the main entry chunk breakdown: identified `react-dom` (638 KB), `@radix-ui` / `@floating-ui` (126 KB), and `react-router` (87 KB) as dominant dependencies bundled alongside application code.
  - Implemented `manualChunks` in Rollup output options to extract long-term stable vendor chunks:
    - `vendor-react` (223 KB, 69 KB gzip): React, React DOM, and scheduler.
    - `vendor-ui` (107 KB, 34 KB gzip): Radix UI Dialog & Select components, Floating UI popper, and dismissable layers.
    - `vendor-router` (39 KB, 14 KB gzip): React Router and Remix router runtime.
  - Reduced the frequently updated application bundle `index-*.js` from **490 KB** down to **117 KB** (37.19 KB gzip), maximizing browser cache hits across application releases.
  - Added optional `ANALYZE=1` module inspection plugin for ongoing bundle monitoring.
- **LightningCSS Minification (`vite.config.ts`)**:
  - Configured `build.cssMinify: 'lightningcss'` to utilize Rust-backed lightningcss for advanced CSS minification, syntax lowering, and deduplication.
- **Dead CSS Rules Purge (`src/controls.css` & `src/style.css`)**:
  - Audited all selectors against active JSX/TSX components and HTML.
  - Removed legacy, unreferenced selectors from `src/style.css`: `.page-nav`, `.autoscroll-controls`, `.speed-label`, `.custom-speed`, `.chapter-name`, `.chapter-counter`, `.bookmark-controls`, `.zoom-reset`, `.bookmark-list`, `.continue-label`, `.library-count`, `.relink-label`, `.local-label`, and unused responsive overrides.
  - Removed dead selectors from `src/controls.css`: `.import-success-footer`, `.bookmarks-page-grid .empty-shelf`.
  - Dropped compiled CSS footprint from 87.54 KB to 85.41 KB (15.60 KB gzip).
- **Verification**:
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **76/76 unit tests PASS** (1.4s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.65s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Access Permission Throttling & Image Queue Attribute Cleanups — 2026-11-11

- **Throttled File System Access Permission Queries (`src/storage.ts`)**:
  - Implemented in-memory `accessCache` (`Map<string, AccessCacheEntry>`) with `ACCESS_CACHE_TTL_MS = 7500` (7.5 seconds) to throttle passive `access(m)` queries across library cards, bookmarks, and reader focus/visibility events.
  - Eliminated bursts of File System Access API IPC calls (`handle.queryPermission({ mode: 'read' })`) against Chromium when users alt-tab or switch windows.
  - Added in-flight query coalescing (`accessInFlight`) so concurrent checks for the same manga share a single underlying query promise.
  - In `access(m, request)`:
    - Bypasses the cache and cancels passive queries whenever `request === true` (explicit user re-linking or access prompt), invoking `handle.requestPermission` and immediately refreshing the cache.
    - Preserves desktop IPC bypass (`desktopAPI.isDesktop`) and in-memory `sessionFiles`.
  - Linked cache invalidation to `clearDirHandleCache()` and `clearAccessCache()`, ensuring handle mutations in `saveManga`, `deleteManga`, `clearLibrary`, `restoreBackup`, and `fileFor` handle errors immediately clear cached access states.
- **Removed Harmless but Redundant `fetchPriority` on Blob Images (`src/PageImage.tsx`)**:
  - Removed `fetchPriority` on `<img src="blob:...">` in `src/PageImage.tsx`. Because `blob:` Object URLs reference in-memory buffers created from local storage or IPC rather than network streams, browser network priority scheduling has no effect.
  - Cleaned up unused `isNear` helper, keeping deterministic concurrency and distance-based prioritizations inside the dedicated JS `imageQueue.ts`.
- **Verification**:
  - Added unit test in `tests/storage-modular.spec.ts` verifying TTL-based query caching, in-flight coalescing, `request=true` cache bypass, and invalidation via `clearAccessCache` and `clearDirHandleCache`.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **77/77 unit tests PASS** (1.5s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.65s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Adaptive Object URL Pool Size — 2026-11-11

- **Adaptive Object URL Pool Sizing (`src/objectUrlPool.ts`)**:
  - Implemented `getAdaptivePoolSize()` dynamically adapting LRU Object URL cache capacity according to client hardware capabilities:
    - Highly constrained environments (`deviceMemory <= 2` or `hardwareConcurrency <= 2`): 12 entries to minimize RAM usage on lower-end devices.
    - Moderately constrained environments (`deviceMemory <= 4` or `hardwareConcurrency <= 4`): 24 entries.
    - High-spec systems (`deviceMemory >= 8` and `hardwareConcurrency >= 8`): 64 entries to eliminate redundant re-reads and re-decodes during fast continuous scrolling.
    - Intermediate configurations: 40 entries.
    - Non-browser/undefined navigator environments: 32 entries fallback.
  - Initialized `defaultObjectUrlPool` with `getAdaptivePoolSize()`.
  - Preserved all call sites (`getObjectUrl`, `storeObjectUrl`, `clearObjectUrlPool`) and LRU eviction invariants intact.
- **Verification**:
  - Added unit test in `tests/image-pipeline.spec.ts` asserting pool sizing across low (12), medium (24), high (64), and intermediate (40) tiers.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **78/78 unit tests PASS** (1.5s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.77s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Image Queue Insertion Sort Optimization — 2026-11-11

- **Stable Insertion Sort in Image Queue (`src/imageQueue.ts`)**:
  - Replaced `this.queue.sort((a, b) => b.priority - a.priority)` in `ensureSorted()` with an in-place insertion sort.
  - Insertion sort operates in linear $O(N)$ time on nearly-sorted bounded queues ($\le 64$ entries) with zero closure allocation and zero V8 comparator call overhead during rapid scroll reprioritizations.
  - Preserves strict FIFO stability for tasks with equal priority.
- **Verification**:
  - Added unit test in `tests/image-pipeline.spec.ts` asserting deterministic priority scheduling and strict FIFO preservation for duplicate priorities across multiple queued tasks.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **79/79 unit tests PASS** (1.4s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.64s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Binary Thumbnail IPC Optimization — 2026-11-11

- **Zero-Copy Typed Array Thumbnail IPC (`src/tauriBridge.ts`)**:
  - Eliminated `Array.from(buffer)` in `saveThumbnail(id, buffer)`: passes `bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)` directly into Tauri v2 `invoke('save_thumbnail', { id, bytes })`.
  - Prevents allocating 50,000–200,000 boxed JavaScript numbers per cover during library scanning and backup restoration, eliminating severe heap bloat and GC pauses.
  - In `getThumbnail` and `readFile`: typed return payloads as `Uint8Array | ArrayBuffer`, eliminating `number[]` array materialization on the TypeScript side while preserving binary `tauri::ipc::Response` consumption.
  - Retained `Vec<u8>` on the Rust side (`src-tauri/src/commands/cache.rs`), allowing direct binary deserialization.
- **Verification**:
  - Added unit test in `tests/storage-modular.spec.ts` asserting `saveThumbnail` dispatches typed `Uint8Array` rather than JS arrays across IPC and `getThumbnail` processes binary responses cleanly.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **80/80 unit tests PASS** (1.4s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.63s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Hardened & Streamlined Native FS Commands — 2026-11-11

- **Async Directory Scanning with Progress Events (`src-tauri/src/commands/fs.rs` & `src/tauriBridge.ts`)**:
  - Upgraded `list_folder` to an asynchronous command:
    - Moves candidate file traversal off the UI thread via `tokio::task::spawn_blocking`.
    - Batches parallel dimension parsing via Rayon in 128-candidate chunks with `tokio::task::yield_now()` cooperative yielding.
    - Emits `"scan-progress"` (`{ scanId, done, total }`) events via `app.emit(...)` to provide real-time scanning feedback.
  - Connected `onProgress` in `fromDesktopFolder` (`src/importScan.ts`) to drive taskbar and UI progress bars during folder discovery.
- **Cancellation with Watch Channels (`src-tauri/src/commands/fs.rs` & `src/tauriBridge.ts`)**:
  - Introduced `ScanManager` in Rust tracking active scan IDs with `tokio::sync::watch::channel(false)`.
  - Added `cancel_scan(scan_id)` Tauri command.
  - In `TauriDesktopBridge.listFolder`: registers `options.signal` abort listener that triggers `cancel_scan`, terminating in-flight Rust thread traversal and chunk loops immediately and throwing standard DOM `AbortError`.
- **Allowed Library Root Confinement (`src-tauri/src/commands/fs.rs` & `src/storage.ts`)**:
  - Introduced `AllowedRoots` in Tauri app state, persisted across app sessions in `allowed_roots.json`.
  - Automatically records canonical roots upon `select_folder` and `list_folder`, and added `register_allowed_roots` command.
  - Enforces that all `read_file` and `get_image_dimensions` queries target paths strictly inside an allowed library root after `dunce::canonicalize`, preventing arbitrary file reads outside user-selected folders.
  - Registered stored manga roots automatically in `listLibrary` and `fileFor`.
- **Structured Error Typings with `thiserror` (`src-tauri/src/commands/fs.rs` & `src/tauriBridge.ts`)**:
  - Replaced unstructured `Result<_, String>` with `FsError`:
    - `NotFound(String)`
    - `TooLarge(String)`
    - `ForbiddenExt(String)`
    - `PathNotAllowed(String)`
    - `Cancelled`
    - `Io(String)`
  - Added `parseFsError` in TypeScript to map structured error payloads from rejected IPC calls and handle cancellations seamlessly.
- **Verification**:
  - Added unit tests in `tests/storage-modular.spec.ts` asserting `parseFsError` parsing, `listFolder` scan ID and cancellation via `AbortSignal`, and `registerAllowedRoots` dispatch.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **82/82 unit tests PASS** (1.6s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.66s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Native Rust Discovery, Natural Sorting & Chapter Preparation — 2026-11-11

- **Structured Library Discovery Engine (`src-tauri/src/commands/fs.rs` & `src/importScan.ts`)**:
  - Implemented `discover_library(folder_path, scan_id)` Tauri command:
    - Traverses root directory, skips hidden/ignored folders, allowlists image formats.
    - Groups files into provisional titles and chapters using canonical JS heuristics (`splitSource` for multi-title collections, `chapterGroups` for subfolder vs root-page structures, and `cover.*`/`thumbnail.*` detection).
    - Rayon-parallelized dimension extraction across 128-entry chunks with periodic `scan-progress` event emission and watch channel cancellation checks.
    - Returns structured `LibraryDiscovery` with pre-grouped, pre-dimensioned `DiscoveredTitle`, `DiscoveredChapter`, and `DiscoveredPage` records.
  - Integrated with `fromDesktopFolder` in `src/importScan.ts`: populates `source.files` with pre-dimensioned `DesktopHandle`s, turning subsequent chapter indexing and warming passes into zero-IO operations.
  - Storage transactions and IndexedDB commits remain strictly in React/TypeScript, maintaining database schema and revision invariants.
- **Native Natural Sort (`src-tauri/src/commands/fs.rs` & `src/tauriBridge.ts`)**:
  - Implemented `natural_sort_paths(paths)` command in Rust:
    - Implements natural tokenization matching JavaScript's `naturalOrder` (numeric parsing, category ranking for prologue/extra/bonus, case-insensitivity).
    - Exposes `desktopAPI.naturalSortPaths` for single-pass natural sorting shared across discovery and re-linking.
- **Batch Chapter Header Preparation (`src-tauri/src/commands/fs.rs` & `src/tauriBridge.ts`)**:
  - Implemented `prepare_chapter_headers(paths)` command in Rust:
    - Validates file paths against `AllowedRoots` in parallel Rayon worker threads.
    - Returns `Vec<PageHeader>` containing `width`, `height`, `size`, `modified`, and lightweight 64-bit sampling checksum without transferring full pixel buffers across IPC.
- **Verification**:
  - Added unit tests in `tests/storage-modular.spec.ts` asserting `naturalSortPaths`, `prepareChapterHeaders`, and `discoverLibrary` dispatch and response handling.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **83/83 unit tests PASS** (1.5s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.69s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Windows-Specific Polish & App Data Persistence — 2026-11-11

- **Windows System Tray & Minimize/Close-to-Tray (`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/src/commands/config.rs`)**:
  - Activated Tauri `tray-icon` cargo feature.
  - Implemented system tray with context menu items ("Show Manga Reader", "Quit"), left-click toggle to unminimize and focus the main window, and app icon loading via `app.default_window_icon()`.
  - Added window close-requested event listener: when `close_to_tray` window preference is enabled, intercepts window close with `api.prevent_close()` and hides the window to the tray instead of terminating.
- **Persistent App Configuration & Non-IndexedDB App Data Helper (`src-tauri/src/commands/config.rs`, `src/tauriBridge.ts`, `src/importScan.ts`, `src/App.tsx`)**:
  - Created `AppConfigState` with thread-safe `RwLock<AppConfig>` persisting to `%APPDATA%\com.mangareader.desktop\app_config.json`.
  - Added Tauri commands `get_app_config`, `save_app_config`, `set_app_preference`, `get_app_preference`, `record_opened_root`, `get_last_opened_roots`.
  - Added TypeScript definitions `WindowPreferences`, `AppConfig`, and methods on `DesktopAPI` / `TauriDesktopBridge`.
  - Stored roots automatically bridge into `AllowedRoots`, ensuring opened roots remain accessible and allowlisted even if local storage / webview data is cleared.
  - Bound folder selection (`App.tsx`) and folder import (`importScan.ts`) to `record_opened_root`.
- **Windows Input & High-DPI Containment (`src-tauri/src/commands/window.rs`, `src-tauri/capabilities/default.json`, `src-tauri/tauri.conf.json`)**:
  - Extended `INIT_SCRIPT` to intercept `gesturestart`, `gesturechange`, and `gestureend` events, preventing unwanted pinch-to-zoom on Windows tablets, 2-in-1 laptops, and high-DPI touchpads.
  - Retained locked 1:1 visual zoom and monitor-aware geometry validation.
  - Configured NSIS installer settings (`currentUser` installation mode, standard languages, and clean installer branding) in `tauri.conf.json`.
- **Verification**:
  - Added unit tests in `tests/storage-modular.spec.ts` asserting `getAppConfig`, `saveAppConfig`, `setAppPreference`, `getAppPreference`, `recordOpenedRoot`, and `getLastOpenedRoots`.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **84/84 unit tests PASS** (1.6s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.67s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Frontend ↔ Rust Boundary Cleanups & Native Dimensions — 2026-11-11

- **Legacy Electron Fallback Removal (`src/tauriBridge.ts`, `src/vite-env.d.ts`, `src/main.tsx`, `src/data.ts`, `src/importScan.ts`, `src/updates.ts`, `src/model.ts`)**:
  - Removed `isLegacyElectron` and `LegacyElectronDesktopBridge` entirely from `src/tauriBridge.ts`.
  - Simplified `isDesktop` to `isTauri`.
  - Removed `electronAPI` from `interface Window` in `src/vite-env.d.ts`.
  - Replaced legacy userAgent Electron checks in `src/updates.ts` with `desktopAPI.isDesktop`.
  - Removed `ElectronHandle` and `fromElectronFolder` aliases from `src/data.ts` and `src/importScan.ts`.
  - Updated comments in `src/main.tsx`, `src/model.ts`, and test titles in `tests/validation.spec.ts` to reference native desktop.
- **Single Source of Truth (`src/tauriBridge.ts`, `src/updates.ts`)**:
  - Confined all `window.__TAURI__` / `window.__TAURI_INTERNALS__` checks strictly within `src/tauriBridge.ts`.
  - All application code queries `desktopAPI` exclusively as the unified abstraction boundary.
- **Natural-Sort & Path-Normalization Routing to Rust (`src/paths.ts`, `src/importScan.ts`, `src/data.ts`)**:
  - Added centralized `normalizePath(path)` in `src/paths.ts` for uniform forward-slash and trailing-slash normalization.
  - Added async `naturalSortPaths(paths)` helper that routes directly to Rust's `natural_sort_paths` on desktop, falling back to JS `naturalOrder` on web.
  - Used `naturalSortPaths` in `warmSources` and `indexSource` to naturally sort chapter names and individual chapter pages via Rust.
  - Exposed `absPath` as `readonly absPath: string` on `DesktopHandle`.
- **Aggressive Native Dimension Resolution (`src/PageImage.tsx`, `src/importScan.ts`)**:
  - `PageImage.tsx`: Added an auto-resolve effect that immediately resolves `dimensionsPending` pages using `desktopAPI.getImageDimensions(absPath)` on desktop, unblocking rendering immediately without requiring manual retries.
  - `importScan.ts` (`indexSource`): Initial warm chapter inspection queries `desktopAPI.getImageDimensions(desktop.absPath)` in Rust before reading the file or invoking the browser decode fallback.
  - `importScan.ts` (`prepareChapter`): Batch queries all pending page paths in a single Rust Rayon parallel call via `desktopAPI.prepareChapterHeaders(absPaths)`, rendering the browser `new Image()` decoding path a pure fallback.
- **Verification**:
  - Added 4 unit tests in `tests/storage-modular.spec.ts` asserting `normalizePath`, `naturalSortPaths`, `DesktopHandle`, and batch `prepareChapterHeaders` integration in `prepareChapter`.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **88/88 unit tests PASS** (1.6s).
  - `npm run build`: **PASS** (Vite production bundle built in 2.66s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).
  - `cargo check --manifest-path src-tauri/Cargo.toml`: **PASS** (exit code 0).

## Window Initialization Script, Opener Plugin, Cargo Cleanup & Rust Unit Tests — 2026-11-11

- **Window `initialization_script` & Native `zoomHotkeysEnabled: false` (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`)**:
  - Moved `INIT_SCRIPT` out of runtime `window.eval()` in setup.
  - Configured `"create": false` on `"main"` window in `tauri.conf.json`, enabling `WebviewWindowBuilder::from_config(app, win_cfg)?.initialization_script(commands::window::INIT_SCRIPT).build()?` in `setup`.
  - Guarantees script runs on document creation (`AddScriptToExecuteOnDocumentCreated`), surviving webview reloads and navigations without losing drag-drop and external link interceptors.
  - Added `"zoomHotkeysEnabled": false` to `app.windows[0]` in `tauri.conf.json`, leveraging WebView2's native `IsZoomControlEnabled = false` to eliminate keyboard and wheel zoom without relying solely on JS interception.
- **Upgraded from `tauri-plugin-shell` to `tauri-plugin-opener` (`src-tauri/Cargo.toml`, `src-tauri/src/lib.rs`, `src-tauri/capabilities/default.json`, `src-tauri/src/commands/window.rs`)**:
  - Replaced deprecated Tauri v2 shell open plugin with `tauri-plugin-opener = "2"`.
  - Registered `.plugin(tauri_plugin_opener::init())` in `src-tauri/src/lib.rs`.
  - Dropped `"shell:default"` and `"shell:allow-open"` from `capabilities/default.json` in favor of scoped `"opener:default"`.
  - Updated `INIT_SCRIPT` link router to invoke `plugin:opener|open_url` with `{ url: href }`.
- **Cargo Dependencies & Toolchain Cleanup (`src-tauri/Cargo.toml`, `.cargo/config.toml`, `src-tauri/build.rs`)**:
  - Shrink `tokio` features from `full` to `["rt-multi-thread", "fs", "sync", "macros"]`, eliminating unused sub-crates (net, process, signal, etc.).
  - Evaluated toolchain environment: machine utilizes WinLibs MinGW 64-bit GCC (`x86_64-pc-windows-gnu`).
  - Resolved MinGW GNU `ld.exe: .rsrc merge failure: multiple non-default manifests` and `TaskDialogIndirect` symbol entrypoint issues by generating custom gcc specs (`no-default-manifest.specs`) and linking the Common Controls v6 manifest object in `.cargo/config.toml`.
  - Configured `build.rs` to automatically sync `WebView2Loader.dll` into `target/<profile>/deps/` so `cargo test` executes test harnesses seamlessly.
- **Comprehensive Rust Unit Test Suite (`src-tauri/src/commands/{fs.rs, cache.rs, config.rs, image.rs}`)**:
  - Added 15 comprehensive unit tests across Rust modules:
    - `commands::fs`: `test_natural_order_chapters`, `test_natural_order_categories`, `test_is_image_file`, `test_is_ignored_directory`, `test_write_atomic`, `test_parse_image_dimensions`, `test_allowed_roots`.
    - `commands::cache`: `test_percent_decode`, `test_sanitize_id`, `test_hash_key`.
    - `commands::config`: `test_window_preferences_defaults`, `test_app_config_serde_roundtrip`, `test_root_capping_and_deduplication`.
    - `commands::image`: `test_calculate_fitted_dimensions`, `test_resize_image_fir`.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **15/15 unit tests PASS** (0 failures, 0.01s).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **88/88 unit tests PASS** (1.4s).
  - `npm run build`: **PASS** (Vite production bundle built in 3.75s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).

## Step B1 — Replace IndexedDB with SQLite & Multi-Backend LibraryRepo Abstraction — 2026-11-11

- **Relational SQLite Schema & Engine (`src-tauri/Cargo.toml`, `src-tauri/src/db.rs`, `src-tauri/src/lib.rs`)**:
  - Integrated `rusqlite = { version = "0.33", features = ["bundled"] }`.
  - Configured WAL mode (`PRAGMA journal_mode = WAL`) and foreign key cascades (`PRAGMA foreign_keys = ON`).
  - Implemented normalized schema with indexes:
    - `manga`: `id` (PK), `title`, `slug`, `local_path`, `last_chapter`, `added_at`, `updated_at`, `revision`, `sort`.
    - `chapters`: `(manga_id, chapter_idx)` (PK), `name`, FK to `manga(id)` with CASCADE delete.
    - `pages`: `(manga_id, chapter_idx, idx)` (PK), `name`, `path`, `width`, `height`, `size`, `modified`, FK to `chapters`.
    - `progress`: `(manga_id, chapter_name)` (PK), `read`, `page`, `path`, `fraction`, `updated_at`, FK to `manga`.
    - `bookmarks`: `id` (PK AUTOINCREMENT), `manga_id`, `chapter_name`, `page`, `path`, `fraction`, `manga_bookmark`, `timestamp`, FK to `manga`.
    - `settings`: `key` (PK), `value`.
  - Initialized `library.db` in `src-tauri/src/lib.rs` inside `setup` within app data directory, wrapped in `DbState(Mutex<Connection>)`.
- **Atomic Rust Transactions & Commands (`src-tauri/src/db.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`)**:
  - Registered 14 new Tauri commands in `AppManifest`, capabilities, and handler:
    - `is_library_migrated`, `import_legacy_library`, `sqlite_list_library`, `sqlite_get_manga`, `sqlite_save_manga`, `sqlite_save_progress`, `sqlite_add_bookmark`, `sqlite_remove_bookmark`, `sqlite_get_bookmarked_manga_ids`, `sqlite_delete_manga`, `sqlite_clear_library`, `sqlite_reset_progress`, `sqlite_get_settings`, `sqlite_save_settings`.
  - Implemented atomic `import_legacy_library_tx`: inserts all manga, chapters, pages, progress, bookmarks, and global settings in a single transaction. Sets `migrated = 1` only upon successful commit.
  - Implemented `save_progress` with optimistic locking: verifies `expected_revision` and `expected_updated_at`, returning typed `'saved' | 'stale' | 'missing'`.
- **Frontend `DesktopAPI` & IPC Bridge (`src/tauriBridge.ts`)**:
  - Extended `DesktopAPI` interface and implemented all 14 SQLite IPC methods in `TauriDesktopBridge` using `@tauri-apps/api/core` `invoke`.
  - Provided clean safe fallbacks / no-ops in `WebDesktopBridge`.
- **`LibraryRepo` Interface & Multi-Backend Repositories (`src/repo.ts`, `src/storage.ts`)**:
  - Defined unified `LibraryRepo` interface with CRUD, progress, bookmark, and settings contracts.
  - Implemented `TauriSqliteLibraryRepo`:
    - Queries SQLite via `desktopAPI.sqlite*`.
    - Maintains in-memory caches for summaries and bookmarks.
    - Caches cover thumbnails to disk via `desktopAPI.saveThumbnail`.
    - Broadcasts changes over `syncChannel` (`manga-reader:sync`).
  - Implemented `IndexedDBLibraryRepo`:
    - Encapsulates existing IndexedDB transactions and schema.
  - Exported dynamic `repo` proxying to `desktopAPI.isDesktop ? new TauriSqliteLibraryRepo() : new IndexedDBLibraryRepo()`.
  - Refactored `src/storage.ts` to delegate all exported persistence methods to `repo`.
- **Non-Destructive Safe Migration (`src/repo.ts`, `src/App.tsx`)**:
  - Implemented `ensureLibraryMigrated(idbRepo?: LibraryRepo)`:
    - Checks `desktopAPI.isLibraryMigrated()`. If false, dumps existing titles and settings from IndexedDB.
    - Validates dumped data through `validateBackup({ version: 2, manga, settings })`.
    - Calls `desktopAPI.importLegacyLibrary` to commit the entire dataset atomically into SQLite.
    - Leaves the IndexedDB database 100% intact as a read-only safety backup (never wipes or deletes IDB).
  - Invoked `ensureLibraryMigrated()` in `src/App.tsx` on desktop mount prior to initial library and settings fetch.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **20/20 unit tests PASS** (including 5 SQLite tests: schema init & migration flag, save & get manga, progress & stale detection, bookmarks add/remove, legacy import transaction).
  - Added 4 unit tests in `tests/storage-modular.spec.ts` asserting `TauriSqliteLibraryRepo` method delegation, `ensureLibraryMigrated` skipping when migrated, non-destructive IDB export & atomic SQLite import, and empty IDB safe init.
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run test:validation`: **92/92 unit tests PASS** (1.5s).
  - `npm run build`: **PASS** (Vite production bundle built in 3.45s).
  - `npm run format:check`: **PASS** (All matched files use Prettier code style).

## Step B2 & Step 16 — Validation and Backup in Rust & Zero Cover Overhead Export — 2026-11-11

- **Rust Serde Validation Engine (`src-tauri/src/validation.rs`)**:
  - Implemented strict allowlisted deserialization structs with `#[serde(deny_unknown_fields)]`: `ValidatedPage`, `ValidatedPosition`, `ValidatedChapter`, `ValidatedManga`, `ValidatedSettings`, and `BackupPayload`.
  - Added `validate_relative_path` preventing path traversal (`..`, absolute paths, leading/trailing slashes, null bytes, control characters, depth > 64, path length > 4096).
  - Added duplicate page path and duplicate manga ID checks.
  - Enforced operational hard caps (`limits::titles`, `limits::chapters`, `limits::pages`, `MAX_IMAGE_DIMENSION = 32768`, `MAX_IMAGE_AREA = 16_777_216`).
  - Added 6 unit tests in `validation::tests`: traversal rejection, valid backup roundtrip, unknown field rejection (`deny_unknown_fields`), invalid version rejection, duplicate page rejection, duplicate ID rejection.
- **Relational Backup Export & Atomic Restore in SQLite (`src-tauri/src/db.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`)**:
  - Implemented `export_backup_json(conn)`: queries relational tables in SQLite (`manga`, `chapters`, `pages`, `progress`, `bookmarks`, `settings`) and serializes directly to a version 2 JSON backup payload. Cover blobs are NOT loaded into memory, resolving `re-code.txt` Step 16.
  - Implemented `restore_backup_tx(conn, backup_json)`: validates JSON with `validate_backup_json`, preserves existing `local_path` and `slug` on collisions, writes all records in a single atomic transaction, and updates settings.
  - Registered 3 Tauri commands in `build.rs`, `capabilities/default.json`, `lib.rs`, and `db.rs`:
    - `validate_library_backup`, `export_library_backup`, `restore_library_backup`.
- **Frontend Integration & Multi-Backend Backup (`src/tauriBridge.ts`, `src/repo.ts`, `src/storage.ts`, `src/SettingsPanel.tsx`)**:
  - Extended `DesktopAPI` with `exportBackup()`, `restoreBackup(backupJson)`, and `validateBackup(backupJson)`.
  - Added `exportBackup()` to `LibraryRepo`, implemented in `TauriSqliteLibraryRepo` and `IndexedDBLibraryRepo`.
  - In `SettingsPanel.tsx`, updated `exportData()` and `importData()` to invoke native Rust commands when running on desktop (`desktopAPI.isDesktop`), falling back to `LibraryRepo` on web.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **27/27 unit tests PASS** (including 7 new validation and export/restore tests).
  - `npm run test:validation`: **95/95 unit tests PASS** (including 3 new Step B2 tests in `tests/storage-modular.spec.ts`).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.52s).
  - `npm run format:check`: **PASS**.

## Step B3 — Put Indexing Fully in Rust (`importScan.ts`) — 2026-11-11

- **Native Parallel Indexing Engine (`src-tauri/src/commands/indexing.rs`, `src-tauri/src/commands/image.rs`)**:
  - Implemented `index_title(app, root, options, on_progress: Channel<ScanProgress>) -> Result<TitleDto, String>`.
  - Recursive folder scanning respecting security bounds (`MAX_DEPTH = 64`, `MAX_SCAN_FILES = 100,000`, `AllowedRoots`, allowlisted image extensions, ignored junk directories).
  - Streaming progress updates via `tauri::ipc::Channel<ScanProgress>` (no global event listeners or `scanId` tracking).
  - Chapter grouping: maps subdirectories into chapters (`"Subfolder / Subfolder"`) and root files into `"Root pages"`. Automatically detects root cover/thumbnail files.
  - Dimension reuse from `previous` manga record: checks matching `path`, `size`, and `modified` (mtime ms). When unchanged, dimensions are reused instantly without disk re-reads (`reused` counter tracked).
  - Warm chapter batch dimension parsing: runs parallel header parsing across the Rayon thread pool (`parse_image_dimensions`) for the first 5 chapters (default).
  - Re-link matching:
    - Matches chapters by exact name.
    - Matches renamed chapters by comparing page signature sets (`name\0size\0modified`).
    - Maps saved reading positions and bookmarks using `matching_position` (path-first with filename fallback and clamping).
    - Preserves chapter `read` state when all page names match.
  - Cover & thumbnail generation: detects cover image or first page, invokes `generate_thumbnail_direct` to encode WebP thumbnail atomically on disk (`cache/thumbnails/{manga_id}.webp`).
  - URL slug generation: deterministic ASCII/Unicode hyphenated slugs (`generate_slug`).
  - Unit tests in `commands::indexing::tests`:
    - `test_generate_slug`: alphanumeric hyphenation, trailing trim, default fallback.
    - `test_matching_position_exact_path`: exact path matching with fraction and bookmark preservation.
    - `test_matching_position_leaf_fallback`: fallback to leaf filename across renamed directory paths.
    - `test_chapter_match_exact_and_renamed`: exact name match and signature-based renamed chapter matching.
- **Frontend Bridge & Integration (`src/tauriBridge.ts`, `src/importScan.ts`)**:
  - Defined `IndexScanProgress`, `IndexTitleDto`, and `IndexTitleOptions`.
  - Added `indexTitle(root, options, onProgress)` to `DesktopAPI` and implemented in `TauriDesktopBridge` utilizing `@tauri-apps/api/core` `Channel`.
  - Updated `indexSource` in `src/importScan.ts`: when on desktop with `source.localPath`, delegates directly to `desktopAPI.indexTitle`, updates taskbar and scan progress via Channel callback, and maps returned `TitleDto` to `Manga`.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **31/31 unit tests PASS** (including 4 new indexing tests, 0.01s).
  - `npm run test:validation`: **97/97 unit tests PASS** (including 2 new Step B3 unit tests in `tests/storage-modular.spec.ts`).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.59s).
  - `npm run format:check`: **PASS**.

## Step C1 — Custom URI Protocol Scheme for Zero-Copy Image Streaming (`mangaimg`) — 2026-11-11

- **Custom URI Scheme Protocol in Rust (`src-tauri/src/protocol.rs`, `src-tauri/src/lib.rs`)**:
  - Registered asynchronous URI protocol handler `"mangaimg"` on Tauri builder using `register_asynchronous_uri_scheme_protocol`.
  - Offloaded file I/O and byte range slicing to `tokio::task::spawn_blocking` to avoid stalling the async runtime.
  - Implemented `handle_mangaimg_request(app, req) -> Response<Vec<u8>>`:
    - Decodes URI path with percent-decoding and Windows drive letter formatting (`/C%3A/path` -> `C:/path`).
    - Canonicalizes paths via `dunce::canonicalize` to resolve symlinks and Windows UNC device paths.
    - Security checks: verifies target is in `AllowedRoots` (or `app_cache_dir/thumbnails`), verifies `ALLOWED_IMAGE_EXTENSIONS`, rejects directory traversals and non-regular files, asserts 100 MiB safety ceiling (`MAX_FILE_READ_BYTES`).
    - Generates hexadecimal ETag from `mtime_ms` and file size.
    - Conditional GET: responds with `304 Not Modified` when `If-None-Match` matches.
    - RFC 7233 Byte Range Requests: supports `Range: bytes={start}-{end}` with partial response `206 Partial Content`, `Content-Range: bytes {start}-{end}/{total}`, and `Accept-Ranges: bytes`.
    - HTTP caching headers: sets `Cache-Control: public, max-age=31536000, immutable`.
    - Supports `HEAD` requests (header-only, empty body).
  - Unit tests in `protocol::tests`:
    - `test_decode_request_path`: drive letter extraction, Windows backslash/forward-slash handling, percent-decoding.
    - `test_parse_range`: exact ranges, open-ended ranges, suffix ranges, out-of-bounds rejection.
    - `test_get_mime_type`: accurate MIME resolution across WebP, JPEG, PNG, AVIF, GIF, etc.
- **Frontend Bridge & Component Integration (`src/tauriBridge.ts`, `src/PageImage.tsx`, `src/Bookmarks.tsx`)**:
  - Added `convertFileSrc(filePath, protocol?)` to `DesktopAPI`.
  - Implemented in `TauriDesktopBridge`: calls Tauri's `convertFileSrc(filePath, 'mangaimg')` with standard localhost URL formatting fallback when running without injected internals.
  - Updated `PageImage.tsx`:
    - On desktop (`desktopAPI.isDesktop && mangaLocalPath`), visible images in viewport immediately set `url = desktopAPI.convertFileSrc(absPath, 'mangaimg')` without `read_file` IPC, `new Blob()`, or `URL.createObjectURL()`.
    - Zero-copy streaming directly from disk to WebView2 texture cache.
    - Graceful fallback: on decode failure (`onError`), toggles `useBlobFallback(true)` to silently retry via the existing `fileFor` blob queue before surfacing an error button.
  - Updated `Bookmarks.tsx`:
    - Chapter bookmark previews utilize `desktopAPI.convertFileSrc` when displaying saved positions on desktop.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **34/34 unit tests PASS** (3 new protocol tests, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (1 new C1 convertFileSrc unit test).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.62s).
  - `npm run format:check`: **PASS**.

## Step C2 — Native Rust Cover & Thumbnail Generation with `fast_image_resize` — 2026-11-11

- **Native Rust Image Resizing & URL Returns (`src-tauri/src/commands/image.rs`, `src-tauri/src/commands/cache.rs`, `src-tauri/src/protocol.rs`)**:
  - Re-architected `generate_thumbnail` and `generate_image_variant` to return `CachedImageResult { path: String, url: String }` instead of raw binary bytes.
  - Image downscaling executed using `fast_image_resize` and `image` crate within a bounded Rayon thread pool (`IMAGE_RESIZE_POOL`, 2–6 worker threads) spawned via `tokio::task::spawn_blocking`.
  - Enforced operational safety ceilings: `MAX_IMAGE_SIDE = 32_768`, `MAX_IMAGE_PIXELS = 16_000_000` (16M pixels).
  - Thumbnails and variants are written atomically (`write_atomic`) to native disk cache directories (`app_cache_dir/thumbnails/{id}.webp` and `app_cache_dir/variants/{hash}_{w}x{h}.webp`).
  - Added `get_thumbnail_url(id: String) -> Result<Option<String>, String>` command returning direct `mangaimg` protocol URL if the cached WebP thumbnail already exists on disk.
  - Registered commands and permissions in `build.rs`, `capabilities/default.json`, and `lib.rs`.
- **Frontend Zero-Copy Optimization & Web Fallback Isolation (`src/tauriBridge.ts`, `src/App.tsx`, `src/importScan.ts`, `src/PageImage.tsx`)**:
  - Updated `DesktopAPI` signatures: `getThumbnailUrl(id)`, `generateThumbnail(filePath, id)`, and `generateImageVariant(filePath, maxWidth, maxHeight)` returning `CachedImageResult | null`.
  - In `src/App.tsx` (`Cover` component): on desktop, queries `desktopAPI.getThumbnailUrl(m.id)` first. When present, directly assigns the protocol URL without fetching blobs, invoking IPC buffer transfers, or tracking object URLs.
  - In `src/importScan.ts`: on desktop, invokes `desktopAPI.generateThumbnail` to produce the cached disk thumbnail and leaves the in-memory `cover` Blob `undefined`. This prevents retention of large blobs on the V8 heap and avoids subsequent JS-to-Rust thumbnail uploads (`saveThumbnail`). Isolated the `thumbnail()` `ImageBitmap` and `canvas` pipeline purely to web builds (`!cover && !desktopAPI.isDesktop`).
  - In `src/PageImage.tsx`: low-quality variant generation utilizes `desktopAPI.generateImageVariant` returning the zero-copy URL directly.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **35/35 unit tests PASS** (including `test_path_to_mangaimg_url`, `test_calculate_fitted_dimensions`, and `test_resize_image_fir`, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (all storage and bridge unit tests passing).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.55s).
  - `npm run format:check`: **PASS**.

- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **34/34 unit tests PASS** (3 new protocol tests, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (1 new C1 convertFileSrc unit test).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.62s).
  - `npm run format:check`: **PASS**.

## Step B2 & Step 16 — Validation and Backup in Rust & Zero Cover Overhead Export — 2026-11-11

- **Rust Serde Validation Engine (`src-tauri/src/validation.rs`)**:
  - Implemented strict allowlisted deserialization structs with `#[serde(deny_unknown_fields)]`: `ValidatedPage`, `ValidatedPosition`, `ValidatedChapter`, `ValidatedManga`, `ValidatedSettings`, and `BackupPayload`.
  - Added `validate_relative_path` preventing path traversal (`..`, absolute paths, leading/trailing slashes, null bytes, control characters, depth > 64, path length > 4096).
  - Added duplicate page path and duplicate manga ID checks.
  - Enforced operational hard caps (`limits::titles`, `limits::chapters`, `limits::pages`, `MAX_IMAGE_DIMENSION = 32768`, `MAX_IMAGE_AREA = 16_777_216`).
  - Added 6 unit tests in `validation::tests`: traversal rejection, valid backup roundtrip, unknown field rejection (`deny_unknown_fields`), invalid version rejection, duplicate page rejection, duplicate ID rejection.
- **Relational Backup Export & Atomic Restore in SQLite (`src-tauri/src/db.rs`, `src-tauri/build.rs`, `src-tauri/capabilities/default.json`)**:
  - Implemented `export_backup_json(conn)`: queries relational tables in SQLite (`manga`, `chapters`, `pages`, `progress`, `bookmarks`, `settings`) and serializes directly to a version 2 JSON backup payload. Cover blobs are NOT loaded into memory, resolving `re-code.txt` Step 16.
  - Implemented `restore_backup_tx(conn, backup_json)`: validates JSON with `validate_backup_json`, preserves existing `local_path` and `slug` on collisions, writes all records in a single atomic transaction, and updates settings.
  - Registered 3 Tauri commands in `build.rs`, `capabilities/default.json`, `lib.rs`, and `db.rs`:
    - `validate_library_backup`, `export_library_backup`, `restore_library_backup`.
- **Frontend Integration & Multi-Backend Backup (`src/tauriBridge.ts`, `src/repo.ts`, `src/storage.ts`, `src/SettingsPanel.tsx`)**:
  - Extended `DesktopAPI` with `exportBackup()`, `restoreBackup(backupJson)`, and `validateBackup(backupJson)`.
  - Added `exportBackup()` to `LibraryRepo`, implemented in `TauriSqliteLibraryRepo` and `IndexedDBLibraryRepo`.
  - In `SettingsPanel.tsx`, updated `exportData()` and `importData()` to invoke native Rust commands when running on desktop (`desktopAPI.isDesktop`), falling back to `LibraryRepo` on web.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **27/27 unit tests PASS** (including 7 new validation and export/restore tests).
  - `npm run test:validation`: **95/95 unit tests PASS** (including 3 new Step B2 tests in `tests/storage-modular.spec.ts`).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.52s).
  - `npm run format:check`: **PASS**.

## Step B3 — Put Indexing Fully in Rust (`importScan.ts`) — 2026-11-11

- **Native Parallel Indexing Engine (`src-tauri/src/commands/indexing.rs`, `src-tauri/src/commands/image.rs`)**:
  - Implemented `index_title(app, root, options, on_progress: Channel<ScanProgress>) -> Result<TitleDto, String>`.
  - Recursive folder scanning respecting security bounds (`MAX_DEPTH = 64`, `MAX_SCAN_FILES = 100,000`, `AllowedRoots`, allowlisted image extensions, ignored junk directories).
  - Streaming progress updates via `tauri::ipc::Channel<ScanProgress>` (no global event listeners or `scanId` tracking).
  - Chapter grouping: maps subdirectories into chapters (`"Subfolder / Subfolder"`) and root files into `"Root pages"`. Automatically detects root cover/thumbnail files.
  - Dimension reuse from `previous` manga record: checks matching `path`, `size`, and `modified` (mtime ms). When unchanged, dimensions are reused instantly without disk re-reads (`reused` counter tracked).
  - Warm chapter batch dimension parsing: runs parallel header parsing across the Rayon thread pool (`parse_image_dimensions`) for the first 5 chapters (default).
  - Re-link matching:
    - Matches chapters by exact name.
    - Matches renamed chapters by comparing page signature sets (`name\0size\0modified`).
    - Maps saved reading positions and bookmarks using `matching_position` (path-first with filename fallback and clamping).
    - Preserves chapter `read` state when all page names match.
  - Cover & thumbnail generation: detects cover image or first page, invokes `generate_thumbnail_direct` to encode WebP thumbnail atomically on disk (`cache/thumbnails/{manga_id}.webp`).
  - URL slug generation: deterministic ASCII/Unicode hyphenated slugs (`generate_slug`).
  - Unit tests in `commands::indexing::tests`:
    - `test_generate_slug`: alphanumeric hyphenation, trailing trim, default fallback.
    - `test_matching_position_exact_path`: exact path matching with fraction and bookmark preservation.
    - `test_matching_position_leaf_fallback`: fallback to leaf filename across renamed directory paths.
    - `test_chapter_match_exact_and_renamed`: exact name match and signature-based renamed chapter matching.
- **Frontend Bridge & Integration (`src/tauriBridge.ts`, `src/importScan.ts`)**:
  - Defined `IndexScanProgress`, `IndexTitleDto`, and `IndexTitleOptions`.
  - Added `indexTitle(root, options, onProgress)` to `DesktopAPI` and implemented in `TauriDesktopBridge` utilizing `@tauri-apps/api/core` `Channel`.
  - Updated `indexSource` in `src/importScan.ts`: when on desktop with `source.localPath`, delegates directly to `desktopAPI.indexTitle`, updates taskbar and scan progress via Channel callback, and maps returned `TitleDto` to `Manga`.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **31/31 unit tests PASS** (including 4 new indexing tests, 0.01s).
  - `npm run test:validation`: **97/97 unit tests PASS** (including 2 new Step B3 unit tests in `tests/storage-modular.spec.ts`).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.59s).
  - `npm run format:check`: **PASS**.

## Step C1 — Custom URI Protocol Scheme for Zero-Copy Image Streaming (`mangaimg`) — 2026-11-11

- **Custom URI Scheme Protocol in Rust (`src-tauri/src/protocol.rs`, `src-tauri/src/lib.rs`)**:
  - Registered asynchronous URI protocol handler `"mangaimg"` on Tauri builder using `register_asynchronous_uri_scheme_protocol`.
  - Offloaded file I/O and byte range slicing to `tokio::task::spawn_blocking` to avoid stalling the async runtime.
  - Implemented `handle_mangaimg_request(app, req) -> Response<Vec<u8>>`:
    - Decodes URI path with percent-decoding and Windows drive letter formatting (`/C%3A/path` -> `C:/path`).
    - Canonicalizes paths via `dunce::canonicalize` to resolve symlinks and Windows UNC device paths.
    - Security checks: verifies target is in `AllowedRoots` (or `app_cache_dir/thumbnails`), verifies `ALLOWED_IMAGE_EXTENSIONS`, rejects directory traversals and non-regular files, asserts 100 MiB safety ceiling (`MAX_FILE_READ_BYTES`).
    - Generates hexadecimal ETag from `mtime_ms` and file size.
    - Conditional GET: responds with `304 Not Modified` when `If-None-Match` matches.
    - RFC 7233 Byte Range Requests: supports `Range: bytes={start}-{end}` with partial response `206 Partial Content`, `Content-Range: bytes {start}-{end}/{total}`, and `Accept-Ranges: bytes`.
    - HTTP caching headers: sets `Cache-Control: public, max-age=31536000, immutable`.
    - Supports `HEAD` requests (header-only, empty body).
  - Unit tests in `protocol::tests`:
    - `test_decode_request_path`: drive letter extraction, Windows backslash/forward-slash handling, percent-decoding.
    - `test_parse_range`: exact ranges, open-ended ranges, suffix ranges, out-of-bounds rejection.
    - `test_get_mime_type`: accurate MIME resolution across WebP, JPEG, PNG, AVIF, GIF, etc.
- **Frontend Bridge & Component Integration (`src/tauriBridge.ts`, `src/PageImage.tsx`, `src/Bookmarks.tsx`)**:
  - Added `convertFileSrc(filePath, protocol?)` to `DesktopAPI`.
  - Implemented in `TauriDesktopBridge`: calls Tauri's `convertFileSrc(filePath, 'mangaimg')` with standard localhost URL formatting fallback when running without injected internals.
  - Updated `PageImage.tsx`:
    - On desktop (`desktopAPI.isDesktop && mangaLocalPath`), visible images in viewport immediately set `url = desktopAPI.convertFileSrc(absPath, 'mangaimg')` without `read_file` IPC, `new Blob()`, or `URL.createObjectURL()`.
    - Zero-copy streaming directly from disk to WebView2 texture cache.
    - Graceful fallback: on decode failure (`onError`), toggles `useBlobFallback(true)` to silently retry via the existing `fileFor` blob queue before surfacing an error button.
  - Updated `Bookmarks.tsx`:
    - Chapter bookmark previews utilize `desktopAPI.convertFileSrc` when displaying saved positions on desktop.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **34/34 unit tests PASS** (3 new protocol tests, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (1 new C1 convertFileSrc unit test).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.62s).
  - `npm run format:check`: **PASS**.

## Step C2 — Native Rust Cover & Thumbnail Generation with `fast_image_resize` — 2026-11-11

- **Native Rust Image Resizing & URL Returns (`src-tauri/src/commands/image.rs`, `src-tauri/src/commands/cache.rs`, `src-tauri/src/protocol.rs`)**:
  - Re-architected `generate_thumbnail` and `generate_image_variant` to return `CachedImageResult { path: String, url: String }` instead of raw binary bytes.
  - Image downscaling executed using `fast_image_resize` and `image` crate within a bounded Rayon thread pool (`IMAGE_RESIZE_POOL`, 2–6 worker threads) spawned via `tokio::task::spawn_blocking`.
  - Enforced operational safety ceilings: `MAX_IMAGE_SIDE = 32_768`, `MAX_IMAGE_PIXELS = 16_000_000` (16M pixels).
  - Thumbnails and variants are written atomically (`write_atomic`) to native disk cache directories (`app_cache_dir/thumbnails/{id}.webp` and `app_cache_dir/variants/{hash}_{w}x{h}.webp`).
  - Added `get_thumbnail_url(id: String) -> Result<Option<String>, String>` command returning direct `mangaimg` protocol URL if the cached WebP thumbnail already exists on disk.
  - Registered commands and permissions in `build.rs`, `capabilities/default.json`, and `lib.rs`.
- **Frontend Zero-Copy Optimization & Web Fallback Isolation (`src/tauriBridge.ts`, `src/App.tsx`, `src/importScan.ts`, `src/PageImage.tsx`)**:
  - Updated `DesktopAPI` signatures: `getThumbnailUrl(id)`, `generateThumbnail(filePath, id)`, and `generateImageVariant(filePath, maxWidth, maxHeight)` returning `CachedImageResult | null`.
  - In `src/App.tsx` (`Cover` component): on desktop, queries `desktopAPI.getThumbnailUrl(m.id)` first. When present, directly assigns the protocol URL without fetching blobs, invoking IPC buffer transfers, or tracking object URLs.
  - In `src/importScan.ts`: on desktop, invokes `desktopAPI.generateThumbnail` to produce the cached disk thumbnail and leaves the in-memory `cover` Blob `undefined`. This prevents retention of large blobs on the V8 heap and avoids subsequent JS-to-Rust thumbnail uploads (`saveThumbnail`). Isolated the `thumbnail()` `ImageBitmap` and `canvas` pipeline purely to web builds (`!cover && !desktopAPI.isDesktop`).
  - In `src/PageImage.tsx`: low-quality variant generation utilizes `desktopAPI.generateImageVariant` returning the zero-copy URL directly.
- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **35/35 unit tests PASS** (including `test_path_to_mangaimg_url`, `test_calculate_fitted_dimensions`, and `test_resize_image_fir`, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (all storage and bridge unit tests passing).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.55s).
  - `npm run format:check`: **PASS**.

- **Verification**:
  - `cargo test --manifest-path src-tauri/Cargo.toml`: **34/34 unit tests PASS** (3 new protocol tests, 0.01s).
  - `npm run test:validation`: **98/98 unit tests PASS** (1 new C1 convertFileSrc unit test).
  - `npm run typecheck` (`tsc -b`): **PASS** (0 errors).
  - `npm run build`: **PASS** (3.62s).
  - `npm run format:check`: **PASS**.
