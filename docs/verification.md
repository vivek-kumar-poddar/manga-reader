# Verification & Technical Reference

Repository: `manga-reader` (Tauri v2 Desktop + PWA/Web).

Verification battery:

- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml` (56/56 PASS)
- Rust clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` (0 warnings)
- TypeScript tests: `npm run test:validation` (111/111 PASS)
- TypeScript build: `npm run typecheck` (`tsc -b`, 0 errors)
- Production bundles: `npm run build` (Web/PWA) & `npm run build:desktop` (Tauri desktop)
- Formatter: `npx prettier --check`

---

## 1. Core Architecture & System Invariants

### 1.1 Dual-Target Platform Model

- **Desktop (Tauri v2)**: Backend in Rust (`src-tauri/`), UI in React 19 + TypeScript + Tailwind CSS.
- **Web / PWA**: Fallback target using browser FileSystem Access API & IndexedDB (`idb`).
- **Build Isolation**: `vite.config.ts` defines `__DESKTOP_BUILD__`. When `VITE_TARGET=desktop` or `TAURI_ENV_PLATFORM` is set, `resolve.alias` routes `./storage`, `./importScan`, and `./validation` directly to `src/desktop/`, eliminating `idb` and browser handle scanning from the desktop bundle (~48 kB JS reduction; desktop main chunk is ~96 kB).

### 1.2 Database Architecture (`src-tauri/src/db.rs`, `src/repo.ts`)

- **Engine**: SQLite (via `rusqlite` bundled) in WAL mode with foreign keys and cascade deletes enabled.
- **Connection Model (`DbState`)**: Reader-writer split to avoid lock contention:
  - `writer: Mutex<Connection>` with `busy_timeout = 5000ms`, `synchronous = NORMAL`.
  - `reader: Mutex<Connection>` with `PRAGMA query_only = ON`, `busy_timeout = 5000ms`, `synchronous = NORMAL`.
- **Migrations**: Controlled via `PRAGMA user_version` (Version 1: initial relational schema; Version 2: composite index `idx_progress_manga_chapter`).
- **Diff & Upsert**: `insert_or_replace_manga` compares chapter paths/counts before updating, skipping unchanged pages, progress, and bookmarks to prevent write amplification on large titles.
- **Multi-Backend Repositories**:
  - `LibraryRepo` interface in `src/repo.ts`.
  - `TauriSqliteLibraryRepo` (desktop): Relational SQLite persistence via Tauri IPC commands.
  - `IndexedDBLibraryRepo` (web): Object store persistence via `idb`.
  - `ensureLibraryMigrated`: Non-destructive atomic migration from IndexedDB to SQLite on first launch; preserves IndexedDB as fallback.

### 1.3 Custom Image Protocol & Zero-Copy Streaming (`src-tauri/src/protocol.rs`)

- **Scheme**: `mangaimg://` (registered via `register_asynchronous_uri_scheme_protocol("mangaimg", ...)`).
- **URL Format**: `http://mangaimg.localhost/<encoded-absolute-path>`. Formatted via `desktopAPI.convertFileSrc(absPath)`.
- **RFC 7233 Range Requests**: Supports `bytes=start-end` HTTP range requests; capped at 8 MiB per chunk (`MAX_RANGE_CHUNK_BYTES`) to avoid excessive memory allocation.
- **Conditional GET & Caching**: Supports `If-None-Match` parsing with comma-separated lists, wildcards (`*`), and weak entity tags (`W/"..."`), returning HTTP 304 Not Modified. Sends `Cache-Control: public, max-age=86400, must-revalidate`.
- **Allowed Extensions**: JPEG, PNG, WebP, GIF, BMP, AVIF, JXL, HEIC. Files outside `AllowedRoots` return 403 Forbidden.

### 1.4 Native Image & Thumbnail Pipeline (`src-tauri/src/commands/image.rs`, `cache.rs`)

- **Memory Ceiling**: Decodes use `image::Limits { max_alloc: Some(64 * 1024 * 1024), .. }` (64 MiB ceiling) wrapped in `std::panic::catch_unwind` to prevent panics on corrupt image streams.
- **Placeholder Fallback**: Unsupported codecs (AVIF, JXL, HEIC) or corrupted image streams fall back to `create_placeholder_webp`, returning a dark-themed SVG placeholder WebP.
- **Thumbnail Generation**: Native resizing uses `fast_image_resize` inside a bounded Rayon pool (`IMAGE_RESIZE_POOL`, 2–6 threads). Maximum pixel area: 16M pixels; max dimension: 32,768 px.
- **Cache Hashing**: Cache keys hashed with SHA-256 (64 hex characters) in `cache.rs`, preventing hash collisions.

### 1.5 Security & Sandbox Isolation

- **Filesystem Allowlist (`AllowedRoots`)**: In `src-tauri/src/commands/fs.rs`, files can only be accessed if their canonicalized paths reside under user-selected roots or native drag-and-drop targets. Rejects path traversal (`..`), empty root sets, and non-whitelisted paths.
- **Network / Dev Server**: Bound to localhost only (`localhost:5173`). Removed `--host 0.0.0.0`.
- **Content Security Policy (CSP)**: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data: http://mangaimg.localhost; object-src 'none'; base-uri 'self'; frame-src 'none';`.

### 1.6 Frontend Architecture & UI Invariants

- **Protected Files**: `src/controls.css`, `src/Bookmarks.tsx`, `src/App.tsx`, and `src/style.css` contain user styling and must never be arbitrarily rewritten or reverted.
- **Frontend Compute Invariants**: DOM virtualization (`readerGeometry.ts`), autoplay loop (`useAutoplay`), keyboard input (`useReaderKeys`), and progress saving (`useProgressSave`) execute purely in TypeScript on the frontend (zero per-scroll-frame IPC overhead).
- **Natural Sorting**: Cross-platform sorting parity between JS `Intl.Collator` and Rust `natural_sort_paths` using `u128` numeric tokens and `BigNum` magnitude comparison (verified against `tests/fixtures/sorting-fixtures.json`).
- **Typed IPC**: `src/tauriBridge.ts` maps all Tauri commands into typed interface `TauriCommands` and routes via `invokeCommand<K>` with structured error payloads (`DbErrorPayload`, `FsErrorPayload`).

