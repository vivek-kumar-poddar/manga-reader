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
import type {
  DesktopAPI,
  FolderEntry,
  LibraryDiscovery,
  CachedImageResult,
  AppConfig,
  WindowPreferences,
  BookmarkCardsQuery,
  BookmarkCardsResult,
  IndexTitleDto,
  PrepareChapterDto,
  PageImageResourceOptions,
  DesktopUpdateInfo,
  StorageStats,
  DiagnosticInputPayload,
  DiagnosticRecordPayload,
} from './types';

export class WebDesktopBridge implements DesktopAPI {
  readonly isDesktop = false;
  readonly isTauri = false;

  onDragDrop(): () => void {
    return () => {};
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

  async clearDimensionCache(): Promise<void> {}

  setProgressBar(): void {}

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

  async deleteThumbnail(): Promise<void> {}

  async clearThumbnails(): Promise<void> {}

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

  async sqliteSaveManga(): Promise<void> {}

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

  async sqliteDeleteManga(): Promise<void> {}

  async sqliteClearLibrary(): Promise<void> {}

  async sqliteResetProgress(): Promise<void> {}

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

  async installUpdate(): Promise<void> {}

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

  async clearDiagnostics(): Promise<void> {}

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
