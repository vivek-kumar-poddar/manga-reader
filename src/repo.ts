import { type Manga, type Summary, type Position, type Settings, defaults } from './model';
import { parseSettings, validateBackup } from './validation';
import { assertMangaLimits, assertAtMost, limits } from './limits';
import { uniqueSlug } from './paths';
import { desktopAPI } from './tauriBridge';
import {
  type SaveProgressResult,
  broadcastSync,
  notifyDelete,
  clearDirHandleCache,
  db,
} from './storage';

export interface LibraryRepo {
  listLibrary(): Promise<Summary[]>;
  getManga(id: string): Promise<Manga | undefined>;
  getCover(id: string): Promise<Blob | undefined>;
  allManga(): Promise<Manga[]>;
  saveManga(manga: Manga): Promise<void>;
  saveProgress(
    m: Manga,
    index: number,
    position: Position,
    read: boolean,
    bookmarks?: Position[],
    updateLast?: boolean,
  ): Promise<SaveProgressResult>;
  getBookmarkedMangaIds(): Promise<Set<string>>;
  getMangaBookmarkedIds(): Promise<Set<string>>;
  addBookmark(mangaId: string, chapterName: string, position: Position): Promise<Position[]>;
  removeBookmark(mangaId: string, chapterName: string, position: Position): Promise<Position[]>;
  deleteManga(id: string): Promise<void>;
  clearLibrary(): Promise<void>;
  resetProgress(): Promise<void>;
  getStoredSettings(): Promise<Settings | undefined>;
  saveStoredSettings(settings: Settings): Promise<Settings>;
  exportBackup?(): Promise<string>;
  restoreBackup(backup: { manga: Manga[]; settings: Settings } | string): Promise<Settings>;
  invalidateCaches?(): void;
}

export class TauriSqliteLibraryRepo implements LibraryRepo {
  private cachedSummaries: Summary[] | null = null;
  private cachedAllBookmarkedIds: Set<string> | null = null;
  private cachedMangaBookmarkedIds: Set<string> | null = null;
  private bookmarkCachePromise: Promise<void> | null = null;
  private bookmarkGeneration = 0;

  invalidateCaches(): void {
    this.bookmarkGeneration++;
    this.cachedSummaries = null;
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    this.bookmarkCachePromise = null;
  }

  async listLibrary(): Promise<Summary[]> {
    if (this.cachedSummaries) {
      return this.cachedSummaries.slice();
    }
    if (!desktopAPI.sqliteListLibrary) {
      throw new Error('desktopAPI.sqliteListLibrary is required on desktop');
    }
    const entries = await desktopAPI.sqliteListLibrary();
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    this.cachedSummaries = entries;
    return entries.slice();
  }

  async getManga(id: string): Promise<Manga | undefined> {
    if (!desktopAPI.sqliteGetManga) {
      throw new Error('desktopAPI.sqliteGetManga is required on desktop');
    }
    const m = await desktopAPI.sqliteGetManga(id);
    if (!m) return undefined;
    if (!m.cover) {
      m.cover = await this.getCover(id);
    }
    return m;
  }

  async getCover(id: string): Promise<Blob | undefined> {
    if (desktopAPI.getThumbnail) {
      try {
        const buf = await desktopAPI.getThumbnail(id);
        if (buf && buf.byteLength > 0) {
          return new Blob([buf], { type: 'image/webp' });
        }
      } catch (err) {
        console.warn(
          `[TauriSqliteLibraryRepo.getCover] Failed to read native thumbnail for "${id}":`,
          err,
        );
      }
    }
    try {
      if (typeof indexedDB !== 'undefined') {
        const d = await db;
        const blob = await d.get('covers', id);
        if (blob instanceof Blob) {
          if (desktopAPI.saveThumbnail) {
            void blob
              .arrayBuffer()
              .then((ab) => desktopAPI.saveThumbnail?.(id, ab))
              .catch(() => { });
          }
          return blob;
        }
      }
    } catch { }
    return undefined;
  }

  async allManga(): Promise<Manga[]> {
    const summaries = await this.listLibrary();
    const results = await Promise.all(summaries.map((s) => this.getManga(s.id)));
    return results.filter((m): m is Manga => Boolean(m));
  }