---

## 2. Key Verification History & Step Milestones

### Pre-Rust / Re-Code Foundations

- **Viewport Auto-Scroll (`src/Reader.tsx`)**: Continuous reading speed calculated as `visualViewport.height / seconds` (fallback `innerHeight`). Subpixel accumulation preserved; page dimension changes do not alter scroll velocity.
- **Autoplay Position & Timing (`src/useAutoplay.ts`)**: Advance resets destination chapter to start; manual jump restores saved position. Binary search on `offsets` computes current page from `window.scrollY`. Start/restore/speed changes reset clock.
- **Contracts & Limits (`src/limits.ts`)**: Static limits on backup count, paths, page dimensions, chapter counts, and I/O timeouts (`withinTime`).
- **DOM Virtualization (`src/readerGeometry.ts`)**: Bounded DOM nodes for chapters exceeding 150 pages (`VIRTUALIZATION_THRESHOLD = 150`), rendering top/bottom spacer heights with a 3-page buffer.
- **Observable Progress Durability**: Debounced 1500ms progress saves, flushed on `visibilitychange`, `pagehide`, and `reader-before-update`. In-flight and queued flush promises prevent write interleaving.

### Electron Decommission & Tauri v2 Migration (Steps 01–12)

- Replaced Electron with Tauri v2 (`src-tauri/Cargo.toml`, `tauri.conf.json`).
- Single-instance lock via `tauri-plugin-single-instance`.
- Window state persistence via `tauri-plugin-window-state`.
- Minimized overhead: eliminated CommonJS preloads, native electron binaries, and IPC overhead.

### Rust Migration Steps B1–E

- **Step B1 (SQLite & Multi-Backend `LibraryRepo`)**: `src-tauri/src/db.rs` relational schema with WAL mode; `TauriSqliteLibraryRepo` in `src/repo.ts`; atomic import migration preserving IndexedDB.
- **Step B2 (Validation in Rust)**: `src-tauri/src/validation.rs` with `#[serde(deny_unknown_fields)]`, duplicate ID rejection, traversal detection, and `export_library_backup` without cover blob RAM allocation.
- **Step B3 (Native Title Indexing)**: `src-tauri/src/commands/indexing.rs` streaming progress over Tauri IPC `Channel`, chapter grouping, and dimension reuse.
- **Step C1 (Zero-Copy Image Streaming)**: Custom `mangaimg://` URI protocol with HTTP range requests and ETag caching.
- **Step C2 (Native Image Resizing)**: `fast_image_resize` and cached thumbnails returning protocol URLs.
- **Step C3 (Native Drag & Drop)**: `WindowEvent::DragDrop` handler automatically registering dropped folder paths into `AllowedRoots`.
- **Step D (Rust Tests, Clippy & CI)**: Rust unit test suites, Clippy `-D warnings` enforcement, and GitHub Actions CI workflow (`.github/workflows/ci.yml`).
- **Step E (Desktop Build Target Optimization)**: `VITE_TARGET=desktop` flag, conditional VitePWA exclusion, and typed updater bridge.

### Platform & Database Hardening (Steps 21–29)

- **Step 21 (Security Hardening)**: Strict empty allowlist rejection, `record_opened_root` restricted to existing roots, CSP hardened, dev server LAN binding removed.
- **Step 22 (Portable Toolchain & Manifest Build)**: Removed hardcoded paths in `.cargo/config.toml`; dynamic `-specs` and `windres` compilation via `src-tauri/build.rs` to `OUT_DIR`.
- **Step 23 (Native Updater Wired)**: Added `tauri-plugin-updater = "2"`, `updater:default` capability, `createUpdaterArtifacts = true`, pointing to `vivek-kumar-poddar/manga-reader`.
- **Step 24 (Repository Cleanup)**: Removed legacy Electron checks, `.gitignore` entries, and stray files.
- **Step 25 (Threading & Non-blocking Runtime)**: Offloaded all synchronous filesystem and DB commands from main thread to `tauri::async_runtime::spawn_blocking`; split DB into reader/writer connections.
- **Step 26 (Database Migrations & Diff Upsert)**: Numbered migrations via `PRAGMA user_version`; `PRAGMA synchronous = NORMAL`; 5s busy timeout; diff-and-upsert in `insert_or_replace_manga`; structured `DbError` serialization.
- **Step 27 (Config Hardening)**: Added `#[serde(default)]` on `AppConfig` and `WindowPreferences`; implemented atomic `set_window_preferences` setter; retired dead config fields.
- **Step 28 (Image Pipeline & Protocol Hardening)**: WebP placeholder fallback for unsupported codecs (AVIF, JXL, HEIC); safe decode memory allocation ceiling (64 MiB) with `catch_unwind`; SHA-256 cache identifiers; 8 MiB range chunk cap; weak ETag parsing; `u128` integer precision natural sort.
- **Step 29 (Windows Platform Hardening)**: Tray minimization (`WindowEvent::Resized` with `window.hide()`); flash-free window reveal via bundled `src-tauri/scripts/init.js` and `show_main_window` command; recursive roaming migration with error logging.

### TypeScript Architecture & Modernization (Step 30)

- **Web vs. Desktop Module Split**: `src/desktop/` (`storage.ts`, `importScan.ts`, `validation.ts`) and `src/web/` (`storage.ts`, `importScan.ts`, `validation.ts`), re-exported via facades. `vite.config.ts` alias reduces desktop bundle by ~48 kB JS.
- **Validation Deduplication**: Desktop delegates `validateBackup` to Rust `desktopAPI.validateBackup`.
- **Reader Hook Extraction**: Extracted `useAutoplay`, `useReaderKeys`, and `useProgressSave` from `Reader.tsx`, preserving layout, gestures, and styling.
- **Typed Invocations**: Added `TauriCommands` interface and `invokeCommand<K>` typed wrapper with `parseTauriError` error surfacing.

