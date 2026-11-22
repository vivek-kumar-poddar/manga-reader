import type {
  Manga,
  Summary,
  Position,
  Settings,
  Page,
  PageOffset,
  GeometryOptions,
  WindowRange,
} from '../model';

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

export interface SortableSummary {
  id: string;
  title: string;
  addedAt: number;
  updatedAt: number;
  chaptersRead: number;
  chapterCount: number;
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
    args:
    | Uint8Array
    | ArrayBuffer
    | { bytes: number[]; targetWidth: number; targetHeight: number; quality?: number };
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

  sort_library_entries: {
    args: {
      entries: SortableSummary[];
      shelfSort?: string;
    };
    return: string[];
  };

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

  sortLibraryEntries(
    entries: SortableSummary[],
    shelfSort?: Settings['shelfSort'],
  ): Promise<string[]>;
}

export interface DesktopUpdateInfo {
  version: string;
  currentVersion?: string;
  body?: string;
  date?: string;
}
