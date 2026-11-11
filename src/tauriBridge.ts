import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { Manga, Summary, Position, Settings } from './model';

export interface FolderEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  modified: number;
  width?: number | null;
  height?: number | null;
}

export interface PageHeader {
  path: string;
  width: number;
  height: number;
  size: number;
  modified: number;
  checksum?: string;
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
  minimizeToTray: boolean;
  closeToTray: boolean;
  startMaximized: boolean;
  highDpiScaling: boolean;
  theme?: string | null;
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

export interface FsErrorPayload {
  code: 'NotFound' | 'TooLarge' | 'ForbiddenExt' | 'PathNotAllowed' | 'Cancelled' | 'Io';
  message?: string;
}

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
  prepareChapterHeaders?(paths: string[]): Promise<PageHeader[]>;
  cancelScan?(scanId: string): Promise<boolean>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
  getImageDimensions?(absolutePath: string): Promise<{ width: number; height: number } | null>;
  setProgressBar(progress: number): void;
  saveThumbnail?(id: string, buffer: ArrayBuffer | Uint8Array): Promise<boolean>;
  getThumbnail?(id: string): Promise<ArrayBuffer | null>;
  deleteThumbnail?(id: string): Promise<void>;
  clearThumbnails?(): Promise<void>;
  generateThumbnail?(filePath: string, id: string): Promise<ArrayBuffer | null>;
  generateImageVariant?(
    filePath: string,
    maxWidth: number,
    maxHeight: number,
  ): Promise<ArrayBuffer | null>;
  getAppConfig?(): Promise<AppConfig | null>;
  saveAppConfig?(config: AppConfig): Promise<boolean>;
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
  sqliteDeleteManga?(id: string): Promise<void>;
  sqliteClearLibrary?(): Promise<void>;
  sqliteResetProgress?(): Promise<void>;
  sqliteGetSettings?(): Promise<Settings | undefined>;
  sqliteSaveSettings?(settings: Settings): Promise<Settings>;
}

// Detect Tauri runtime presence
export const isTauri =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));

export const isDesktop = isTauri;

export class TauriDesktopBridge implements DesktopAPI {
  readonly isDesktop = true;
  readonly isTauri = true;

  async selectFolder(): Promise<string | null> {
    try {
      const selected = await invoke<string | null>('select_folder');
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

      return await invoke<FolderEntry[]>('list_folder', { folderPath, scanId });
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

      return await invoke<LibraryDiscovery>('discover_library', { folderPath, scanId });
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
      return await invoke<string[]>('natural_sort_paths', { paths });
    } catch (err) {
      console.warn('Tauri naturalSortPaths failed:', parseFsError(err) ?? err);
      return paths;
    }
  }

  async prepareChapterHeaders(paths: string[]): Promise<PageHeader[]> {
    try {
      return await invoke<PageHeader[]>('prepare_chapter_headers', { paths });
    } catch (err) {
      console.warn('Tauri prepareChapterHeaders failed:', parseFsError(err) ?? err);
      return [];
    }
  }

  async cancelScan(scanId: string): Promise<boolean> {
    try {
      return await invoke<boolean>('cancel_scan', { scanId });
    } catch (err) {
      console.warn('Tauri cancelScan failed for', scanId, err);
      return false;
    }
  }