### Release Blockers: Import & Desktop Contracts (Step 31)

- **tauriBridge Deduplication (P0)**: Eliminated duplicate `TauriErrorPayload`, `DbErrorPayload`, `parseTauriError`, `TauriCommands`, and `invokeCommand` declarations.
- **Desktop chapterGroups & ChapterPreview DTO (P0 / P1)**: Implemented real chapter grouping in `src/desktop/importScan.ts` returning `Map<string, number>`, and defined purpose-built `ChapterPreview { name, pageCount }` and `chapterPreviews()` consumed by `ImportDialogs.tsx`. Unblocks the desktop import button.
- **Collection Splitting (P0)**: Replaced `splitSource()` stub with native discovery / folder splitting, partitioning child roots with relative file maps and child `localPath`s.
- **Import Persistence (P0)**: Ensured `indexSource()` and `useImport.ts` commit titles via `saveManga()` before incrementing completed count or registering success, preventing phantom success states with uncommitted SQLite records.
- **Platform Export Reconciliation (P0)**: Reconciled `src/desktop/storage.ts` with facade exports (`migrateV1ToV2`, `AccessCacheEntry`, `MangaDB`).
- **prepareChapter & warmSources Contracts (P1)**: Standardized on shared `PrepareChapterOptions { signal, update }` across web and desktop; aligned `warmSources(sources, options, sort)` signatures and progress emissions.
- **ScanState Consistency (P1)**: Made `ScanState.title` optional and explicitly initialized empty titles in `useImport.ts` initial states.
- **Dual-Platform TS Configurations & Entry Points (P1)**: Added `src/main.desktop.tsx`, `src/main.web.tsx`, `tsconfig.desktop.json`, and configured `npm run typecheck` to execute `tsc -b && tsc -p tsconfig.desktop.json --noEmit`. Configured `vite.config.ts` with `platformEntryPlugin` to inject the correct entry script at build time.

### Import Behavior and Cancellation (Step 32)

- **Preview Title Edits Passed & Persisted**: Confirmed titles edited in `ImportDialogs.tsx` are explicitly passed via `IndexOptions.title` into native `index_title` in Rust. Rust uses the confirmed title for `title_name` and URL slug generation, and `indexSource()` saves the manga record with the confirmed title to SQLite.
- **Desktop Duplicate Detection via Canonical Root Identity**: Added native `is_same_path(path_a, path_b)` Tauri command leveraging `dunce::canonicalize` with normalized path fallback. Exposed `desktopAPI.isSamePath` consumed by `ImportDialogs.tsx` to match desktop library candidates by canonical root identity rather than browser directory handles.
- **Preserved Collection Grouping**: `fromDesktopFolder()` records native `discoveredTitles` on `Source`. `splitSource()` partitions multi-title collections using native title names, child root paths (`localPath`), and clean relative file maps, preserving collection identity throughout preview and commit.
- **Bounded Worker Pool (`pooled`)**: Replaced broken unthrottled loop and faulty `splice(indexOf(e))` logic with a tested, bounded worker pool that pulls from a shared index up to concurrency limit, handles worker errors, and honors `AbortSignal`.
- **Generation Ownership on Cancel & Cleanup (`useImport.ts`)**: `cancel()` increments `activeOp.current` generation counter. Continuations in `discover()` and `runImport()` verify generation ownership before committing or updating state. `runImport()`'s `finally` only executes `finish()` (clearing `controller.current` and resetting progress bar) if the active generation is still owned by that operation.
- **Local Outcome Tracking (`discover`)**: `discover()` tracks its outcome locally (`'preview' | 'failed' | 'cancelled' | 'idle'`) so `finally` evaluates the actual operation result rather than stale captured React state.
- **Native Cancellation Token & In-Traversal Checks (`fs.rs` & `indexing.rs`)**:
  - Upgraded `ScanManager` to provide both `watch::Receiver<bool>` and lock-free `Arc<AtomicBool>`.
  - In `list_folder` and `discover_library`, `cancel_flag` is verified on every single entry inside the synchronous `walkdir` traversal loop and before each expensive batch.
  - In `index_title`, registered `job_id` with `ScanManager`. The directory scan checks `cancel_flag` inside `walker`, dimension extraction checks before/inside batches, and disconnection of `on_progress` immediately flags cancellation and halts native work.
- **Comprehensive Issue Reporting**: Native `index_title` catches traversal errors, metadata failures, scan limits (`MAX_SCAN_FILES`), and unreadable dimension headers, returning them in `TitleDto.issues` rather than returning an empty issue vector.
- **Per-Page Failure Reporting in `prepareChapter`**: `prepareChapter()` returns per-page `Issue[]` entries when image dimensions cannot be parsed from headers, avoiding false representation of complete success.
- **Native Background Job Ownership**: Replaced empty stubs in `desktop/importScan.ts` with a real `backgroundJobs` map, `scheduleBackground()`, `stopBackground()`, `stopAllBackground()`, `onMangaDelete()` subscription, and `resumeBackground()` persistence drain loops.

### Paths and Filesystem Authorization (Step 33)

