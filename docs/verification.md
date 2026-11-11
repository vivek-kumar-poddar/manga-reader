# Verification & Technical Reference

Repository: `manga-reader` (Tauri v2 Desktop + PWA/Web).

Verification battery:

- Rust tests: `cargo test --manifest-path src-tauri/Cargo.toml` (48/48 PASS)
- Rust clippy: `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` (0 warnings)
- TypeScript tests: `npm run test:validation` (103/103 PASS)
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

---

## 3. Command Reference & Acceptance Benchmarks

| Command                                                            | Target             | Purpose / Invariant                                                                         |
| ------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------- |
| `cargo test --manifest-path src-tauri/Cargo.toml`                  | Backend            | Runs 48 Rust unit tests across DB, FS, protocol, image, config, and validation.             |
| `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` | Backend            | Zero Clippy warnings across whole crate.                                                    |
| `npm run test:validation`                                          | Frontend / Unit    | Runs 103 Playwright unit tests across storage, validation, sorting, and lifecycle.          |
| `npm run typecheck`                                                | Frontend           | Runs `tsc -b` with zero TypeScript compiler errors.                                         |
| `npm run build`                                                    | Web Production     | Builds production client with PWA service worker.                                           |
| `npm run build:desktop`                                            | Desktop Production | Compiles desktop bundle with tree-shaken desktop modules (`dist/assets/index-*.js` ~96 kB). |
| `npx prettier --check <paths>`                                     | Repository         | Enforces code formatting rules.                                                             |
