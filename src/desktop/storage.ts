import { type Manga, type Summary, type Position, type Page, type Settings } from '../model';
import { limits, assertPathLimits, withinTime } from '../limits';
import { desktopAPI } from '../tauriBridge';
import {
  type LibraryRepo,
  TauriSqliteLibraryRepo,
  ensureLibraryMigrated,
  readLegacyIndexedDB,
} from '../repo';
import {
  type MangaDeleteListener,
  onMangaDelete,
  notifyDelete,
  type StorageSyncMessage,
  syncChannel,
  onStorageSync,
  broadcastSync,
} from '../web/storage';

export type SourceFile = File | { getFile(): Promise<File> };
export const sessionFiles = new Map<string, Map<string, SourceFile>>();

export {
  type MangaDeleteListener,
  onMangaDelete,
  notifyDelete,
  type StorageSyncMessage,
  syncChannel,
  onStorageSync,
  broadcastSync,
};

export function invalidateSummaryCache(): void {
  getRepo().invalidateCaches?.();
}

export function invalidateBookmarkCache(): void {
  getRepo().invalidateCaches?.();
}

syncChannel?.addEventListener('message', () => {
  activeRepo.invalidateCaches?.();
  clearDirHandleCache();
});

export const summary = (m: Manga): Summary => {
  const { chapters, cover: _cover, ...rest } = m;

  return {
    ...rest,
    chapterCount: chapters.length,
    chaptersRead: chapters.filter((c) => c.read).length,
    lastChapterName: chapters[m.lastChapter]?.name || '',
    hasProgress: chapters.some((c) => Boolean(c.position)),
    indexedAt: m.updatedAt,
    revision: m.revision ?? 1,
  };
};

export type SaveProgressResult = 'saved' | 'stale' | 'missing';

let activeRepo: LibraryRepo = new TauriSqliteLibraryRepo();

export function setRepo(newRepo: LibraryRepo): void {
  activeRepo = newRepo;
}

export function getRepo(): LibraryRepo {
  return activeRepo;
}

export const repo: LibraryRepo = {
  listLibrary: () => activeRepo.listLibrary(),
  getManga: (id: string) => activeRepo.getManga(id),
  getCover: (id: string) => activeRepo.getCover(id),
  allManga: () => activeRepo.allManga(),
  saveManga: (m: Manga) => activeRepo.saveManga(m),
  saveProgress: (m, index, position, read, bookmarks, updateLast) =>
    activeRepo.saveProgress(m, index, position, read, bookmarks, updateLast),
  getBookmarkedMangaIds: () => activeRepo.getBookmarkedMangaIds(),
  getMangaBookmarkedIds: () => activeRepo.getMangaBookmarkedIds(),
  addBookmark: (mangaId, chapterName, position) =>
    activeRepo.addBookmark(mangaId, chapterName, position),
  removeBookmark: (mangaId, chapterName, position) =>
    activeRepo.removeBookmark(mangaId, chapterName, position),
  deleteManga: (id: string) => activeRepo.deleteManga(id),
  clearLibrary: () => activeRepo.clearLibrary(),
  resetProgress: () => activeRepo.resetProgress(),
  getStoredSettings: () => activeRepo.getStoredSettings(),
  saveStoredSettings: (settings: Settings) => activeRepo.saveStoredSettings(settings),
  exportBackup: () => (activeRepo.exportBackup ? activeRepo.exportBackup() : Promise.resolve('')),
  restoreBackup: (backup) => activeRepo.restoreBackup(backup),
  invalidateCaches: () => activeRepo.invalidateCaches?.(),
};

export const listLibrary = async (): Promise<Summary[]> => repo.listLibrary();
export const getManga = async (id: string): Promise<Manga | undefined> => repo.getManga(id);
export const getCover = async (id: string): Promise<Blob | undefined> => repo.getCover(id);
export const allManga = async (): Promise<Manga[]> => repo.allManga();
export const saveManga = async (m: Manga): Promise<void> => repo.saveManga(m);
export const saveProgress = async (
  m: Manga,
  index: number,
  position: Position,
  read: boolean,
  bookmarks?: Position[],
  updateLast = true,
): Promise<SaveProgressResult> =>
  repo.saveProgress(m, index, position, read, bookmarks, updateLast);
export const getBookmarkedMangaIds = async (): Promise<Set<string>> => repo.getBookmarkedMangaIds();
export const getMangaBookmarkedIds = async (): Promise<Set<string>> => repo.getMangaBookmarkedIds();
export const addBookmark = async (
  mangaId: string,
  chapterName: string,
  position: Position,
): Promise<Position[]> => repo.addBookmark(mangaId, chapterName, position);
export const removeBookmark = async (
  mangaId: string,
  chapterName: string,
  position: Position,
): Promise<Position[]> => repo.removeBookmark(mangaId, chapterName, position);
export const deleteManga = async (id: string): Promise<void> => repo.deleteManga(id);
export const clearLibrary = async (): Promise<void> => repo.clearLibrary();
export const resetProgress = async (): Promise<void> => repo.resetProgress();
export const getStoredSettings = async (): Promise<Settings | undefined> =>
  repo.getStoredSettings();