- **Native Page Path Resolver**: Added native `resolve_manga_path` and `resolve_relative_path` in Rust (`src-tauri/src/commands/fs.rs`), leveraging `DbState::get_local_path` to resolve relative page paths against the manga root while strictly rejecting directory traversal (`..`) and escaping absolute paths. `desktop/storage.ts → fileFor(m, p)` resolves relative paths via `desktopAPI.resolvePath(m.id, p.path, m.localPath)` before native file reading, eliminating process CWD resolution errors.
- **Native Header Dimension Extraction**: Updated `prepare_chapter_headers` in Rust to accept `manga_id: Option<String>`. When `manga_id` is supplied, relative chapter page paths are resolved against the manga's canonical local path, and returned `PageHeader`s preserve the requested relative path keys. In `desktop/importScan.ts → prepareChapter()`, `paths` and `manga.id` are forwarded directly without ad-hoc string concatenation in JS.
- **Accurate Folder Access & Missing Drive Verification**: Replaced unconditional `true` in `desktop/storage.ts → access()` with native `desktopAPI.checkAccess(manga.id, manga.localPath)`. In Rust, `check_access` verifies disk existence (`dunce::canonicalize`), folder directory status, and `AllowedRoots` membership. Missing drives, moved folders, and deleted paths return `false`, enabling `App.tsx`'s `needs` state to display the "Re-link needed" button. Implemented 7.5s TTL caching for passive checks (`request=false`) while forcing immediate disk verification when `request=true`.
- **Severed History-to-Permission Vulnerability**: Removed `lib.rs` startup logic that automatically added entries from `last_opened_roots` into `AllowedRoots`. Recent MRU history is strictly separated from user authorization.
- **Authorized-Only MRU Recording**: `record_opened_root` in Rust now validates that candidate paths already reside under an active `AllowedRoots` entry before recording into MRU history. Unauthorized paths are rejected with errors and cannot acquire indirect permission.
- **Root Revocation**: Added `revoke_root` and `get_authorized_roots` commands to Rust and `desktopAPI`. Revoking an authorized root cleanses it from `AllowedRoots`, updates persisted `allowed_roots.json`, and purges matching entries from MRU history.

### Filesystem Security, Path Validation, and TOCTOU Hardening (Step 34)

- **Comprehensive Relative Path Validation**:
  - `src-tauri/src/validation.rs → validate_relative_path`: Rejects colons (`:`), Windows drive prefixes (`C:/...`), alternate data streams (`:stream`), URI schemes, UNC prefixes (`//...`), reserved DOS device names (`con`, `prn`, `aux`, `nul`, `com1`..`com9`, `lpt1`..`lpt9`), trailing spaces/dots, and whitespace boundaries before joining.
  - `src/desktop/validation.ts` & `src/web/validation.ts`: Replaced crude `includes('..')` substring check with component-based segment validation. Legitimate double-dot filenames such as `chapter..jpg` are permitted while directory traversal segments (`.` and `..`), rooted paths, drive prefixes, colons, UNC prefixes, reserved DOS names, and trailing spaces/dots are rejected.
- **Fail-Closed Authorization with Preserved Relinking Roots**:
  - `AllowedRoots` in `src-tauri/src/commands/fs.rs` splits tracking into `active` and `unavailable` root sets.
  - `resolve_canonical_path` resolves canonical paths against disk or closest existing parent directory, failing closed for nonexistent roots.
  - Persisted roots from temporarily disconnected media (e.g. unplugged USB drives) are preserved in `unavailable` across restarts rather than silently wiped. If the drive is reconnected, `AllowedRoots::is_allowed` automatically detects reachability and promotes it to `active`.
- **Scoped Drag-and-Drop Authorization**:
  - In `src-tauri/src/lib.rs`, `WindowEvent::DragDrop` handler verifies each dropped item. If a folder is dropped, that folder root is authorized. If a single file is dropped, only that exact file path is authorized (`allowed.add_root(path.clone())`), never granting the entire parent directory.
- **UNC Path Normalization Separation**:
  - In `src/paths.ts`, `normalizePath(path)` detects leading `\\\\` or `//` and preserves the leading double-slash for UNC network paths (`//server/share/...`).
  - Added `normalizeRelativePath(path)` to strip boundary slashes and normalize relative manga/page paths separately from OS/network paths.
- **Elimination of TOCTOU Check-and-Reopen Windows**:
  - In `src-tauri/src/protocol.rs` (`handle_mangaimg_request`), the target file descriptor is opened immediately after allowlist validation (`File::open(&resolved)`). Metadata inspection, size limits, and mtime/ETag calculation are performed directly on the open handle. HTTP range streaming (`file.seek` + `file.read_exact`) and full 200 OK body reads (`file.read_to_end`) operate on that same verified descriptor without calling `File::open` or `std::fs::read` again.
  - In `src-tauri/src/commands/fs.rs` (`read_file`), files are opened once via `tokio::fs::File::open(&resolved)`, metadata is verified on the descriptor, and bytes are read via `read_to_end` directly from the handle.

### Persistence, Migration, and Cache Consistency (Step 35)

- **Active Repository Ownership of Invalidation**:
  - Eliminated the failing `repo instanceof TauriSqliteLibraryRepo` check in `desktop/storage.ts` (where `repo` is a forwarding proxy object).
  - Broken circular invalidation recursion by ensuring `TauriSqliteLibraryRepo.invalidateCaches()` only clears its own cache fields and increments the generation counter, without re-calling storage invalidators.
  - Storage wrappers (`desktopStorage.invalidateSummaryCache()` and `invalidateBookmarkCache()`) delegate solely to the active repository via `getRepo().invalidateCaches?.()`.
- **Generational Bookmark Cache Invalidation**:
  - Attached a monotonic `bookmarkGeneration` counter to both `TauriSqliteLibraryRepo` (desktop) and `src/web/storage.ts` (web).
  - Asynchronous completions from in-flight requests that were superseded by subsequent cache invalidations or fresh fetches are discarded, preventing stale requests from repopulating the cache.
- **Unified Single-Transaction Backup Restore**:
  - Refactored `src/SettingsPanel.tsx → importData()` to invoke the application repository's `restoreBackup()` wrapper instead of calling `desktopAPI.restoreBackup()` directly.
  - Preserved full cache invalidation, deletion notifications (`notifyDelete()`), and cross-window sync broadcasts (`broadcastSync({ type: 'library' })`).
  - Removed the prior destructive clear step (`sqliteClearLibrary()`); backup restoration validates and replaces/merges data in a single native SQLite transaction (`restore_backup_tx`), leaving existing data 100% intact if validation fails.
