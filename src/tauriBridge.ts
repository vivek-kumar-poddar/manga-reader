import { invoke, Channel, convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  Manga,
  Summary,
  Position,
  Settings,
  Page,
  PageOffset,
  GeometryOptions,
  WindowRange,
} from './model';
import { limits, assertImageDimensions, withinTime } from './limits';

export interface FolderEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  modified: number;
  width?: number | null;
  height?: number | null;
}

export interface DiscoveredPage {
  name: string;
  relativePath: string;
  absolutePath: string;
  width?: number | null;
  height?: number | null;
  size: number;
  modified: number;
}

export interface DiscoveredChapter {
  name: string;
  pages: DiscoveredPage[];
}

export interface DiscoveredTitle {
  title: string;
  rootPath: string;
  chapters: DiscoveredChapter[];
  totalImages: number;
  coverPath?: string;
}

export interface LibraryDiscovery {
  rootPath: string;
  titles: DiscoveredTitle[];
  totalFiles: number;
}

export interface WindowPreferences {
  closeToTray: boolean;
  theme?: string | null;
  minimizeToTray?: boolean;
  startMaximized?: boolean;
  highDpiScaling?: boolean;
}

export interface AppConfig {
  lastOpenedRoots: string[];
  windowPreferences: WindowPreferences;
  customPreferences: Record<string, unknown>;
}

export interface ScanProgress {
  scanId?: string;
  done: number;
  total: number;
}

export interface ListFolderOptions {
  scanId?: string;
  signal?: AbortSignal;
  onProgress?: (progress: ScanProgress) => void;
}

export interface IndexScanProgress {
  phase: string;
  done: number;
  total: number;
  title: string;
}

export interface IndexTitleDto {
  id: string;
  title: string;
  slug: string;
  localPath: string;
  lastChapter: number;
  addedAt: number;
  updatedAt: number;
  revision: number;
  sort: string;
  chapterCount?: number;
  pageCount?: number;
  hasPendingDimensions?: boolean;
  chapters: Array<{
    name: string;
    read: boolean;
    position?: Position;
    bookmarks: Position[];
    pages: Array<{
      name: string;
      path: string;
      width: number;
      height: number;
      size?: number;
      modified?: number;
      dimensionsPending: boolean;
    }>;
  }>;
  coverPath?: string;
  issues: Array<{ path: string; reason: string }>;
  reused: number;
}

export interface PrepareChapterDto {
  pages: Array<{
    name: string;
    path: string;
    width: number;
    height: number;
    size?: number;
    modified?: number;
    dimensionsPending: boolean;
  }>;
  updated: boolean;
  updatedAt: number;
  revision: number;
  issues: Array<{ path: string; reason: string }>;
}

export interface IndexTitleOptions {
  sort?: 'natural' | 'name' | 'reverse';
  previous?: Manga;
  targetId?: string;
  warmChapters?: number;
  jobId?: string;
  title?: string;
  signal?: AbortSignal;
}

export interface BookmarkCardsQuery {
  tab?: 'all' | 'manga' | 'individual' | string;
  sort?: 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'chapter' | string;
  limit?: number;
  offset?: number;
}

export interface BookmarkCardDto {
  mangaId: string;
  mangaTitle: string;
  mangaSlug: string;
  localPath?: string;
  updatedAt: number;
  chapterIdx: number;
  chapterName: string;
  page: number;
  pagePath?: string;
  fraction: number;
  mangaBookmark: boolean;
  timestamp: number;
}

export interface BookmarkCardsResult {
  cards: BookmarkCardDto[];
  total: number;
}

export interface CachedImageResult {
  path: string;
  url: string;
  isPlaceholder?: boolean;
  status?: string;
  error?: string;
}

export interface PageImageResourceOptions {
  mangaId: string;
  pagePath: string;
  version?: string | number;
  transform?: 'full' | 'raw' | 'low' | 'preview' | 'thumb' | string;
  localPath?: string;
}

export function getPageImageUrl(options: PageImageResourceOptions): string {
  const { mangaId, pagePath, version = 1, transform = 'full', localPath } = options;
  const encodedMangaId = encodeURIComponent(mangaId);
  const encodedVersion = encodeURIComponent(String(version));
  const encodedTransform = encodeURIComponent(transform);
  const normalizedPath = pagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalizedPath.split('/').filter(Boolean).map(encodeURIComponent);
  const encodedPagePath = segments.join('/');

  let url = `http://mangaimg.localhost/page/${encodedMangaId}/${encodedVersion}/${encodedTransform}/${encodedPagePath}`;
  if (localPath) {
    url += `?root=${encodeURIComponent(localPath)}`;
  }
  return url;
}

export function getCoverImageUrl(
  mangaId: string,
  version?: string | number,
  size?: number,
): string {
  const encodedMangaId = encodeURIComponent(mangaId);
  const ver =
    version !== undefined && version !== null ? `/${encodeURIComponent(String(version))}` : '';
  const query = size ? `?size=${size}` : '';
  return `http://mangaimg.localhost/cover/${encodedMangaId}${ver}${query}`;
}

export interface StorageStats {
  db_bytes: number;
  cache_bytes: number;
  total_bytes: number;
}

export interface FsErrorPayload {
  code: 'NotFound' | 'TooLarge' | 'ForbiddenExt' | 'PathNotAllowed' | 'Cancelled' | 'Io';
  message?: string;
}

export interface DbErrorPayload {
  code:
  | 'Sqlite'
  | 'Migration'
  | 'Lock'
  | 'Validation'
  | 'NotFound'
  | 'Conflict'
  | 'Task'
  | 'Io'
  | 'Serialization';
  message?: string;
}

export type TauriErrorPayload =
  FsErrorPayload | DbErrorPayload | { code: 'Unknown'; message: string };

export function parseFsError(err: unknown): FsErrorPayload | null {
  if (err && typeof err === 'object') {
    if ('code' in err && typeof (err as any).code === 'string') {
      return err as FsErrorPayload;
    }
  }
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        return parsed as FsErrorPayload;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

export function parseTauriError(err: unknown): TauriErrorPayload {
  const fsErr = parseFsError(err);
  if (fsErr) return fsErr;
  if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') {
    return err as DbErrorPayload;
  }
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        return parsed as DbErrorPayload;
      }
    } catch {
      // not JSON
    }
    return { code: 'Unknown', message: err };
  }
  if (err instanceof Error) {
    return { code: 'Unknown', message: err.message };
  }
  return { code: 'Unknown', message: String(err) };
}

export interface TauriCommands {
  select_folder: { args: Record<string, never>; return: string | null };
  list_folder: { args: { folderPath: string; scanId?: string }; return: FolderEntry[] };
  read_file: { args: { absolutePath: string }; return: ArrayBuffer | number[] | Uint8Array };
  get_image_dimensions: { args: { absolutePath: string }; return: [number, number] | null };
  get_header_dimensions: {
    args: Uint8Array | ArrayBuffer | { cacheKey?: string; bytes: number[] };
    return: { width: number; height: number } | null;
  };

  is_image_file: { args: { name: string; mimeType: string }; return: boolean };
  decode_image_dimensions: {
    args: Uint8Array | ArrayBuffer | { bytes: number[] };
    return: { width: number; height: number } | null;
  };
  generate_thumbnail_from_bytes: {
    args: Uint8Array | ArrayBuffer | { bytes: number[]; quality?: number };
    return: ArrayBuffer | Uint8Array;
  };
  downscale_image_bytes: {
    args: Uint8Array | ArrayBuffer | { bytes: number[]; targetWidth: number; targetHeight: number; quality?: number };
    return: ArrayBuffer | Uint8Array;
  };