  async saveManga(manga: Manga): Promise<void> {
    assertMangaLimits(manga);
    if (!desktopAPI.sqliteSaveManga) {
      throw new Error('desktopAPI.sqliteSaveManga is required on desktop');
    }
    const existingSummaries = await this.listLibrary();
    const existing = existingSummaries.find((x) => x.id === manga.id);
    const revision = (existing?.revision ?? manga.revision ?? 0) + 1;
    const now = Date.now();
    const usedSlugs = new Set(
      existingSummaries.filter((x) => x.id !== manga.id).map((x) => x.slug || ''),
    );
    const slug = manga.slug || existing?.slug || uniqueSlug(manga.title, usedSlugs);
    const m: Manga = {
      ...manga,
      revision,
      updatedAt: now,
      slug,
    };
    await desktopAPI.sqliteSaveManga(m);
    manga.updatedAt = now;
    manga.revision = revision;
    manga.slug = slug;
    if (m.cover instanceof Blob && desktopAPI.saveThumbnail) {
      void m.cover
        .arrayBuffer()
        .then((ab) => desktopAPI.saveThumbnail?.(m.id, ab))
        .catch((err) => {
          console.warn(
            `[TauriSqliteLibraryRepo.saveManga] Failed to cache thumbnail for "${m.id}":`,
            err,
          );
        });
    }
    this.invalidateCaches();
    clearDirHandleCache(m.id);
    broadcastSync({ type: 'library', id: m.id });
  }

  async saveProgress(
    m: Manga,
    index: number,
    position: Position,
    read: boolean,
    bookmarks?: Position[],
    updateLast = true,
  ): Promise<SaveProgressResult> {
    if (!m || !m.chapters || !m.chapters[index]) {
      return 'missing';
    }
    if (bookmarks) {
      assertAtMost(bookmarks.length, limits.bookmarksPerChapter, 'Bookmarks per chapter');
    }
    if (!desktopAPI.sqliteSaveProgress) {
      throw new Error('desktopAPI.sqliteSaveProgress is required on desktop');
    }
    const result = await desktopAPI.sqliteSaveProgress({
      mangaId: m.id,
      chapterIndex: index,
      position,
      read,
      bookmarks,
      updateLast,
      expectedRevision: m.revision,
      expectedUpdatedAt: m.updatedAt,
    });
    if (result === 'saved') {
      this.invalidateCaches();
      broadcastSync({ type: 'progress', id: m.id });
    }
    return result;
  }

  private async ensureBookmarks(): Promise<void> {
    if (this.cachedAllBookmarkedIds && this.cachedMangaBookmarkedIds) {
      return;
    }
    if (!this.bookmarkCachePromise) {
      const currentGen = ++this.bookmarkGeneration;
      this.bookmarkCachePromise = (async () => {
        try {
          if (!desktopAPI.sqliteGetBookmarkedMangaIds) {
            throw new Error('desktopAPI.sqliteGetBookmarkedMangaIds is required on desktop');
          }
          const { allBookmarkedIds, mangaBookmarkedIds } =
            await desktopAPI.sqliteGetBookmarkedMangaIds();
          if (this.bookmarkGeneration === currentGen) {
            this.cachedAllBookmarkedIds = new Set(allBookmarkedIds);
            this.cachedMangaBookmarkedIds = new Set(mangaBookmarkedIds);
          }
        } finally {
          if (this.bookmarkGeneration === currentGen) {
            this.bookmarkCachePromise = null;
          }
        }
      })();
    }
    await this.bookmarkCachePromise;
  }

  async getBookmarkedMangaIds(): Promise<Set<string>> {
    await this.ensureBookmarks();
    return new Set(this.cachedAllBookmarkedIds ?? []);
  }

  async getMangaBookmarkedIds(): Promise<Set<string>> {
    await this.ensureBookmarks();
    return new Set(this.cachedMangaBookmarkedIds ?? []);
  }

  async addBookmark(mangaId: string, chapterName: string, position: Position): Promise<Position[]> {
    if (!desktopAPI.sqliteAddBookmark) {
      throw new Error('desktopAPI.sqliteAddBookmark is required on desktop');
    }
    const res = await desktopAPI.sqliteAddBookmark({
      mangaId,
      chapterName,
      position,
    });
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    this.bookmarkGeneration++;
    broadcastSync({ type: 'progress', id: mangaId });
    return res;
  }

  async removeBookmark(
    mangaId: string,
    chapterName: string,
    position: Position,
  ): Promise<Position[]> {
    if (!desktopAPI.sqliteRemoveBookmark) {
      throw new Error('desktopAPI.sqliteRemoveBookmark is required on desktop');
    }
    const res = await desktopAPI.sqliteRemoveBookmark({
      mangaId,
      chapterName,
      position,
    });
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    this.bookmarkGeneration++;
    broadcastSync({ type: 'progress', id: mangaId });
    return res;
  }

  async deleteManga(id: string): Promise<void> {
    if (!desktopAPI.sqliteDeleteManga) {
      throw new Error('desktopAPI.sqliteDeleteManga is required on desktop');
    }
    await desktopAPI.sqliteDeleteManga(id);
    if (desktopAPI.deleteThumbnail) {
      void desktopAPI.deleteThumbnail(id).catch(() => { });
    }
    this.invalidateCaches();
    clearDirHandleCache(id);
    notifyDelete(id);
    broadcastSync({ type: 'library', id });
  }