- **Desktop Native Methods Fail Explicitly**:
  - Desktop-required methods in `TauriSqliteLibraryRepo` (`listLibrary`, `getManga`, `saveManga`, `saveProgress`, `ensureBookmarks`, `addBookmark`, `removeBookmark`, `deleteManga`, `clearLibrary`, `resetProgress`, `getStoredSettings`, `saveStoredSettings`, `restoreBackup`) now throw explicit Errors if `desktopAPI.*` is missing, preventing silent no-ops.
- **Resilient Legacy IDB Reader Distinguishing Empty vs Failed**:
  - Implemented `readLegacyIndexedDB()` in `src/repo.ts` which inspects real browser/webview IndexedDB directly via standard DOM APIs.
  - Explicitly categorizes legacy states: `'empty'` (database never created or empty), `'unavailable'` (no indexedDB in environment), `'data'` (valid legacy titles/settings), and `'failed'` (open or read error).
  - In `ensureLibraryMigrated()`, read failures throw an explicit Error and never mark migration complete with empty data.
- **Atomic File Persistence & Serialization**:
  - Hardened `commands/fs.rs → write_atomic` with per-destination mutex locks (`LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>>`), unique same-directory temp files (`.{stem}_{pid}_{counter}.tmp`), `file.sync_all()`, and Windows file replacement retry loops.
  - Propagated persistence errors in `commands/config.rs` (`save_persisted_config` and `AppConfigState::update`), returning `Result<T, String>` to prevent falsely claiming settings were saved when disk writes fail.
- **Resumable Profile Migration with Lock**:
  - Implemented `MigrationLock` in `src-tauri/src/migration.rs` creating `migration.lock` to prevent concurrent copies or copying actively written profiles, with automatic 60s stale lock timeout recovery.
  - Added `copy_dir_resumable_and_verify` using atomic staging files (`.{filename}.stage`), source-to-destination size verification, and a `.migration_complete` marker file.
- **Stable Chapter Identity Decoupled from Display Name**:
  - Added `chapter_id` to `chapters`, `pages`, `progress`, and `bookmarks` tables, populated via `derive_chapter_id(manga_id, chapter, chapter_idx)`. Progress and bookmarks remain anchored to chapter folder/file identity across title rescans, folder renames, or chapter reordering.
  - Persisted and restored `dimensions_pending` in `pages` table and `PageRecord`.
  - Wrapped v1 -> v2 schema migrations and `PRAGMA user_version = 2;` inside a single unchecked transaction.

### Validation and User Data Preservation (Step 36)

- **Canonical DTO Schema Parity**:
  - `src/desktop/validation.ts → parseSettings`: Parses and preserves every settings field including `fontSizeTitle`, `fontSizeUi`, `fontSizeButton`, `confirmDelete`, and `shelfSort`, matching `defaults`, `Settings`, and Rust's `normalize_settings`.
  - `src/desktop/validation.ts → parsePosition` & `matchingPosition`: Preserves `mangaBookmark` flag and `timestamp` when validating and mapping bookmark/progress positions. Prevents title bookmarks from silently degrading into ordinary bookmarks.
  - `src/desktop/validation.ts → parseManga`: Preserves `sort` and `revision` fields; strictly rejects empty or malformed manga IDs (`id.trim() === ''` or non-string) with `ValidationError` instead of defaulting to `"unknown"`, preventing ID collisions and corrupt records.
  - `src/desktop/validation.ts` & `src/web/validation.ts → parseSummary`: Preserves `revision` and `sort` metadata.
  - `src/desktop/validation.ts → parsePage`: Rejects finite negative, fractional, NaN, or non-integer dimensions with `ValidationError`. Supports unmeasured pending pages when `dimensionsPending: true` and `width == 0 && height == 0`.
- **Desktop Validation Authority & Synchronous Parity**:
  - Synchronous `validateBackup()` enforces version checks (supported: 1, 2), array structure, duplicate ID detection, and comprehensive limits (`limits.titles`, `limits.backupPages`, `limits.chaptersPerTitle`, `limits.pagesPerTitle`, `limits.bookmarksPerChapter`) identically to Rust and Web validation.
  - `validateBackupAsync()` routes through `desktopAPI.validateBackup(jsonStr)` to ensure Rust backend validation acts as the single source of authority for backup verification on desktop.
  - Rust `validate_page` in `src-tauri/src/validation.rs` supports `dimensions_pending: true` for pending image measurements while enforcing positive integer pixel boundaries on all measured pages.

### Image Generation and Caching Hardening (Step 37)

- **Crash Resilience and Panic Strategy**:
  - Configured `[profile.release] panic = "unwind"` in `src-tauri/Cargo.toml`, ensuring `std::panic::catch_unwind` in image decoding actually catches decoder panics in release builds rather than aborting the process.
- **Strict Format Capability Matrix**:
  - Defined `FORMAT_MATRIX` in `src-tauri/src/commands/image.rs` explicitly classifying 14 supported image file extensions into 4 capability flags: `recognized_extension`, `header_readable`, `webview_displayable`, and `rust_decodable`.
  - `safe_decode_image` validates `rust_decodable` before attempting decode, preventing unsupported formats like AVIF, HEIC, or JXL from triggering decoder panics or corrupt state.
- **Total Job Memory Budget & Dimension Clamping**:
  - Enforced a 64 MiB total job memory budget (`MAX_IMAGE_JOB_MEMORY_BYTES`) across header inspection, raw byte decoding, 4-byte RGBA expansion, resize buffers, and WebP encoding.
  - `create_placeholder_webp` validates width, height, maximum pixel area (4,096 x 4,096), and estimated RGBA memory before allocating buffers, eliminating unbounded multi-gigabyte allocations.
  - `generate_image_variant` validates target dimensions (`width > 0 && width <= 4096`, `height > 0 && height <= 4096`) and memory bounds prior to cache lookups and decodes.