  clear_dimension_cache: { args: Record<string, never>; return: void };
  cancel_scan: { args: { scanId: string }; return: boolean };
  natural_sort_paths: { args: { paths: string[] }; return: string[] };
  resolve_manga_path: {
    args: { mangaId?: string; relativePath: string; localPath?: string };
    return: string;
  };
  check_access: {
    args: { mangaId?: string; localPath?: string };
    return: boolean;
  };
  revoke_root: {
    args: { rootPath: string };
    return: boolean;
  };
  get_authorized_roots: {
    args: Record<string, never>;
    return: string[];
  };
  discover_library: {
    args: { folderPath: string; scanId?: string };
    return: LibraryDiscovery | null;
  };
  is_same_path: { args: { pathA: string; pathB: string }; return: boolean };
  set_progress_bar: { args: { progress: number }; return: void };
  show_main_window: { args: Record<string, never>; return: void };
  save_thumbnail: { args: Uint8Array | ArrayBuffer; return: void };
  read_thumbnail: { args: { id: string }; return: ArrayBuffer | number[] | Uint8Array };
  get_thumbnail_url: { args: { id: string; size?: number | null }; return: string | null };
  delete_thumbnail: { args: { id: string }; return: void };
  clear_thumbnails: { args: Record<string, never>; return: void };
  generate_thumbnail: {
    args: { filePath: string; id: string; size?: number | null };
    return: CachedImageResult;
  };
  generate_image_variant: {
    args: { filePath: string; maxWidth: number; maxHeight: number };
    return: CachedImageResult;
  };
  get_app_config: { args: Record<string, never>; return: AppConfig };
  save_app_config: { args: { config: AppConfig }; return: void };
  set_window_preferences: { args: { preferences: WindowPreferences }; return: void };
  set_app_preference: { args: { key: string; value: unknown }; return: void };
  get_app_preference: { args: { key: string }; return: unknown };
  record_opened_root: { args: { rootPath: string }; return: string[] };
  get_last_opened_roots: { args: Record<string, never>; return: string[] };
  is_library_migrated: { args: Record<string, never>; return: boolean };
  import_legacy_library: { args: { payload: unknown }; return: boolean };
  sqlite_list_library: { args: Record<string, never>; return: Summary[] };
  sqlite_get_manga: { args: { id: string }; return: Manga | undefined };
  sqlite_save_manga: { args: { manga: Manga }; return: void };
  sqlite_save_progress: {
    args: {
      mangaId: string;
      chapterIndex: number;
      position: Position;
      read: boolean;
      bookmarks?: Position[];
      updateLast: boolean;
      expectedRevision?: number;
      expectedUpdatedAt?: number;
    };
    return: 'saved' | 'stale' | 'missing';
  };
  sqlite_add_bookmark: {
    args: { mangaId: string; chapterName: string; position: Position };
    return: Position[];
  };
  sqlite_remove_bookmark: {
    args: { mangaId: string; chapterName: string; position: Position };
    return: Position[];
  };
  sqlite_get_bookmarked_manga_ids: {
    args: Record<string, never>;
    return: { allBookmarkedIds: string[]; mangaBookmarkedIds: string[] };
  };
  get_bookmark_cards: {
    args: { query: BookmarkCardsQuery };
    return: BookmarkCardsResult;
  };
  sqlite_delete_manga: { args: { id: string }; return: void };
  sqlite_clear_library: { args: Record<string, never>; return: void };
  sqlite_reset_progress: { args: Record<string, never>; return: void };
  sqlite_get_settings: { args: Record<string, never>; return: Settings | null };
  sqlite_save_settings: { args: { settings: Settings }; return: void };
  validate_library_backup: { args: { backupJson: string }; return: unknown };

  validate_relative_path_cmd: { args: { path: string }; return: string };
  matching_position_cmd: {
    args: { saved?: Position; pages?: Page[]; oldPages?: Page[] };
    return: Position | null;
  };
  parse_position_cmd: {
    args: { value: Position; pages?: Page[]; oldPages?: Page[] };
    return: Position;
  };
  parse_manga_cmd: {
    args: { value: unknown; preserveHardwarePointers?: boolean };
    return: Manga;
  };
  parse_summary_cmd: { args: { value: unknown }; return: Summary | null };
  parse_settings_cmd: { args: { value: unknown }; return: Settings };

  export_library_backup: { args: Record<string, never>; return: string };
  restore_library_backup: { args: { backupJson: string }; return: void };
  index_title: {
    args: {
      root: string;
      options?: {
        sort?: string;
        previous?: any;
        targetId?: string;
        warmChapters?: number;
        jobId?: string;
        title?: string;
      };
      onProgress?: unknown;
    };
    return: IndexTitleDto;
  };
  prepare_chapter: {
    args: {
      mangaId: string;
      chapterIndex: number;
      jobId?: string;
      onProgress?: unknown;
    };
    return: PrepareChapterDto;
  };

  preview_chapters: {
    args: { paths: string[] };
    return: Array<{ name: string; pageCount: number }>;
  };
  schedule_background: { args: { mangaId: string }; return: boolean };
  stop_background: { args: { mangaId: string }; return: void };
  stop_all_background: { args: Record<string, never>; return: void };
  resume_background: { args: Record<string, never>; return: number };

  get_storage_stats: { args: Record<string, never>; return: StorageStats };
  save_file_dialog: { args: { defaultName: string; content: string }; return: boolean };
  record_diagnostic: {
    args: { entry: DiagnosticInputPayload };
    return: DiagnosticRecordPayload | null;
  };
  get_diagnostics: { args: Record<string, never>; return: DiagnosticRecordPayload[] };
  clear_diagnostics: { args: Record<string, never>; return: void };
  sanitize_diagnostic_identifier: {
    args: { raw?: string };
    return: string | null;
  };
  compute_offsets: {
    args: {
      pages: Array<{ width: number; height: number }>;
      options: GeometryOptions;
      measuredHeights?: Record<number, number>;
    };
    return: PageOffset[];
  };
  get_window_range: {
    args: {
      offsets: PageOffset[];
      scrollY: number;
      viewportHeight: number;
      bufferScreenCount?: number;
      threshold?: number;
    };
    return: WindowRange;
  };
}

export interface DiagnosticInputPayload {
  operation: 'import' | 'cover' | 'background' | 'storage' | 'update' | 'reader';
  level: 'info' | 'warn' | 'error';
  message: string;
  code?: string;
  safeIdentifier?: string;
  retryable?: boolean;
  durationMs?: number;
}

export interface DiagnosticRecordPayload extends DiagnosticInputPayload {
  id: string;
  timestamp: number;
}

export async function invokeCommand<K extends keyof TauriCommands>(
  cmd: K,
  args?: TauriCommands[K]['args'],
  options?: any,
): Promise<TauriCommands[K]['return']> {
  try {
    return await invoke<TauriCommands[K]['return']>(cmd, args as any, options);
  } catch (err) {
    const parsed = parseTauriError(err);
    console.error(`[invokeCommand] ${cmd} failed:`, parsed);
    throw parsed;
  }
}

export interface DesktopAPI {
  readonly isDesktop: boolean;
  readonly isTauri: boolean;
  selectFolder(): Promise<string | null>;
  listFolder(folderPath: string, options?: ListFolderOptions): Promise<FolderEntry[]>;
  discoverLibrary?(
    folderPath: string,
    options?: ListFolderOptions,
  ): Promise<LibraryDiscovery | null>;
  naturalSortPaths?(paths: string[]): Promise<string[]>;
  resolvePath?(mangaId?: string, relativePath?: string, localPath?: string): Promise<string>;
  checkAccess?(mangaId?: string, localPath?: string): Promise<boolean>;
  revokeRoot?(rootPath: string): Promise<boolean>;
  getAuthorizedRoots?(): Promise<string[]>;
  isSamePath?(pathA: string, pathB: string): Promise<boolean>;
  cancelScan?(scanId: string): Promise<boolean>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
  getImageDimensions?(absolutePath: string): Promise<{ width: number; height: number } | null>;
  getHeaderDimensions?(file: File): Promise<{ width: number; height: number } | undefined>;

  decodeImageDimensions?(
    file: File,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number } | undefined>;
  generateThumbnailFromBytes?(
    file: File,
    quality?: number,
    signal?: AbortSignal,
  ): Promise<Blob | undefined>;
  downscaleImageBytes?(
    blob: Blob,
    targetWidth: number,
    targetHeight: number,
    signal?: AbortSignal,
  ): Promise<Blob | null>;