  async clearLibrary(): Promise<void> {
    if (!desktopAPI.sqliteClearLibrary) {
      throw new Error('desktopAPI.sqliteClearLibrary is required on desktop');
    }
    await desktopAPI.sqliteClearLibrary();
    if (desktopAPI.clearThumbnails) {
      void desktopAPI.clearThumbnails().catch(() => { });
    }
    this.invalidateCaches();
    clearDirHandleCache();
    notifyDelete();
    broadcastSync({ type: 'library' });
  }

  async resetProgress(): Promise<void> {
    if (!desktopAPI.sqliteResetProgress) {
      throw new Error('desktopAPI.sqliteResetProgress is required on desktop');
    }
    await desktopAPI.sqliteResetProgress();
    this.invalidateCaches();
    broadcastSync({ type: 'progress' });
  }

  async getStoredSettings(): Promise<Settings | undefined> {
    if (!desktopAPI.sqliteGetSettings) {
      throw new Error('desktopAPI.sqliteGetSettings is required on desktop');
    }
    const s = await desktopAPI.sqliteGetSettings();
    if (!s) return undefined;
    try {
      return parseSettings(s);
    } catch (err) {
      console.warn('[TauriSqliteLibraryRepo.getStoredSettings] Malformed settings in SQLite:', err);
      return undefined;
    }
  }

  async saveStoredSettings(settings: Settings): Promise<Settings> {
    const validated = parseSettings(settings);
    if (!desktopAPI.sqliteSaveSettings) {
      throw new Error('desktopAPI.sqliteSaveSettings is required on desktop');
    }
    await desktopAPI.sqliteSaveSettings(validated);
    return validated;
  }

  async exportBackup(): Promise<string> {
    if (desktopAPI.exportBackup) {
      return await desktopAPI.exportBackup();
    }
    const summaries = await this.listLibrary();
    const results = await Promise.all(summaries.map((s) => this.getManga(s.id)));
    const manga = results
      .filter((m): m is Manga => Boolean(m))
      .map(({ handle, cover, ...rest }) => rest);
    const settings = (await this.getStoredSettings()) ?? defaults;
    return JSON.stringify({ version: 2, manga, settings });
  }

  async restoreBackup(backup: { manga: Manga[]; settings: Settings } | string): Promise<Settings> {
    if (!desktopAPI.restoreBackup) {
      throw new Error('desktopAPI.restoreBackup is required on desktop');
    }
    let jsonStr: string;
    if (typeof backup === 'string') {
      jsonStr = backup;
    } else {
      assertAtMost(backup.manga.length, limits.titles, 'Library titles in backup');
      const validatedSettings = parseSettings(backup.settings);
      for (const m of backup.manga) {
        assertMangaLimits(m);
      }
      jsonStr = JSON.stringify({
        version: 2,
        manga: backup.manga,
        settings: validatedSettings,
      });
    }

    const validatedSettings = await desktopAPI.restoreBackup(jsonStr);
    this.invalidateCaches();
    clearDirHandleCache();
    notifyDelete();
    broadcastSync({ type: 'library' });
    return validatedSettings;
  }
}

export type LegacyReadResult =
  | { status: 'unavailable' }
  | { status: 'empty' }
  | { status: 'failed'; error: Error }
  | { status: 'data'; titles: Manga[]; settings?: Settings };