- **Reliable Persistence, Verification, and Explicit Error Handling**:
  - `generate_image_variant`, `generate_thumbnail`, and `generate_thumbnail_direct` propagate atomic write errors and verify disk artifact existence before returning success.
  - Removed silent JPEG fallback in WebP encoding (`resize_image_fir`); failures fail explicitly and never write JPEG bytes under `.webp` extensions.
  - Corrupt or unreadable images never write persistent gray placeholder files to disk; explicit error status and error messages are returned in `CachedImageResult`.
- **Source-Versioned Caching & Invalidation**:
  - Thumbnails check source cover file modification time (`mtime`) against cached thumbnail `mtime`; updated covers automatically trigger regeneration.
  - Variant cache keys hash a composite specification: identity, file size, modification timestamp, transform bounds, and encoder version (`IMAGE_ENCODER_VERSION = "v1"`).
  - Cache namespace isolation: `commands/cache.rs → sanitize_id` hashes into `thumb_v1:` with prefix `t_`, preventing Windows reserved device name collisions (`CON`, `PRN`, `AUX`, `NUL`, etc.) and namespace collisions between raw IDs and hashes; variant keys hash into `variant_v1:` with prefix `v_`.
  - `save_thumbnail` strictly validates JSON byte arrays (values must be 0..=255 and integral), rejecting malformed inputs without silent truncation or dropping.

### Image Protocol Correctness and URL Segment Encoding (Step 38)

- **RFC 3986 Path Segment Encoding**:
  - Implemented `encode_path_segment` in `src-tauri/src/protocol.rs` and aligned `convertFileSrc` in `src/tauriBridge.ts`. Unreserved characters (`alphanumeric`, `-`, `_`, `.`, `~`) remain unencoded while spaces (`%20`), `#` (`%23`), `%` (`%25`), `[` (`%5B`), `]` (`%5D`), and multi-byte UTF-8 bytes are encoded individually.
  - Prevents WHATWG URL parsers from truncating paths at `#` (which browsers treat as URL fragment delimiters) and protects filenames containing literal `%` characters from corrupt decoding.
- **RFC-Compliant Range Parsing**:
  - `parse_range` rejects suffix ranges when `total_size == 0` (returning `None` instead of `Some((0, 0))` on empty files).
  - Rejects extra hyphens (e.g. `0-10-20`, `0--10`), extra commas (`0-10,`, `,0-10`), and non-digit numbers.
- **Weak Validator ETags & Immediate Revalidation**:
  - Formatted metadata-based ETags as weak validators `W/"{:x}-{:x}"` per RFC 9110 Section 8.8.3.
  - Replaced `max-age=86400` with `Cache-Control: no-cache` across responses. Browsers/webviews revalidate with `If-None-Match` on every retrieval, receiving `304 Not Modified` instantly while immediately detecting local file modifications.
- **Request Method & CORS Hardening**:
  - Enforced `GET` and `HEAD` only; other HTTP methods return `405 Method Not Allowed` with `Allow: GET, HEAD`.
  - Replaced wildcard `Access-Control-Allow-Origin: *` with origin reflection restricted to trusted application origins (`tauri://localhost`, `https://tauri.localhost`, `http://tauri.localhost`, `http://localhost:5173`, `http://mangaimg.localhost`) and added `Vary: Origin`. Untrusted origins receive no CORS header.
- **Explicit Cache Artifact Authorization**:
  - Replaced broad cache directory authorization with `is_explicit_cache_artifact`, permitting only `.webp` files starting with `t_` or `v_` inside `thumbnails` or `variants` subdirectories.
  - Supported opaque endpoints `/thumb/<id>` and `/variant/<hash>` as first-class protocol targets.
- **Memory-Bounded Reads on Open File Descriptor**:
  - File descriptors are opened once; initial size checks are enforced via metadata on the descriptor.
  - 200 OK reads use `file.take(MAX_FILE_READ_BYTES + 1).read_to_end(&mut buffer)` and verify `buffer.len() <= 100 MiB`, bounding memory allocations on concurrently growing files and guaranteeing `Content-Length` matches actual body bytes sent.

### Frontend Resilience, Transition Serialization & Storage Sync (Step 39)

- **Handled Progress Save & Queued Retry**:
  - `src/useProgressSave.ts`: Replaced discarded `savePromise.finally(...)` with `savePromise.then(onFulfilled, onRejected)`, fully handling cleanup rejections without leaving unhandled promise rejections.
  - Reset `queuedFlush.current` on both fulfillment and rejection via handled catch blocks, ensuring failed saves can be retried immediately without getting trapped in a stale rejected promise.
- **Asynchronous Navigation Serialization & Rejection Handling**:
  - `src/useReaderKeys.ts`: Added `navigatingRef` lock protecting asynchronous `goChapter()` transitions from overlapping executions when arrow keys are pressed repeatedly, and caught rejections.
  - `src/useAutoplay.ts`: Wrapped asynchronous `goChapter()` calls in `handleTransition()`, stopping playback, revealing bars, and reporting error notifications when chapter transitions fail.
  - `src/Reader.tsx`: Added `.then().catch()` handling to unmount `flush()` invocation; `refresh()` is called only when progress is successfully `'saved'`, avoiding pretending persistence succeeded on failure.
- **Empty Title Validation & Recovery**:
  - `src/Reader.tsx`: Validated that `manga.chapters` and pages are non-empty before indexing into them in `ReaderLoaded`. Renders a recoverable error gate ("No readable pages in this title") with navigation buttons instead of crashing with uncaught `TypeError`.
- **Immutable Page Metadata & Geometry Recalculation**:
  - `src/PageImage.tsx` & `src/Reader.tsx`: Added `onDimensionsResolved` callback. Resolved dimensions update `metadata.current` immutably and invoke `actions.current.measure(false)` to recompute reader geometry and virtual window ranges.
- **Title Bookmark Isolation**:
  - `src/App.tsx`: Removed destructive fallback in `toggleMangaBookmark()`. Unbookmarking a title strictly removes bookmarks with `mangaBookmark === true`, leaving all ordinary chapter and page bookmarks completely untouched.