  clearDimensionCache?(): Promise<void>;
  setProgressBar(progress: number): void;
  showMainWindow?(): Promise<boolean>;
  saveThumbnail?(id: string, buffer: ArrayBuffer | Uint8Array): Promise<boolean>;
  getThumbnail?(id: string): Promise<ArrayBuffer | null>;
  getThumbnailUrl?(id: string, size?: number): Promise<string | null>;
  deleteThumbnail?(id: string): Promise<void>;
  clearThumbnails?(): Promise<void>;
  generateThumbnail?(
    filePath: string,
    id: string,
    size?: number,
  ): Promise<CachedImageResult | null>;
  generateImageVariant?(
    filePath: string,
    maxWidth: number,
    maxHeight: number,
  ): Promise<CachedImageResult | null>;
  getAppConfig?(): Promise<AppConfig | null>;
  saveAppConfig?(config: AppConfig): Promise<boolean>;
  setWindowPreferences?(preferences: WindowPreferences): Promise<boolean>;
  setAppPreference?(key: string, value: unknown): Promise<boolean>;
  getAppPreference?(key: string): Promise<unknown>;
  recordOpenedRoot?(rootPath: string): Promise<string[]>;
  getLastOpenedRoots?(): Promise<string[]>;
  isLibraryMigrated?(): Promise<boolean>;
  importLegacyLibrary?(payload: unknown): Promise<boolean>;
  sqliteListLibrary?(): Promise<Summary[]>;
  sqliteGetManga?(id: string): Promise<Manga | undefined>;
  sqliteSaveManga?(manga: Manga): Promise<void>;
  sqliteSaveProgress?(params: {
    mangaId: string;
    chapterIndex: number;
    position: Position;
    read: boolean;
    bookmarks?: Position[];
    updateLast: boolean;
    expectedRevision?: number;
    expectedUpdatedAt?: number;
  }): Promise<'saved' | 'stale' | 'missing'>;
  sqliteAddBookmark?(params: {
    mangaId: string;
    chapterName: string;
    position: Position;
  }): Promise<Position[]>;
  sqliteRemoveBookmark?(params: {
    mangaId: string;
    chapterName: string;
    position: Position;
  }): Promise<Position[]>;
  sqliteGetBookmarkedMangaIds?(): Promise<{
    allBookmarkedIds: string[];
    mangaBookmarkedIds: string[];
  }>;
  getBookmarkCards?(query: BookmarkCardsQuery): Promise<BookmarkCardsResult>;
  sqliteDeleteManga?(id: string): Promise<void>;
  sqliteClearLibrary?(): Promise<void>;
  sqliteResetProgress?(): Promise<void>;
  sqliteGetSettings?(): Promise<Settings | undefined>;
  sqliteSaveSettings?(settings: Settings): Promise<Settings>;
  exportBackup?(): Promise<string>;
  restoreBackup?(backupJson: string): Promise<Settings>;
  validateBackup?(backupJson: string): Promise<unknown>;
  indexTitle?(
    root: string,
    options?: IndexTitleOptions,
    onProgress?: (progress: IndexScanProgress) => void,
  ): Promise<IndexTitleDto>;
  prepareChapter?(
    mangaId: string,
    chapterIndex: number,
    onProgress?: (progress: IndexScanProgress) => void,
    signal?: AbortSignal,
  ): Promise<PrepareChapterDto>;

  previewChapters?(paths: string[]): Promise<Array<{ name: string; pageCount: number }>>;
  scheduleBackground?(mangaId: string): Promise<boolean>;
  stopBackground?(mangaId: string): Promise<void>;
  stopAllBackground?(): Promise<void>;
  resumeBackground?(): Promise<number>;

  convertFileSrc?(filePath: string, protocol?: string): string;
  getPageImageUrl?(options: PageImageResourceOptions): string;
  getCoverImageUrl?(mangaId: string, version?: string | number, size?: number): string;
  onDragDrop?(callback: (paths: string[]) => void): () => void;
  checkForUpdate?(): Promise<DesktopUpdateInfo | null>;
  installUpdate?(): Promise<void>;
  getStorageStats?(): Promise<StorageStats>;
  saveFileDialog?(defaultName: string, content: string): Promise<boolean>;
  recordDiagnostic?(entry: DiagnosticInputPayload): Promise<DiagnosticRecordPayload | null>;
  getDiagnostics?(): Promise<DiagnosticRecordPayload[]>;
  clearDiagnostics?(): Promise<void>;
  sanitizeDiagnosticIdentifier?(raw?: string): Promise<string | undefined>;
  computeOffsets(
    pages: Array<Pick<Page, 'width' | 'height'>>,
    options: GeometryOptions,
    measuredHeights?: Record<number, number>,
  ): Promise<PageOffset[]>;
  getWindowRange(
    offsets: PageOffset[],
    scrollY: number,
    viewportHeight: number,
    bufferScreenCount?: number,
    threshold?: number,
  ): Promise<WindowRange>;
}

export interface DesktopUpdateInfo {
  version: string;
  currentVersion?: string;
  body?: string;
  date?: string;
}

// Detect Tauri runtime presence
export const isTauri =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));

export const isDesktop =
  (typeof __DESKTOP_BUILD__ !== 'undefined' && __DESKTOP_BUILD__) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TARGET === 'desktop') ||
  isTauri;

export class TauriDesktopBridge implements DesktopAPI {
  readonly isDesktop = true;
  readonly isTauri = true;

  async selectFolder(): Promise<string | null> {
    try {
      const selected = await invokeCommand('select_folder');
      return selected ?? null;
    } catch (err) {
      console.error('Tauri selectFolder failed:', parseFsError(err) ?? err);
      return null;
    }
  }