export const saveStoredSettings = async (settings: Settings): Promise<Settings> =>
  repo.saveStoredSettings(settings);
export const exportBackup = async (): Promise<string> =>
  repo.exportBackup ? repo.exportBackup() : Promise.resolve('');
export const restoreBackup = async (
  backup: { manga: Manga[]; settings: Settings } | string,
): Promise<Settings> => repo.restoreBackup(backup);

export { type LibraryRepo, TauriSqliteLibraryRepo, ensureLibraryMigrated };

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object' && 'message' in e) {
    return String((e as { message: unknown }).message);
  }
  return 'Unknown error occurred';
}

export interface AccessCacheEntry {
  expiresAt: number;
  granted: boolean;
  timestamp?: number;
}

export interface MangaDB {
  [key: string]: unknown;
}

export async function migrateV1ToV2(_tx?: unknown, _d?: unknown): Promise<void> { }

export const ACCESS_CACHE_TTL_MS = 7500;
export const dirHandleCache = new Map<string, any>();
export const accessCache = new Map<string, AccessCacheEntry>();

export function clearAccessCache(mangaId?: string): void {
  if (mangaId) {
    accessCache.delete(mangaId);
  } else {
    accessCache.clear();
  }
}

export function clearDirHandleCache(mangaId?: string): void {
  clearAccessCache(mangaId);
  if (mangaId) {
    const prefix = `${mangaId}:`;
    for (const key of dirHandleCache.keys()) {
      if (key.startsWith(prefix)) {
        dirHandleCache.delete(key);
      }
    }
  } else {
    dirHandleCache.clear();
  }
}

export async function fileFor(m: Manga, p: Page): Promise<File> {
  if (!p.path) throw new Error('Desktop page is missing path');
  assertPathLimits(p.path);
  if (m.localPath || desktopAPI.resolvePath) {
    const sep = m.localPath?.includes('\\') ? '\\' : '/';
    const fallbackPath = m.localPath
      ? `${m.localPath.replace(/[\\/]+$/, '')}${sep}${p.path.split('/').join(sep)}`
      : p.path;
    const resolvedPath = desktopAPI.resolvePath
      ? await desktopAPI.resolvePath(m.id, p.path, m.localPath)
      : fallbackPath;
    const buffer = await withinTime(
      desktopAPI.readFile(resolvedPath),
      limits.ioTimeoutMs,
      'Reading file',
    );
    if (!buffer) throw new Error(`Could not read desktop file at: ${resolvedPath}`);
    return new File([buffer], p.name || p.path.split('/').at(-1) || 'image.webp');
  }
  const f = sessionFiles.get(m.id)?.get(p.path);
  if (f) {
    return withinTime(
      f instanceof File ? Promise.resolve(f) : f.getFile(),
      limits.ioTimeoutMs,
      'Reading file',
    );
  }
  throw new Error('Desktop manga is missing localPath');
}

export async function access(
  manga: Pick<Manga, 'id' | 'localPath'>,
  request = false,
): Promise<boolean> {
  if (!manga) return false;
  if (sessionFiles.has(manga.id)) return true;

  const now = Date.now();
  if (!request) {
    const cached = accessCache.get(manga.id);
    if (cached && now < cached.expiresAt) {
      return cached.granted;
    }
  }

  try {
    const granted = desktopAPI.checkAccess
      ? await desktopAPI.checkAccess(manga.id, manga.localPath)
      : Boolean(manga.localPath);

    accessCache.set(manga.id, {
      expiresAt: now + ACCESS_CACHE_TTL_MS,
      timestamp: now,
      granted,
    });
    return granted;
  } catch {
    accessCache.set(manga.id, {
      expiresAt: now + ACCESS_CACHE_TTL_MS,
      timestamp: now,
      granted: false,
    });
    return false;
  }
}

export class IndexedDBLibraryRepo implements LibraryRepo {
  async listLibrary() {
    return [];
  }
  async getManga() {
    return undefined;
  }
  async getCover() {
    return undefined;
  }
  async allManga() {
    const res = await readLegacyIndexedDB();
    if (res.status === 'data') return res.titles;
    if (res.status === 'failed') throw res.error;
    return [];
  }
  async saveManga() { }
  async saveProgress() {
    return 'saved' as const;
  }
  async getBookmarkedMangaIds() {
    return new Set<string>();
  }
  async getMangaBookmarkedIds() {
    return new Set<string>();
  }
  async addBookmark() {
    return [];
  }
  async removeBookmark() {
    return [];
  }
  async deleteManga() { }
  async clearLibrary() { }
  async resetProgress() { }
  async getStoredSettings() {
    const res = await readLegacyIndexedDB();
    if (res.status === 'data') return res.settings;
    if (res.status === 'failed') throw res.error;
    return undefined;
  }
  async saveStoredSettings(s: any) {
    return s;
  }
  async restoreBackup(s: any) {
    return s;
  }
}

export const db: any = null;