- **Generational Bookmark Loading**:
  - `src/Bookmarks.tsx`: Added monotonic `loadGen` counter. Outdated asynchronous bookmark loads that finish after a subsequent reload are automatically discarded, preventing stale query overwrites.
- **Local Storage Sync Dispatch**:
  - `src/desktop/storage.ts` & `src/web/storage.ts`: Implemented `onStorageSync` for local subscribers. `broadcastSync` dispatches locally to registered listeners and dispatches a synthetic `MessageEvent` on `syncChannel` in the same window, solving the WHATWG `BroadcastChannel` limitation where an instance never receives its own broadcasts. Aligned channel names to `manga-reader:sync`.

### Queue and Object-URL Lifecycle (Step 40)

- **Multi-Subscriber Queue Completion & Work Deduplication**:
  - `src/imageQueue.ts`: Enqueueing duplicate keys registers callers as distinct subscribers under `subscribers: Map<number, Subscriber>`.
  - The heavy image fetch/decoding work (`primaryRun`) executes exactly once per key, eliminating redundant decoding and IPC roundtrips while all subscribers receive their own `onComplete` or `onError` notifications.
- **Subscriber-Aware Cancellation**:
  - Cancellation handles unregister only the individual caller's subscription. In-flight and waiting tasks continue executing if other subscribers are still listening; tasks are aborted via `AbortController` only when the last subscriber cancels.
- **Identity-Safe Task Cleanup & Non-Premature `clear()`**:
  - `clear()` aborts in-flight task controllers without wiping the in-flight tracking map before async jobs settle.
  - Completed and aborted jobs clean themselves up via strict reference identity check (`inFlight.get(item.key) === item`), preventing newer tasks for the same key from being prematurely deleted by older completions.
- **Consumer Reference Counting & Pinned Object-URL Protection**:
  - `src/objectUrlPool.ts`: Added consumer reference counting (`retain(key)` and `release(key)`).
  - Overwriting an existing key with a different URL immediately revokes the old URL.
  - LRU eviction is consumer-aware: URLs retained by active components (e.g. mounted `<PageImage>`) remain valid in memory and are revoked only when both the cache and all active consumers release the resource.
  - `clear()` revokes unpinned URLs immediately and marks pinned URLs for deferred revocation upon consumer unmount.

### Desktop UI, Storage Statistics, Build Verification & CI Gates (Step 41)

- **Native Storage Statistics**:
  - `src-tauri/src/commands/cache.rs → get_storage_stats`: Returns `StorageStats` (`{ db_bytes, cache_bytes, total_bytes }`) calculating the real on-disk sizes of `library.db`, `library.db-wal`, `library.db-shm`, and recursive sizes of `thumbnails/` and `variants/` in `app_cache_dir()`.
  - `src/SettingsPanel.tsx`: Displays exact native database and thumbnail cache usage on desktop instead of browser `navigator.storage.estimate()`.
- **Explicit Thumbnail Cache Clearance**:
  - Provided explicit "Clear thumbnail cache" action in `SettingsPanel.tsx` calling `desktopAPI.clearThumbnails()`, freeing disk space while leaving SQLite library records and settings intact.
- **Native Save File Dialog on Desktop**:
  - `src-tauri/src/commands/cache.rs → save_file_dialog`: Uses `app.dialog().file().blocking_save_file()` in `tokio::task::spawn_blocking` to present the native OS save dialog and write output files directly.
  - `src/SettingsPanel.tsx`: Replaced browser download DOM anchors (`<a download>`) with `desktopAPI.saveFileDialog()` for both metadata backup exports and diagnostic log exports on desktop.
- **Dynamic Build Path Resolution & Manifest Fail-Fast**:
  - `src-tauri/build.rs`: Dynamically resolves the target profile directory using `OUT_DIR` ancestors (`out_dir.ancestors().nth(3)`) for `WebView2Loader.dll` copying, supporting custom `CARGO_TARGET_DIR` and cross-compilation target triples.
  - `windres` execution asserts `status.success()`, failing the build immediately if manifest compilation fails instead of silently ignoring failures.
- **Unified Single Source of Truth for App Version**:
  - `package.json` version (`2.0.0`) is injected into the build pipeline via `vite.config.ts` (`__APP_VERSION__`), eliminating hardcoded version drift across frontend components and settings dialogs.
- **Comprehensive CI Gates**:
  - `.github/workflows/ci.yml`: Configured mandatory gates for Rust formatting (`cargo fmt --check`), strict clippy (`cargo clippy --locked -D warnings`), cargo test (`cargo test --locked`), dual TypeScript typecheck, Playwright validation suite (119 unit & acceptance tests), production web build, and production desktop build.

### Native Image URLs & Desktop Resource Contract (Step 42 — 2.3)

- **Improved Resource Contract**:
  - Defined explicit resource contract: `page ID + source version + transform → native original/preview URL`.
  - Formatted page URLs as `http://mangaimg.localhost/page/<manga_id>/<version>/<transform>/<encoded_page_path>?root=<optional_root>`.
  - Formatted cover URLs as `http://mangaimg.localhost/cover/<manga_id>/<version>`.
- **Rust Custom Protocol Routing (`src-tauri/src/protocol.rs`)**:
  - Added `PageResourceParams`, `CoverResourceParams`, `parse_page_resource_uri`, `parse_cover_resource_uri`, `build_page_resource_url`, and `build_cover_resource_url`.
  - Implemented `DbState::get_local_path_sync(&manga_id)` for non-blocking synchronized SQLite reader index lookups.
  - Page request handling resolves `base_dir` from DB (or `?root=` fallback), verifies safe relative paths via `resolve_relative_path`, checks `AllowedRoots`, and serves original files directly (`transform: full/raw`) or automatically creates/serves cached WebP variants (`transform: low/preview/fit_WxH`) via `generate_image_variant_direct`.
  - Cover request handling checks `thumbnails/t_<hash>.webp` directly; if missing and the manga has a localPath, lazily generates the cover thumbnail via `try_find_and_generate_cover`.
  - Serves all images with weak RFC 9110 ETags (`W/"<mtime>-<size>"`), `Cache-Control: no-cache` for instant 304 revalidation, 8 MiB range chunk capping, and trusted CORS headers.