  async listFolder(folderPath: string, options?: ListFolderOptions): Promise<FolderEntry[]> {
    let unlisten: (() => void) | undefined;
    const scanId =
      options?.scanId ??
      (options?.signal || options?.onProgress
        ? `scan-${Math.random().toString(36).slice(2)}`
        : undefined);

    let abortHandler: (() => void) | undefined;
    if (options?.signal && scanId) {
      if (options.signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      abortHandler = () => {
        void this.cancelScan(scanId);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      if (options?.onProgress && isTauri) {
        try {
          unlisten = await listen<ScanProgress>('scan-progress', (event) => {
            if (!scanId || event.payload.scanId === scanId) {
              options.onProgress?.(event.payload);
            }
          });
        } catch (err) {
          console.warn('Tauri scan-progress listen failed:', err);
        }
      }

      return await invokeCommand('list_folder', { folderPath, scanId });
    } catch (err) {
      const fsErr = parseFsError(err);
      if (fsErr?.code === 'Cancelled') {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      console.error('Tauri listFolder failed:', fsErr ?? err);
      return [];
    } finally {
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      unlisten?.();
    }
  }

  async discoverLibrary(
    folderPath: string,
    options?: ListFolderOptions,
  ): Promise<LibraryDiscovery | null> {
    let unlisten: (() => void) | undefined;
    const scanId =
      options?.scanId ??
      (options?.signal || options?.onProgress
        ? `scan-${Math.random().toString(36).slice(2)}`
        : undefined);

    let abortHandler: (() => void) | undefined;
    if (options?.signal && scanId) {
      if (options.signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      abortHandler = () => {
        void this.cancelScan(scanId);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      if (options?.onProgress && isTauri) {
        try {
          unlisten = await listen<ScanProgress>('scan-progress', (event) => {
            if (!scanId || event.payload.scanId === scanId) {
              options.onProgress?.(event.payload);
            }
          });
        } catch (err) {
          console.warn('Tauri scan-progress listen failed:', err);
        }
      }

      return await invokeCommand('discover_library', { folderPath, scanId });
    } catch (err) {
      const fsErr = parseFsError(err);
      if (fsErr?.code === 'Cancelled') {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      console.error('Tauri discoverLibrary failed:', fsErr ?? err);
      return null;
    } finally {
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
      unlisten?.();
    }
  }

  async naturalSortPaths(paths: string[]): Promise<string[]> {
    try {
      return await invokeCommand('natural_sort_paths', { paths });
    } catch (err) {
      console.warn('Tauri naturalSortPaths failed:', parseFsError(err) ?? err);
      return paths;
    }
  }

  async resolvePath(mangaId?: string, relativePath = '', localPath?: string): Promise<string> {
    return await invokeCommand('resolve_manga_path', { mangaId, relativePath, localPath });
  }

  async checkAccess(mangaId?: string, localPath?: string): Promise<boolean> {
    try {
      return await invokeCommand('check_access', { mangaId, localPath });
    } catch (err) {
      console.warn('Tauri checkAccess failed:', parseFsError(err) ?? err);
      return false;
    }
  }

  async revokeRoot(rootPath: string): Promise<boolean> {
    try {
      return await invokeCommand('revoke_root', { rootPath });
    } catch (err) {
      console.warn('Tauri revokeRoot failed:', parseFsError(err) ?? err);
      return false;
    }
  }

  async getAuthorizedRoots(): Promise<string[]> {
    try {
      return await invokeCommand('get_authorized_roots');
    } catch (err) {
      console.warn('Tauri getAuthorizedRoots failed:', parseFsError(err) ?? err);
      return [];
    }
  }

  async cancelScan(scanId: string): Promise<boolean> {
    try {
      return await invokeCommand('cancel_scan', { scanId });
    } catch (err) {
      console.warn('Tauri cancelScan failed for', scanId, err);
      return false;
    }
  }

  async readFile(absolutePath: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invokeCommand('read_file', {
        absolutePath,
      });
      if (response instanceof ArrayBuffer) {
        return response;
      }
      if (response instanceof Uint8Array) {
        return response.buffer.slice(
          response.byteOffset,
          response.byteOffset + response.byteLength,
        ) as ArrayBuffer;
      }
      return null;
    } catch (err) {
      console.error('Tauri readFile failed for', absolutePath, parseFsError(err) ?? err);
      return null;
    }
  }

  async getImageDimensions(
    absolutePath: string,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const dim = await invokeCommand('get_image_dimensions', {
        absolutePath,
      });
      if (dim && Array.isArray(dim) && dim.length === 2) {
        return { width: dim[0], height: dim[1] };
      }
      return null;
    } catch (err) {
      console.warn('Tauri getImageDimensions failed for', absolutePath, parseFsError(err) ?? err);
      return null;
    }
  }

  async getHeaderDimensions(file: File): Promise<{ width: number; height: number } | undefined> {
    try {
      const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
      const buffer = await withinTime(
        file.slice(0, limits.headerBytes).arrayBuffer(),
        limits.ioTimeoutMs,
        'Reading image header',
      );
      const res = await invoke<{ width: number; height: number } | null>(
        'get_header_dimensions',
        new Uint8Array(buffer),
        {
          headers: {
            'x-cache-key': encodeURIComponent(cacheKey),
          },
        },
      );
      if (res && res.width > 0 && res.height > 0) {
        assertImageDimensions(res.width, res.height);
        return res;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  async decodeImageDimensions(
    file: File,
    signal?: AbortSignal,
  ): Promise<{ width: number; height: number } | undefined> {
    signal?.throwIfAborted();
    const buffer = await withinTime(
      file.arrayBuffer(),
      limits.ioTimeoutMs,
      'Reading image file',
      signal,
    );
    signal?.throwIfAborted();
    const res = await withinTime(
      invoke<{ width: number; height: number } | null>(
        'decode_image_dimensions',
        new Uint8Array(buffer),
      ),
      limits.imageTimeoutMs,
      'Decoding image dimensions',
      signal,
    );
    if (res && res.width > 0 && res.height > 0) {
      assertImageDimensions(res.width, res.height);
      return res;
    }
    return undefined;
  }

  async generateThumbnailFromBytes(
    file: File,
    quality = 0.65,
    signal?: AbortSignal,
  ): Promise<Blob | undefined> {
    signal?.throwIfAborted();
    const buffer = await withinTime(
      file.arrayBuffer(),
      limits.ioTimeoutMs,
      'Reading cover file',
      signal,
    );
    signal?.throwIfAborted();
    const res = await withinTime(
      invoke<ArrayBuffer | Uint8Array>(
        'generate_thumbnail_from_bytes',
        new Uint8Array(buffer),
        {
          headers: {
            'x-quality': String(quality),
          },
        },
      ),
      limits.coverTimeoutMs,
      'Encoding cover',
      signal,
    );
    const ab =
      res instanceof ArrayBuffer
        ? res
        : res instanceof Uint8Array
          ? (res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength) as ArrayBuffer)
          : null;
    if (!ab || ab.byteLength === 0) return undefined;
    return new Blob([ab], { type: 'image/webp' });
  }

  async downscaleImageBytes(
    blob: Blob,
    targetWidth: number,
    targetHeight: number,
    signal?: AbortSignal,
  ): Promise<Blob | null> {
    signal?.throwIfAborted();
    const buffer = await withinTime(
      blob.arrayBuffer(),
      limits.ioTimeoutMs,
      'Reading image',
      signal,
    );
    signal?.throwIfAborted();
    const res = await withinTime(
      invoke<ArrayBuffer | Uint8Array>('downscale_image_bytes', new Uint8Array(buffer), {
        headers: {
          'x-target-width': String(Math.max(1, Math.round(targetWidth))),
          'x-target-height': String(Math.max(1, Math.round(targetHeight))),
          'x-quality': '0.8',
        },
      }),
      limits.imageTimeoutMs,
      'Resizing image',
      signal,
    );
    const ab =
      res instanceof ArrayBuffer
        ? res
        : res instanceof Uint8Array
          ? (res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength) as ArrayBuffer)
          : null;
    if (!ab || ab.byteLength === 0) return null;
    return new Blob([ab], { type: 'image/webp' });
  }

  async clearDimensionCache(): Promise<void> {
    try {
      await invokeCommand('clear_dimension_cache');
    } catch { }
  }

  setProgressBar(progress: number): void {
    try {
      void invokeCommand('set_progress_bar', { progress }).catch((err) => {
        console.warn('Tauri setProgressBar failed:', err);
      });
    } catch (err) {
      console.warn('Tauri setProgressBar failed:', err);
    }
  }

  async showMainWindow(): Promise<boolean> {
    try {
      await invokeCommand('show_main_window');
      return true;
    } catch (err) {
      console.warn('Tauri showMainWindow failed:', err);
      return false;
    }
  }

  async saveThumbnail(id: string, buffer: ArrayBuffer | Uint8Array): Promise<boolean> {
    try {
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      await invoke('save_thumbnail', bytes, {
        headers: {
          'x-id': encodeURIComponent(id),
        },
      });
      return true;
    } catch (err) {
      console.warn('Tauri saveThumbnail failed for', id, parseFsError(err) ?? err);
      return false;
    }
  }

  async getThumbnailUrl(id: string, size?: number): Promise<string | null> {
    try {
      return await invokeCommand('get_thumbnail_url', { id, size: size ?? null });
    } catch (err) {
      console.warn('Tauri getThumbnailUrl failed for', id, parseFsError(err) ?? err);
      return null;
    }
  }

  async generateThumbnail(
    filePath: string,
    id: string,
    size?: number,
  ): Promise<CachedImageResult | null> {
    try {
      return await invokeCommand('generate_thumbnail', {
        filePath,
        id,
        size: size ?? null,
      });
    } catch (err) {
      console.warn('Tauri generateThumbnail failed for', filePath, id, parseFsError(err) ?? err);
      return null;
    }
  }

  async generateImageVariant(
    filePath: string,
    maxWidth: number,
    maxHeight: number,
  ): Promise<CachedImageResult | null> {
    try {
      return await invokeCommand('generate_image_variant', {
        filePath,
        maxWidth,
        maxHeight,
      });
    } catch (err) {
      console.warn('Tauri generateImageVariant failed for', filePath, parseFsError(err) ?? err);
      return null;
    }
  }

  async getThumbnail(id: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invokeCommand('read_thumbnail', { id });
      if (response instanceof ArrayBuffer) {
        return response.byteLength > 0 ? response : null;
      }
      if (response instanceof Uint8Array) {
        return response.byteLength > 0
          ? (response.buffer.slice(
            response.byteOffset,
            response.byteOffset + response.byteLength,
          ) as ArrayBuffer)
          : null;
      }
      return null;
    } catch (err) {
      console.warn('Tauri getThumbnail failed for', id, parseFsError(err) ?? err);
      return null;
    }
  }

  async deleteThumbnail(id: string): Promise<void> {
    try {
      await invokeCommand('delete_thumbnail', { id });
    } catch (err) {
      console.warn('Tauri deleteThumbnail failed for', id, parseFsError(err) ?? err);
    }
  }

  async clearThumbnails(): Promise<void> {
    try {
      await invokeCommand('clear_thumbnails');
    } catch (err) {
      console.warn('Tauri clearThumbnails failed:', parseFsError(err) ?? err);
    }
  }

  async getAppConfig(): Promise<AppConfig | null> {
    try {
      return await invokeCommand('get_app_config');
    } catch (err) {
      console.warn('Tauri getAppConfig failed:', err);
      return null;
    }
  }

  async saveAppConfig(config: AppConfig): Promise<boolean> {
    try {
      await invokeCommand('save_app_config', { config });
      return true;
    } catch (err) {
      console.warn('Tauri saveAppConfig failed:', err);
      return false;
    }
  }

  async setWindowPreferences(preferences: WindowPreferences): Promise<boolean> {
    try {
      await invokeCommand('set_window_preferences', { preferences });
      return true;
    } catch (err) {
      console.warn('Tauri setWindowPreferences failed:', err);
      return false;
    }
  }

  async setAppPreference(key: string, value: unknown): Promise<boolean> {
    try {
      await invokeCommand('set_app_preference', { key, value });
      return true;
    } catch (err) {
      console.warn('Tauri setAppPreference failed:', key, err);
      return false;
    }
  }

  async getAppPreference(key: string): Promise<unknown> {
    try {
      return await invokeCommand('get_app_preference', { key });
    } catch (err) {
      console.warn('Tauri getAppPreference failed:', key, err);
      return null;
    }
  }

  async recordOpenedRoot(rootPath: string): Promise<string[]> {
    try {
      return await invokeCommand('record_opened_root', { rootPath });
    } catch (err) {
      console.warn('Tauri recordOpenedRoot failed for', rootPath, err);
      return [];
    }
  }

  async getLastOpenedRoots(): Promise<string[]> {
    try {
      return await invokeCommand('get_last_opened_roots');
    } catch (err) {
      console.warn('Tauri getLastOpenedRoots failed:', err);
      return [];
    }
  }

  async isLibraryMigrated(): Promise<boolean> {
    try {
      return await invokeCommand('is_library_migrated');
    } catch (err) {
      console.warn('Tauri isLibraryMigrated failed:', err);
      return false;
    }
  }

  async importLegacyLibrary(payload: unknown): Promise<boolean> {
    try {
      return await invokeCommand('import_legacy_library', { payload });
    } catch (err) {
      console.warn('Tauri importLegacyLibrary failed:', err);
      return false;
    }
  }

  async sqliteListLibrary(): Promise<Summary[]> {
    try {
      const records = await invokeCommand('sqlite_list_library');
      return Array.isArray(records) ? records : [];
    } catch (err) {
      console.warn('Tauri sqliteListLibrary failed:', err);
      return [];
    }
  }

  async sqliteGetManga(id: string): Promise<Manga | undefined> {
    try {
      const record = await invokeCommand('sqlite_get_manga', { id });
      return record ?? undefined;
    } catch (err) {
      console.warn('Tauri sqliteGetManga failed for', id, err);
      return undefined;
    }
  }

  async sqliteSaveManga(manga: Manga): Promise<void> {
    await invokeCommand('sqlite_save_manga', { manga });
  }

  async sqliteSaveProgress(params: {
    mangaId: string;
    chapterIndex: number;
    position: Position;
    read: boolean;
    bookmarks?: Position[];
    updateLast: boolean;
    expectedRevision?: number;
    expectedUpdatedAt?: number;
  }): Promise<'saved' | 'stale' | 'missing'> {
    const res = await invokeCommand('sqlite_save_progress', {
      mangaId: params.mangaId,
      chapterIndex: params.chapterIndex,
      position: params.position,
      read: params.read,
      bookmarks: params.bookmarks,
      updateLast: params.updateLast,
      expectedRevision: params.expectedRevision,
      expectedUpdatedAt: params.expectedUpdatedAt,
    });
    return res as 'saved' | 'stale' | 'missing';
  }

  async sqliteAddBookmark(params: {
    mangaId: string;
    chapterName: string;
    position: Position;
  }): Promise<Position[]> {
    return await invokeCommand('sqlite_add_bookmark', {
      mangaId: params.mangaId,
      chapterName: params.chapterName,
      position: params.position,
    });
  }

  async sqliteRemoveBookmark(params: {
    mangaId: string;
    chapterName: string;
    position: Position;
  }): Promise<Position[]> {
    return await invokeCommand('sqlite_remove_bookmark', {
      mangaId: params.mangaId,
      chapterName: params.chapterName,
      position: params.position,
    });
  }

  async sqliteGetBookmarkedMangaIds(): Promise<{
    allBookmarkedIds: string[];
    mangaBookmarkedIds: string[];
  }> {
    try {
      const res = await invokeCommand('sqlite_get_bookmarked_manga_ids');
      return {
        allBookmarkedIds: (res as any).allBookmarked || (res as any).allBookmarkedIds || [],
        mangaBookmarkedIds: (res as any).mangaBookmarked || (res as any).mangaBookmarkedIds || [],
      };
    } catch (err) {
      console.warn('Tauri sqliteGetBookmarkedMangaIds failed:', err);
      return { allBookmarkedIds: [], mangaBookmarkedIds: [] };
    }
  }

  async getBookmarkCards(query: BookmarkCardsQuery = {}): Promise<BookmarkCardsResult> {
    try {
      return await invokeCommand('get_bookmark_cards', { query });
    } catch (err) {
      console.warn('Tauri getBookmarkCards failed, falling back to empty:', err);
      return { cards: [], total: 0 };
    }
  }

  async sqliteDeleteManga(id: string): Promise<void> {
    await invokeCommand('sqlite_delete_manga', { id });
  }

  async sqliteClearLibrary(): Promise<void> {
    await invokeCommand('sqlite_clear_library');
  }

  async sqliteResetProgress(): Promise<void> {
    await invokeCommand('sqlite_reset_progress');
  }

  async sqliteGetSettings(): Promise<Settings | undefined> {
    try {
      const record = await invokeCommand('sqlite_get_settings');
      return record ?? undefined;
    } catch (err) {
      console.warn('Tauri sqliteGetSettings failed:', err);
      return undefined;
    }
  }

  async sqliteSaveSettings(settings: Settings): Promise<Settings> {
    await invokeCommand('sqlite_save_settings', { settings });
    return settings;
  }

  async exportBackup(): Promise<string> {
    return await invokeCommand('export_library_backup');
  }

  async restoreBackup(backupJson: string): Promise<Settings> {
    return (await invokeCommand('restore_library_backup', { backupJson })) as any;
  }

  async validateBackup(backupJson: string): Promise<unknown> {
    return await invokeCommand('validate_library_backup', { backupJson });
  }

  async validateRelativePath(path: string): Promise<string> {
    return await invokeCommand('validate_relative_path_cmd', { path });
  }

  async matchingPosition(
    saved?: Position,
    pages?: Page[],
    oldPages?: Page[],
  ): Promise<Position | undefined> {
    const res = await invokeCommand('matching_position_cmd', { saved, pages, oldPages });
    return res ?? undefined;
  }

  async parseSettings(value: unknown): Promise<Settings> {
    return await invokeCommand('parse_settings_cmd', { value });
  }

  async isSamePath(pathA: string, pathB: string): Promise<boolean> {
    try {
      return await invokeCommand('is_same_path', { pathA, pathB });
    } catch {
      return (
        pathA.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
        pathB.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
      );
    }
  }

  async indexTitle(
    root: string,
    options?: IndexTitleOptions,
    onProgress?: (progress: IndexScanProgress) => void,
  ): Promise<IndexTitleDto> {
    const channel = new Channel<IndexScanProgress>();
    const jobId =
      options?.jobId ??
      (options?.signal ? `index-${Math.random().toString(36).slice(2)}` : undefined);

    let abortHandler: (() => void) | undefined;
    if (options?.signal && jobId) {
      if (options.signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      abortHandler = () => {
        void this.cancelScan?.(jobId);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (onProgress) {
      channel.onmessage = (progress) => {
        if (options?.signal?.aborted) {
          if (jobId) void this.cancelScan?.(jobId);
          return;
        }
        onProgress(progress);
      };
    }

    try {
      return await invokeCommand('index_title', {
        root,
        options: options
          ? {
            sort: options.sort,
            warmChapters: options.warmChapters,
            jobId,
            title: options.title,
            targetId: options.targetId ?? options.previous?.id,
            previous: options.previous
              ? {
                id: options.previous.id,
                title: options.previous.title,
                slug: options.previous.slug,
                lastChapter: options.previous.lastChapter,
                addedAt: options.previous.addedAt,
                revision: options.previous.revision,
                chapters: options.previous.chapters.map((c) => ({
                  name: c.name,
                  read: c.read,
                  position: c.position,
                  bookmarks: c.bookmarks,
                  pages: c.pages.map((p) => ({
                    name: p.name,
                    path: p.path,
                    width: p.width,
                    height: p.height,
                    size: p.size,
                    modified: p.modified,
                    dimensionsPending: p.dimensionsPending,
                  })),
                })),
              }
              : undefined,
          }
          : undefined,
        onProgress: channel,
      } as any);
    } catch (err) {
      const fsErr = parseFsError(err);
      if (
        fsErr?.code === 'Cancelled' ||
        (typeof err === 'string' && err.includes('Indexing cancelled')) ||
        (err instanceof Error && err.message.includes('Indexing cancelled'))
      ) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      throw err;
    } finally {
      if (abortHandler && options?.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  async prepareChapter(
    mangaId: string,
    chapterIndex: number,
    onProgress?: (progress: IndexScanProgress) => void,
    signal?: AbortSignal,
  ): Promise<PrepareChapterDto> {
    const channel = new Channel<IndexScanProgress>();
    const jobId = signal ? `prep-${Math.random().toString(36).slice(2)}` : undefined;

    let abortHandler: (() => void) | undefined;
    if (signal && jobId) {
      if (signal.aborted) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      abortHandler = () => {
        void this.cancelScan?.(jobId);
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }

    if (onProgress) {
      channel.onmessage = (progress) => {
        if (signal?.aborted) {
          if (jobId) void this.cancelScan?.(jobId);
          return;
        }
        onProgress(progress);
      };
    }

    try {
      return await invokeCommand('prepare_chapter', {
        mangaId,
        chapterIndex,
        jobId,
        onProgress: channel,
      });
    } catch (err) {
      const fsErr = parseFsError(err);
      if (
        fsErr?.code === 'Cancelled' ||
        (typeof err === 'string' && err.includes('Indexing cancelled')) ||
        (err instanceof Error && err.message.includes('Indexing cancelled'))
      ) {
        throw new DOMException('The operation was aborted', 'AbortError');
      }
      throw err;
    } finally {
      if (abortHandler && signal) {
        signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  async previewChapters(
    paths: string[],
  ): Promise<Array<{ name: string; pageCount: number }>> {
    return await invokeCommand('preview_chapters', { paths });
  }

  async scheduleBackground(mangaId: string): Promise<boolean> {
    try {
      return await invokeCommand('schedule_background', { mangaId });
    } catch {
      return false;
    }
  }

  async stopBackground(mangaId: string): Promise<void> {
    try {
      await invokeCommand('stop_background', { mangaId });
    } catch { }
  }

  async stopAllBackground(): Promise<void> {
    try {
      await invokeCommand('stop_all_background');
    } catch { }
  }

  async resumeBackground(): Promise<number> {
    try {
      return await invokeCommand('resume_background');
    } catch {
      return 0;
    }
  }

  convertFileSrc(filePath: string, protocol = 'mangaimg'): string {
    if (typeof tauriConvertFileSrc === 'function' && isTauri) {
      try {
        return tauriConvertFileSrc(filePath, protocol);
      } catch {
        // fallback below
      }
    }
    const normalized = filePath.replace(/\\/g, '/');
    const isWindowsDrive = /^([a-zA-Z]):/.test(normalized);
    const drivePrefix = isWindowsDrive ? normalized.slice(0, 1) + '%3A' : '';
    const rest = isWindowsDrive
      ? normalized.slice(2).replace(/^\/+/, '')
      : normalized.replace(/^\/+/, '');
    const segments = rest.split('/').filter(Boolean);
    const encoded = segments.map((s) => encodeURIComponent(s)).join('/');
    const cleanPath = drivePrefix ? drivePrefix + '/' + encoded : encoded;
    return `http://${protocol}.localhost/${cleanPath}`;
  }

  getPageImageUrl(options: PageImageResourceOptions): string {
    return getPageImageUrl(options);
  }

  getCoverImageUrl(mangaId: string, version?: string | number, size?: number): string {
    return getCoverImageUrl(mangaId, version, size);
  }

  onDragDrop(callback: (paths: string[]) => void): () => void {
    if (typeof window === 'undefined') {
      return () => { };
    }
    let unlistenNative: (() => void) | undefined;
    let unlistenTauri: (() => void) | undefined;
    let active = true;

    if (typeof (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ !== 'object') {
      (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
        unregisterListener: () => { },
      };
    }

    void listen<string[]>('native-drag-drop', (event) => {
      if (!active) return;
      const paths = event.payload;
      if (Array.isArray(paths) && paths.length > 0) {
        callback(paths);
      }
    })
      .then((un) => {
        if (!active) {
          try {
            void un();
          } catch { }
        } else {
          unlistenNative = un;
        }
      })
      .catch(() => { });

    void listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
      if (!active) return;
      const paths = event.payload?.paths;
      if (Array.isArray(paths) && paths.length > 0) {
        callback(paths);
      }
    })
      .then((un) => {
        if (!active) {
          try {
            void un();
          } catch { }
        } else {
          unlistenTauri = un;
        }
      })
      .catch(() => { });

    return () => {
      active = false;
      try {
        unlistenNative?.();
      } catch { }
      try {
        unlistenTauri?.();
      } catch { }
    };
  }

  async checkForUpdate(): Promise<DesktopUpdateInfo | null> {
    if (!this.isTauri) return null;
    try {
      return await invoke<DesktopUpdateInfo | null>('plugin:updater|check');
    } catch (err) {
      console.warn('Tauri updater check failed:', err);
      throw err;
    }
  }

  async installUpdate(): Promise<void> {
    if (!this.isTauri) return;
    try {
      await invoke('plugin:updater|download_and_install');
    } catch (err) {
      console.error('Failed to install desktop update:', err);
      throw err;
    }
  }

  async getStorageStats(): Promise<StorageStats> {
    return invokeCommand('get_storage_stats', {});
  }

  async saveFileDialog(defaultName: string, content: string): Promise<boolean> {
    return invokeCommand('save_file_dialog', { defaultName, content });
  }

  async recordDiagnostic(entry: DiagnosticInputPayload): Promise<DiagnosticRecordPayload | null> {
    try {
      return await invokeCommand('record_diagnostic', { entry });
    } catch {
      return null;
    }
  }

  async getDiagnostics(): Promise<DiagnosticRecordPayload[]> {
    try {
      return await invokeCommand('get_diagnostics');
    } catch {
      return [];
    }
  }

  async clearDiagnostics(): Promise<void> {
    try {
      await invokeCommand('clear_diagnostics');
    } catch { }
  }

  async sanitizeDiagnosticIdentifier(raw?: string): Promise<string | undefined> {
    try {
      const res = await invokeCommand('sanitize_diagnostic_identifier', { raw });
      return res ?? undefined;
    } catch {
      return undefined;
    }
  }

  async computeOffsets(
    pages: Array<Pick<Page, 'width' | 'height'>>,
    options: GeometryOptions,
    measuredHeights?: Record<number, number>,
  ): Promise<PageOffset[]> {
    return invokeCommand('compute_offsets', {
      pages: pages.map((p) => ({ width: p.width, height: p.height })),
      options,
      measuredHeights,
    });
  }

  async getWindowRange(
    offsets: PageOffset[],
    scrollY: number,
    viewportHeight: number,
    bufferScreenCount?: number,
    threshold?: number,
  ): Promise<WindowRange> {
    return invokeCommand('get_window_range', {
      offsets,
      scrollY,
      viewportHeight,
      bufferScreenCount,
      threshold,
    });
  }
}

class WebDesktopBridge implements DesktopAPI {
  readonly isDesktop = false;
  readonly isTauri = false;

  onDragDrop(): () => void {
    return () => { };
  }

  async selectFolder(): Promise<string | null> {
    return null;
  }

  async listFolder(): Promise<FolderEntry[]> {
    return [];
  }

  async discoverLibrary(): Promise<LibraryDiscovery | null> {
    return null;
  }

  async naturalSortPaths(paths: string[]): Promise<string[]> {
    return paths;
  }

  async resolvePath(_mangaId?: string, relativePath = '', localPath?: string): Promise<string> {
    if (localPath) {
      const sep = localPath.includes('\\') ? '\\' : '/';
      return `${localPath}${sep}${relativePath.split('/').join(sep)}`;
    }
    return relativePath;
  }

  async checkAccess(): Promise<boolean> {
    return true;
  }

  async revokeRoot(): Promise<boolean> {
    return false;
  }

  async getAuthorizedRoots(): Promise<string[]> {
    return [];
  }

  async cancelScan(): Promise<boolean> {
    return false;
  }

  async readFile(): Promise<ArrayBuffer | null> {
    return null;
  }

  async getImageDimensions(): Promise<{ width: number; height: number } | null> {
    return null;
  }

  async getHeaderDimensions(): Promise<{ width: number; height: number } | undefined> {
    return undefined;
  }

  async decodeImageDimensions(): Promise<{ width: number; height: number } | undefined> {
    return undefined;
  }

  async generateThumbnailFromBytes(): Promise<Blob | undefined> {
    return undefined;
  }

  async downscaleImageBytes(): Promise<Blob | null> {
    return null;
  }

  async clearDimensionCache(): Promise<void> { }

  setProgressBar(): void { }

  async showMainWindow(): Promise<boolean> {
    return false;
  }

  async saveThumbnail(): Promise<boolean> {
    return false;
  }

  async getThumbnail(): Promise<ArrayBuffer | null> {
    return null;
  }

  async getThumbnailUrl(): Promise<string | null> {
    return null;
  }

  async deleteThumbnail(): Promise<void> { }

  async clearThumbnails(): Promise<void> { }

  async generateThumbnail(): Promise<CachedImageResult | null> {
    return null;
  }

  async generateImageVariant(): Promise<CachedImageResult | null> {
    return null;
  }

  async getAppConfig(): Promise<AppConfig | null> {
    return null;
  }

  async saveAppConfig(): Promise<boolean> {
    return false;
  }

  async setWindowPreferences(): Promise<boolean> {
    return false;
  }

  async setAppPreference(): Promise<boolean> {
    return false;
  }

  async getAppPreference(): Promise<unknown> {
    return null;
  }

  async recordOpenedRoot(): Promise<string[]> {
    return [];
  }

  async getLastOpenedRoots(): Promise<string[]> {
    return [];
  }

  async isLibraryMigrated(): Promise<boolean> {
    return false;
  }

  async importLegacyLibrary(): Promise<boolean> {
    return false;
  }

  async sqliteListLibrary(): Promise<Summary[]> {
    return [];
  }

  async sqliteGetManga(): Promise<Manga | undefined> {
    return undefined;
  }

  async sqliteSaveManga(): Promise<void> { }

  async sqliteSaveProgress(): Promise<'saved' | 'stale' | 'missing'> {
    return 'saved';
  }

  async sqliteAddBookmark(): Promise<Position[]> {
    return [];
  }

  async sqliteRemoveBookmark(): Promise<Position[]> {
    return [];
  }

  async sqliteGetBookmarkedMangaIds(): Promise<{
    allBookmarkedIds: string[];
    mangaBookmarkedIds: string[];
  }> {
    return { allBookmarkedIds: [], mangaBookmarkedIds: [] };
  }

  async getBookmarkCards(_query: BookmarkCardsQuery = {}): Promise<BookmarkCardsResult> {
    return { cards: [], total: 0 };
  }

  async sqliteDeleteManga(): Promise<void> { }

  async sqliteClearLibrary(): Promise<void> { }

  async sqliteResetProgress(): Promise<void> { }

  async sqliteGetSettings(): Promise<Settings | undefined> {
    return undefined;
  }

  async sqliteSaveSettings(settings: Settings): Promise<Settings> {
    return settings;
  }

  async exportBackup(): Promise<string> {
    return '';
  }

  async restoreBackup(): Promise<Settings> {
    return {} as Settings;
  }

  async validateBackup(): Promise<unknown> {
    return null;
  }

  async isSamePath(pathA: string, pathB: string): Promise<boolean> {
    return (
      pathA.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
      pathB.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    );
  }

  async indexTitle(): Promise<IndexTitleDto> {
    throw new Error('indexTitle is only available in desktop environment.');
  }

  async prepareChapter(): Promise<PrepareChapterDto> {
    throw new Error('prepareChapter is only available in desktop environment.');
  }

  convertFileSrc(filePath: string): string {
    return filePath;
  }

  getPageImageUrl(_options: PageImageResourceOptions): string {
    return '';
  }

  getCoverImageUrl(_mangaId: string, _version?: string | number, _size?: number): string {
    return '';
  }

  async checkForUpdate(): Promise<DesktopUpdateInfo | null> {
    return null;
  }

  async installUpdate(): Promise<void> { }

  async getStorageStats(): Promise<StorageStats> {
    return { db_bytes: 0, cache_bytes: 0, total_bytes: 0 };
  }

  async saveFileDialog(_defaultName: string, _content: string): Promise<boolean> {
    return false;
  }

  async recordDiagnostic(_entry: DiagnosticInputPayload): Promise<DiagnosticRecordPayload | null> {
    return null;
  }

  async getDiagnostics(): Promise<DiagnosticRecordPayload[]> {
    return [];
  }

  async clearDiagnostics(): Promise<void> { }
  async sanitizeDiagnosticIdentifier(raw?: string): Promise<string | undefined> {
    if (!raw) return undefined;
    const parts = raw.replace(/\\/g, '/').split('/').filter(Boolean);
    return parts.length ? parts.slice(-2).join('/') : undefined;
  }

  async computeOffsets(
    pages: Array<Pick<Page, 'width' | 'height'>>,
    options: GeometryOptions,
    measuredHeights?: Record<number, number>,
  ): Promise<PageOffset[]> {
    const offsets: PageOffset[] = [];
    let currentTop = 0;
    const safeZoom = Math.max(0.1, options.zoom || 1);
    for (let i = 0; i < pages.length; i++) {
      let height = measuredHeights?.[i];
      if (height === undefined || height <= 0 || !Number.isFinite(height)) {
        const p = pages[i];
        const nativeWidth = Math.max(1, p.width) * safeZoom;
        const aspect = Math.max(1, p.width) / Math.max(1, p.height);
        const readingW =
          options.maxWidth > 0 ? options.maxWidth * safeZoom : options.containerWidth;
        const targetW = Math.max(
          1,
          Math.round(Math.min(options.containerWidth, readingW, nativeWidth)),
        );
        height = Math.max(1, Math.round(targetW / aspect));
      }
      const bottom = currentTop + height;
      offsets.push({ page: i, top: currentTop, height, bottom });
      currentTop = bottom;
    }
    return offsets;
  }

  async getWindowRange(
    offsets: PageOffset[],
    _scrollY: number,
    _viewportHeight: number,
  ): Promise<WindowRange> {
    return {
      startIndex: 0,
      endIndex: Math.max(0, offsets.length - 1),
      topSpacer: 0,
      bottomSpacer: 0,
    };
  }
}

export const desktopAPI: DesktopAPI = isTauri ? new TauriDesktopBridge() : new WebDesktopBridge();

export {
  ValidationError,
  isRecord,
  validateRelativePath,
  matchingPosition,
  parsePosition,
  parsePage,
  parseChapter,
  parseManga,
  parseSummary,
  parseSettings,
  validateBackup,
} from './web/validation';

export async function validateBackupAsync(
  value: unknown,
): Promise<{ manga: Manga[]; settings: Settings }> {
  const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
  if (desktopAPI.validateBackup) {
    const validated = (await desktopAPI.validateBackup(jsonStr)) as {
      manga: Manga[];
      settings: Settings;
    };
    const { parseSettings: parseSettingsSync } = await import('./web/validation');
    return {
      manga: validated.manga || [],
      settings: parseSettingsSync(validated.settings),
    };
  }
  const { validateBackup: validateBackupSync } = await import('./web/validation');
  return validateBackupSync(value);
}
import {
  stopBackground as webStopBackground,
  stopAllBackground as webStopAllBackground,
  scheduleBackground as webScheduleBackground,
  resumeBackground as webResumeBackground,
} from './web/importScan';

export {
  DesktopHandle,
  naturalOrder,
  naturalSortPaths,
  ignored,
  clearSessionDimensions,
  fromDesktopFolder,
  fromFiles,
  fromHandle,
  droppedSources,
  splitSource,
  chapterGroups,
  chapterPreviews,
  indexSource,
  prepareChapter,
  scanImage,
  discardScan,
  warmSources,
  type Issue,
  type ScanState,
  type ScanOptions,
  type PrepareChapterOptions,
  type ChapterPreview,
  type Source,
} from './web/importScan';

export function stopBackground(id: string): void {
  if (desktopAPI.isDesktop && desktopAPI.stopBackground) {
    void desktopAPI.stopBackground(id);
    return;
  }
  webStopBackground(id);
}

export function stopAllBackground(): void {
  if (desktopAPI.isDesktop && desktopAPI.stopAllBackground) {
    void desktopAPI.stopAllBackground();
    return;
  }
  webStopAllBackground();
}

export function scheduleBackground(manga: Manga): void {
  if (desktopAPI.isDesktop && desktopAPI.scheduleBackground) {
    if (!manga.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))) return;
    void desktopAPI.scheduleBackground(manga.id);
    return;
  }
  webScheduleBackground(manga);
}

export async function resumeBackground(): Promise<void> {
  if (desktopAPI.isDesktop && desktopAPI.resumeBackground) {
    await desktopAPI.resumeBackground();
    return;
  }
  await webResumeBackground();
}

export function imageFile(f: Pick<File, 'name' | 'type'>): boolean {
  return (
    f.type.startsWith('image/') ||
    /\.(jpe?g|png|webp|avif|gif|bmp|svg|ico|heic|heif|tiff?)$/i.test(f.name)
  );
}

async function decodeDimensionsInBrowser(
  f: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  const url = URL.createObjectURL(f);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const im = new Image();
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        im.onload = null;
        im.onerror = null;
        try {
          if (error) reject(error);
          else {
            assertImageDimensions(im.naturalWidth, im.naturalHeight);
            resolve({ width: im.naturalWidth, height: im.naturalHeight });
          }
        } catch (e) {
          reject(e);
        } finally {
          im.src = '';
        }
      };
      const abort = () => finish(new DOMException('Import cancelled', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error('Image took too long to read. Retry this file.')),
        limits.imageTimeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      im.onload = () => finish();
      im.onerror = () =>
        finish(new Error('Corrupt image or a format this browser cannot display.'));
      im.src = url;
      if (signal?.aborted) abort();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function dimensions(
  f: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  signal?.throwIfAborted();
  const header = await desktopAPI.getHeaderDimensions?.(f);
  signal?.throwIfAborted();
  if (header) return header;

  if (desktopAPI.isDesktop && desktopAPI.decodeImageDimensions) {
    try {
      const decoded = await desktopAPI.decodeImageDimensions(f, signal);
      signal?.throwIfAborted();
      if (decoded) return decoded;
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      // Fall through to browser decode for WebView-only formats (e.g. SVG)
    }
  }

  return decodeDimensionsInBrowser(f, signal);
}

export async function thumbnail(
  file: File,
  signal?: AbortSignal,
  quality = 0.65,
): Promise<Blob | undefined> {
  signal?.throwIfAborted();

  if (desktopAPI.isDesktop && desktopAPI.generateThumbnailFromBytes) {
    try {
      return await desktopAPI.generateThumbnailFromBytes(file, quality, signal);
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      // Fall through to browser canvas fallback for WebView-only formats (e.g. SVG/AVIF)
    }
  }

  const size = await desktopAPI.getHeaderDimensions?.(file);
  signal?.throwIfAborted();
  if (
    size &&
    (size.width * size.height > limits.imagePixels ||
      Math.max(size.width, size.height) > limits.imageSide)
  ) {
    return undefined;
  }

  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const finish = (error?: Error, result?: HTMLImageElement) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
        img.onload = null;
        img.onerror = null;
        if (error) {
          img.src = '';
          reject(error);
        } else if (result) {
          resolve(result);
        }
      };
      const onAbort = () => finish(new DOMException('Cover decode aborted', 'AbortError'));
      const t = setTimeout(() => finish(new Error('Cover timed out')), limits.coverTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      img.onload = () => finish(undefined, img);
      img.onerror = () => finish(new Error('Cover unavailable'));
      img.src = url;
      if (signal?.aborted) onAbort();
    });

    try {
      assertImageDimensions(im.naturalWidth, im.naturalHeight);
      const c = document.createElement('canvas');
      try {
        const scale = Math.min(1024 / im.naturalWidth, 1024 / im.naturalHeight, 1.0);
        c.width = Math.max(1, Math.round(im.naturalWidth * scale));
        c.height = Math.max(1, Math.round(im.naturalHeight * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(im, 0, 0, c.width, c.height);
        return await withinTime(
          new Promise<Blob | undefined>((r) =>
            c.toBlob((b) => r(b ?? undefined), 'image/webp', quality),
          ),
          limits.coverTimeoutMs,
          'Encoding cover',
        );
      } finally {
        c.width = 0;
        c.height = 0;
      }
    } finally {
      im.src = '';
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downscaleImage(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();

  if (desktopAPI.isDesktop && desktopAPI.downscaleImageBytes) {
    try {
      const scaled = await desktopAPI.downscaleImageBytes(blob, targetWidth, targetHeight, signal);
      if (scaled) return scaled;
    } catch (e) {
      if (signal?.aborted || (e instanceof DOMException && e.name === 'AbortError')) throw e;
      // Fall through to browser bitmap resize for non-Rust-decodable formats
    }
  }

  if (typeof window === 'undefined' || !('createImageBitmap' in window)) {
    return blob;
  }

  let expired = false;
  const isConstrained =
    typeof navigator !== 'undefined' &&
    (Boolean(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      Boolean(
        (navigator as unknown as { deviceMemory?: number }).deviceMemory &&
        (navigator as unknown as { deviceMemory?: number }).deviceMemory! <= 4,
      ));
  const resizeQuality: ResizeQuality = isConstrained ? 'low' : 'medium';

  const task = createImageBitmap(blob, {
    resizeWidth: targetWidth,
    resizeHeight: targetHeight,
    resizeQuality,
  });

  void task.then(
    (bitmap) => {
      if (expired || signal?.aborted) {
        bitmap.close();
      }
    },
    () => { },
  );

  const onAbort = () => {
    expired = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let bitmap: ImageBitmap;
  try {
    bitmap = await withinTime(task, limits.imageTimeoutMs, 'Resizing image');
  } catch (error) {
    expired = true;
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (signal?.aborted) {
    bitmap.close();
    throw new DOMException('Image resize aborted', 'AbortError');
  }

  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Image resizing canvas context is unavailable.');
    }
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }

  try {
    return await withinTime(
      new Promise<Blob>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Image encoding aborted', 'AbortError'));
          return;
        }
        canvas.toBlob(
          (result) => {
            if (signal?.aborted) {
              reject(new DOMException('Image encoding aborted', 'AbortError'));
            } else {
              resolve(result || blob);
            }
          },
          'image/webp',
          0.8,
        );
      }),
      limits.imageTimeoutMs,
      'Encoding image',
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}