export async function readLegacyIndexedDB(): Promise<LegacyReadResult> {
  if (typeof window === 'undefined' || typeof window.indexedDB === 'undefined') {
    return { status: 'unavailable' };
  }

  return new Promise<LegacyReadResult>((resolve) => {
    let existed = true;
    let req: IDBOpenDBRequest;
    try {
      req = window.indexedDB.open('manga-reader');
    } catch (err) {
      return resolve({
        status: 'failed',
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }

    req.onupgradeneeded = (event) => {
      if (event.oldVersion === 0) {
        existed = false;
        try {
          req.transaction?.abort();
        } catch { }
      }
    };

    req.onerror = () => {
      if (!existed) {
        return resolve({ status: 'empty' });
      }
      return resolve({
        status: 'failed',
        error: req.error ?? new Error('IndexedDB open error'),
      });
    };

    req.onsuccess = () => {
      const db = req.result;
      try {
        if (!db.objectStoreNames.contains('manga')) {
          db.close();
          return resolve({ status: 'empty' });
        }

        const storeNames = ['manga'];
        if (db.objectStoreNames.contains('settings')) {
          storeNames.push('settings');
        }
        if (db.objectStoreNames.contains('progress')) {
          storeNames.push('progress');
        }

        const tx = db.transaction(storeNames, 'readonly');
        const mangaReq = tx.objectStore('manga').getAll();
        const settingsReq = db.objectStoreNames.contains('settings')
          ? tx.objectStore('settings').get('global')
          : null;
        const progressReq = db.objectStoreNames.contains('progress')
          ? tx.objectStore('progress').getAll()
          : null;

        tx.oncomplete = () => {
          db.close();
          try {
            const rawManga = (mangaReq.result || []) as Manga[];
            let settings: Settings | undefined = undefined;
            if (settingsReq?.result) {
              try {
                settings = parseSettings(settingsReq.result);
              } catch { }
            }

            const rawProgress = (progressReq?.result || []) as any[];
            const progressByManga = new Map<string, Map<string, any>>();
            for (const p of rawProgress) {
              if (p && p.mangaId && p.chapter) {
                let m = progressByManga.get(p.mangaId);
                if (!m) {
                  m = new Map();
                  progressByManga.set(p.mangaId, m);
                }
                m.set(p.chapter, p);
              }
            }

            const titles: Manga[] = [];
            for (const item of rawManga) {
              if (!item || typeof item !== 'object') continue;
              const mangaProgress = progressByManga.get(item.id);
              if (mangaProgress && Array.isArray(item.chapters)) {
                for (const ch of item.chapters) {
                  const prog = mangaProgress.get(ch.name);
                  if (prog) {
                    if (prog.read !== undefined) ch.read = prog.read;
                    if (prog.position) ch.position = prog.position;
                    if (prog.bookmarks) ch.bookmarks = prog.bookmarks;
                  }
                }
              }
              titles.push(item);
            }

            if (titles.length === 0 && !settings) {
              return resolve({ status: 'empty' });
            }
            return resolve({ status: 'data', titles, settings });
          } catch (processErr) {
            return resolve({
              status: 'failed',
              error: processErr instanceof Error ? processErr : new Error(String(processErr)),
            });
          }
        };

        tx.onerror = () => {
          db.close();
          return resolve({
            status: 'failed',
            error: tx.error ?? new Error('IndexedDB transaction error'),
          });
        };
      } catch (err) {
        try {
          db.close();
        } catch { }
        return resolve({
          status: 'failed',
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    };
  });
}

export async function ensureLibraryMigrated(idbRepo?: LibraryRepo): Promise<boolean> {
  if (!desktopAPI.isDesktop || !desktopAPI.isLibraryMigrated) {
    return false;
  }
  const alreadyMigrated = await desktopAPI.isLibraryMigrated();
  if (alreadyMigrated) {
    return true;
  }

  let titles: Manga[] = [];
  let settings: Settings | undefined;

  if (idbRepo) {
    try {
      titles = await idbRepo.allManga();
      settings = await idbRepo.getStoredSettings();
    } catch (err) {
      throw new Error(
        `Failed to read from provided migration repo: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  } else {
    const legacyResult = await readLegacyIndexedDB();
    if (legacyResult.status === 'failed') {
      throw new Error(`Legacy IndexedDB migration read failed: ${legacyResult.error.message}`);
    }
    if (legacyResult.status === 'unavailable') {
      console.warn(
        '[ensureLibraryMigrated] IndexedDB unavailable in environment; skipping legacy migration',
      );
      return false;
    }
    if (legacyResult.status === 'data') {
      titles = legacyResult.titles;
      settings = legacyResult.settings;
    }
  }

  if (titles.length === 0 && !settings) {
    if (!desktopAPI.importLegacyLibrary) {
      throw new Error('desktopAPI.importLegacyLibrary is required on desktop');
    }
    await desktopAPI.importLegacyLibrary({ manga: [], settings: {} });
    return true;
  }

  const localPathsById = new Map<string, string>();
  for (const t of titles) {
    if (t && typeof t.id === 'string' && typeof t.localPath === 'string' && t.localPath.trim()) {
      localPathsById.set(t.id.trim(), t.localPath.trim());
    }
  }

  const validated = validateBackup({
    version: 2,
    manga: titles,
    settings: settings ?? {},
  });

  for (const m of validated.manga) {
    const savedLocalPath = localPathsById.get(m.id);
    if (savedLocalPath && !m.localPath) {
      m.localPath = savedLocalPath;
    }
  }

  if (!desktopAPI.importLegacyLibrary) {
    throw new Error('desktopAPI.importLegacyLibrary is required on desktop');
  }
  const ok = await desktopAPI.importLegacyLibrary(validated);
  if (!ok) {
    throw new Error('SQLite legacy library import failed');
  }

  return true;
}