  async readFile(absolutePath: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer>('read_file', {
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
      const dim = await invoke<[number, number] | null>('get_image_dimensions', {
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

  setProgressBar(progress: number): void {
    try {
      void invoke('set_progress_bar', { progress });
    } catch (err) {
      console.warn('Tauri setProgressBar failed:', err);
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

  async generateThumbnail(filePath: string, id: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer>('generate_thumbnail', {
        filePath,
        id,
      });
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
      console.warn('Tauri generateThumbnail failed for', filePath, id, parseFsError(err) ?? err);
      return null;
    }
  }

  async generateImageVariant(
    filePath: string,
    maxWidth: number,
    maxHeight: number,
  ): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer>('generate_image_variant', {
        filePath,
        maxWidth,
        maxHeight,
      });
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
      console.warn('Tauri generateImageVariant failed for', filePath, parseFsError(err) ?? err);
      return null;
    }
  }

  async getThumbnail(id: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer>('read_thumbnail', { id });
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
      await invoke('delete_thumbnail', { id });
    } catch (err) {
      console.warn('Tauri deleteThumbnail failed for', id, parseFsError(err) ?? err);
    }
  }

  async clearThumbnails(): Promise<void> {
    try {
      await invoke('clear_thumbnails');
    } catch (err) {
      console.warn('Tauri clearThumbnails failed:', parseFsError(err) ?? err);
    }
  }

  async getAppConfig(): Promise<AppConfig | null> {
    try {
      return await invoke<AppConfig>('get_app_config');
    } catch (err) {
      console.warn('Tauri getAppConfig failed:', err);
      return null;
    }
  }

  async saveAppConfig(config: AppConfig): Promise<boolean> {
    try {
      await invoke('save_app_config', { config });
      return true;
    } catch (err) {
      console.warn('Tauri saveAppConfig failed:', err);
      return false;
    }
  }

  async setAppPreference(key: string, value: unknown): Promise<boolean> {
    try {
      await invoke('set_app_preference', { key, value });
      return true;
    } catch (err) {
      console.warn('Tauri setAppPreference failed:', key, err);
      return false;
    }
  }

  async getAppPreference(key: string): Promise<unknown> {
    try {
      return await invoke<unknown>('get_app_preference', { key });
    } catch (err) {
      console.warn('Tauri getAppPreference failed:', key, err);
      return null;
    }
  }

  async recordOpenedRoot(rootPath: string): Promise<string[]> {
    try {
      return await invoke<string[]>('record_opened_root', { rootPath });
    } catch (err) {
      console.warn('Tauri recordOpenedRoot failed for', rootPath, err);
      return [];
    }
  }

  async getLastOpenedRoots(): Promise<string[]> {
    try {
      return await invoke<string[]>('get_last_opened_roots');
    } catch (err) {
      console.warn('Tauri getLastOpenedRoots failed:', err);
      return [];
    }
  }

  async isLibraryMigrated(): Promise<boolean> {
    try {
      return await invoke<boolean>('is_library_migrated');
    } catch (err) {
      console.warn('Tauri isLibraryMigrated failed:', err);
      return false;
    }
  }

  async importLegacyLibrary(payload: unknown): Promise<boolean> {
    try {
      return await invoke<boolean>('import_legacy_library', { payload });
    } catch (err) {
      console.warn('Tauri importLegacyLibrary failed:', err);
      return false;
    }
  }

  async sqliteListLibrary(): Promise<Summary[]> {
    try {
      const records = await invoke<Summary[]>('sqlite_list_library');
      return Array.isArray(records) ? records : [];
    } catch (err) {
      console.warn('Tauri sqliteListLibrary failed:', err);
      return [];
    }
  }

  async sqliteGetManga(id: string): Promise<Manga | undefined> {
    try {
      const record = await invoke<Manga | null>('sqlite_get_manga', { id });
      return record ?? undefined;
    } catch (err) {
      console.warn('Tauri sqliteGetManga failed for', id, err);
      return undefined;
    }
  }

  async sqliteSaveManga(manga: Manga): Promise<void> {
    await invoke('sqlite_save_manga', { manga });
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
    const res = await invoke<string>('sqlite_save_progress', {
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
    return await invoke<Position[]>('sqlite_add_bookmark', {
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
    return await invoke<Position[]>('sqlite_remove_bookmark', {
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
      return await invoke<{
        allBookmarkedIds: string[];
        mangaBookmarkedIds: string[];
      }>('sqlite_get_bookmarked_manga_ids');
    } catch (err) {
      console.warn('Tauri sqliteGetBookmarkedMangaIds failed:', err);
      return { allBookmarkedIds: [], mangaBookmarkedIds: [] };
    }
  }

  async sqliteDeleteManga(id: string): Promise<void> {
    await invoke('sqlite_delete_manga', { id });
  }

  async sqliteClearLibrary(): Promise<void> {
    await invoke('sqlite_clear_library');
  }

  async sqliteResetProgress(): Promise<void> {
    await invoke('sqlite_reset_progress');
  }

  async sqliteGetSettings(): Promise<Settings | undefined> {
    try {
      const record = await invoke<Settings | null>('sqlite_get_settings');
      return record ?? undefined;
    } catch (err) {
      console.warn('Tauri sqliteGetSettings failed:', err);
      return undefined;
    }
  }

  async sqliteSaveSettings(settings: Settings): Promise<Settings> {
    await invoke('sqlite_save_settings', { settings });
    return settings;
  }
}

class WebDesktopBridge implements DesktopAPI {
  readonly isDesktop = false;
  readonly isTauri = false;

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

  async prepareChapterHeaders(): Promise<PageHeader[]> {
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

  setProgressBar(): void {}

  async saveThumbnail(): Promise<boolean> {
    return false;
  }

  async getThumbnail(): Promise<ArrayBuffer | null> {
    return null;
  }

  async deleteThumbnail(): Promise<void> {}

  async clearThumbnails(): Promise<void> {}

  async generateThumbnail(): Promise<ArrayBuffer | null> {
    return null;
  }

  async generateImageVariant(): Promise<ArrayBuffer | null> {
    return null;
  }

  async getAppConfig(): Promise<AppConfig | null> {
    return null;
  }

  async saveAppConfig(): Promise<boolean> {
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

  async sqliteDeleteManga(): Promise<void> {}

  async sqliteClearLibrary(): Promise<void> {}

  async sqliteResetProgress(): Promise<void> {}

  async sqliteGetSettings(): Promise<Settings | undefined> {
    return undefined;
  }

  async sqliteSaveSettings(settings: Settings): Promise<Settings> {
    return settings;
  }
}

export const desktopAPI: DesktopAPI = isTauri ? new TauriDesktopBridge() : new WebDesktopBridge();