- **Frontend Desktop Default & Blob Elimination**:
  - `src/tauriBridge.ts`: Exposed `PageImageResourceOptions`, `getPageImageUrl`, and `getCoverImageUrl` on `DesktopAPI`, `TauriDesktopBridge`, and `WebDesktopBridge`.
  - `src/PageImage.tsx`: Defaults to `desktopAPI.getPageImageUrl` in desktop mode, loading images natively in the browser without calling `fileFor`, `readFile`, `new Blob()`, or `URL.createObjectURL()`. Retains `useBlobFallback` strictly as an error recovery fallback.
  - `src/App.tsx` (`Cover`): Uses `desktopAPI.getCoverImageUrl` by default, eliminating routine IPC byte transfers across cover grids with lazy fallback to `getCover` on decode error.
  - `src/Bookmarks.tsx` (`Thumbnail`): Uses `desktopAPI.getPageImageUrl` or `desktopAPI.getCoverImageUrl` by default.
- **Centralized Source Invalidation**:
  - Source version token (`mangaUpdatedAt`) in the URL path ensures that database updates or folder re-scans automatically bust the WebView's HTTP cache without manual cache busting.

### Eliminate Duplicate Work Before Adding Threads (Step 43 — 2.1)

- **Retained Discovery Snapshot (`src-tauri/src/commands/fs.rs` & `indexing.rs`)**:
  - `DiscoveryState`: Tauri-managed state caching discovery snapshots (`DiscoverySnapshot`) with 15-minute TTL and max 8 entries.
  - In `discover_library()`, discovered candidate pages and dimensions are cached in `DiscoveryState`.
  - In `index_title()`, checks `DiscoveryState` for a matching snapshot; if found, revalidates file presence and modification timestamps via `fs::metadata` only without re-running walkdir or reading file bytes. Pre-populates dimension cache directly from the snapshot.
- **Native Previous Metadata Loading (`src-tauri/src/db.rs`)**:
  - `DbState::get_previous_manga_for_indexing_sync`: Reads previous manga metadata, chapters, and pages directly from SQLite reader connection by `target_id` or `local_path`.
  - Eliminates serializing and transferring the entire previous manga record from JS into Rust over IPC.
- **Native SQLite Indexing Commit (`src-tauri/src/db.rs` & `indexing.rs`)**:
  - `DbState::save_manga_sync`: Synchronously commits the newly indexed manga record directly to SQLite on the writer lock inside `index_title`.
  - Eliminates returning the full indexed manga back to JS only for JS to immediately re-serialize and send it back to SQLite via `saveManga`.
  - Returns enriched `TitleDto` containing summary metadata (`chapter_count`, `page_count`, `has_pending_dimensions`).
- **Bookmark Cards Direct SQL Join Query (`src-tauri/src/db.rs`)**:
  - `query_bookmark_cards` / `get_bookmark_cards`: Executes a single SQL query joining `bookmarks`, `manga`, `chapters`, and `pages` with `WHERE` filtering for tabs (`all`, `manga`, `individual`), sort ordering (`newest`, `oldest`, `title-asc`, `title-desc`, `chapter`), and pagination (`LIMIT`/`OFFSET`).
  - Returns flat `BookmarkCardDto[]` containing all display fields (`mangaTitle`, `chapterName`, `page`, `pagePath`, `fraction`, `mangaBookmark`, `timestamp`, `localPath`).
  - Eliminates the desktop N+1 loop where `getBookmarkedMangaIds()` fetched all IDs and `getManga()` was called sequentially for every single manga in the library.
- **Bookmark Small Thumbnail Preview (`src-tauri/src/protocol.rs` & `src/Bookmarks.tsx`)**:
  - Added `"thumb"` transform variant in `protocol.rs`: generates and caches a dedicated 320×420 WebP thumbnail via `generate_image_variant_direct`.
  - `src/Bookmarks.tsx`: `Thumbnail` uses `transform: 'thumb'` on desktop, serving the small cached preview instead of decoding full-resolution page images.
- **Metadata-Only Import Preview Mismatch Check (`src/ImportDialogs.tsx`)**:
  - Compares `candidate.size` and `candidate.modified` directly against `page.size` and `page.modified` from the discovery scan.
  - Eliminates calling `candidate.getFile()` (which transferred up to 24 complete image files per target simply to inspect size/mtime).
- **Blob-Last Pattern (`src/PageImage.tsx`)**:
  - Requests native image variant URL first on desktop; only falls back to reading original image bytes via `fileFor` if the native variant request fails.

---

## 3. Command Reference & Acceptance Benchmarks

| Command                                                                     | Target             | Purpose / Invariant                                                                            |
| --------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------- |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`                 | Backend            | Enforces standard Rust formatting.                                                             |
| `cargo test --manifest-path src-tauri/Cargo.toml --locked`                  | Backend            | Runs 65 Rust unit tests across DB, FS, protocol, image, config, indexing, and validation.      |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings` | Backend            | Zero Clippy warnings across whole crate.                                                       |
| `npm run test:validation`                                                   | Frontend / Unit    | Runs 121 Playwright unit & acceptance tests across storage, validation, lifecycle, and images. |
| `npm run typecheck`                                                         | Frontend           | Runs `tsc -b && tsc -p tsconfig.desktop.json --noEmit` with zero errors across platforms.      |
| `npm run build`                                                             | Web Production     | Builds production client with PWA service worker.                                              |
| `npm run build:desktop`                                                     | Desktop Production | Compiles desktop bundle with tree-shaken desktop modules (`dist/assets/index-*.js` ~98 kB).    |
| `npm run format:check`                                                      | Repository         | Enforces Prettier code formatting rules.                                                       |
