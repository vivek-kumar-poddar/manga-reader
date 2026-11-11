import { type Manga, type Summary, type Position, type Settings, defaults } from './model';
import { parseSettings, validateBackup } from './validation';
import { assertMangaLimits, assertAtMost, limits } from './limits';
import { uniqueSlug } from './paths';
import { desktopAPI } from './tauriBridge';
import {
  type SaveProgressResult,
  broadcastSync,
  notifyDelete,
  invalidateSummaryCache,
  invalidateBookmarkCache,
  db,
  IndexedDBLibraryRepo,
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
}

export class TauriSqliteLibraryRepo implements LibraryRepo {
  private cachedSummaries: Summary[] | null = null;
  private cachedAllBookmarkedIds: Set<string> | null = null;
  private cachedMangaBookmarkedIds: Set<string> | null = null;
  private bookmarkCachePromise: Promise<void> | null = null;

  invalidateCaches(): void {
    this.cachedSummaries = null;
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    this.bookmarkCachePromise = null;
    invalidateSummaryCache();
    invalidateBookmarkCache();
  }

  async listLibrary(): Promise<Summary[]> {
    if (this.cachedSummaries) {
      return this.cachedSummaries.slice();
    }
    let entries: Summary[] = [];
    if (desktopAPI.sqliteListLibrary) {
      entries = await desktopAPI.sqliteListLibrary();
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    this.cachedSummaries = entries;
    return entries.slice();
  }

  async getManga(id: string): Promise<Manga | undefined> {
    if (!desktopAPI.sqliteGetManga) return undefined;
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
              .catch(() => {});
          }
          return blob;
        }
      }
    } catch {
      // IndexedDB covers fallback miss
    }
    return undefined;
  }

  async allManga(): Promise<Manga[]> {
    const summaries = await this.listLibrary();
    const results = await Promise.all(summaries.map((s) => this.getManga(s.id)));
    return results.filter((m): m is Manga => Boolean(m));
  }

  async saveManga(manga: Manga): Promise<void> {
    assertMangaLimits(manga);
    const revision = (manga.revision ?? 0) + 1;
    const now = Date.now();
    const m: Manga = {
      ...manga,
      revision,
      updatedAt: now,
      slug: manga.slug || uniqueSlug(manga.title, new Set()),
    };
    if (desktopAPI.sqliteSaveManga) {
      await desktopAPI.sqliteSaveManga(m);
    }
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
      return 'missing';
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
      this.bookmarkCachePromise = (async () => {
        try {
          if (desktopAPI.sqliteGetBookmarkedMangaIds) {
            const { allBookmarkedIds, mangaBookmarkedIds } =
              await desktopAPI.sqliteGetBookmarkedMangaIds();
            this.cachedAllBookmarkedIds = new Set(allBookmarkedIds);
            this.cachedMangaBookmarkedIds = new Set(mangaBookmarkedIds);
          } else {
            this.cachedAllBookmarkedIds = new Set();
            this.cachedMangaBookmarkedIds = new Set();
          }
        } finally {
          this.bookmarkCachePromise = null;
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
    if (!desktopAPI.sqliteAddBookmark) return [];
    const res = await desktopAPI.sqliteAddBookmark({
      mangaId,
      chapterName,
      position,
    });
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    invalidateBookmarkCache();
    broadcastSync({ type: 'progress', id: mangaId });
    return res;
  }

  async removeBookmark(
    mangaId: string,
    chapterName: string,
    position: Position,
  ): Promise<Position[]> {
    if (!desktopAPI.sqliteRemoveBookmark) return [];
    const res = await desktopAPI.sqliteRemoveBookmark({
      mangaId,
      chapterName,
      position,
    });
    this.cachedAllBookmarkedIds = null;
    this.cachedMangaBookmarkedIds = null;
    invalidateBookmarkCache();
    broadcastSync({ type: 'progress', id: mangaId });
    return res;
  }

  async deleteManga(id: string): Promise<void> {
    if (desktopAPI.sqliteDeleteManga) {
      await desktopAPI.sqliteDeleteManga(id);
    }
    if (desktopAPI.deleteThumbnail) {
      void desktopAPI.deleteThumbnail(id).catch(() => {});
    }
    this.invalidateCaches();
    notifyDelete(id);
    broadcastSync({ type: 'library', id });
  }

  async clearLibrary(): Promise<void> {
    if (desktopAPI.sqliteClearLibrary) {
      await desktopAPI.sqliteClearLibrary();
    }
    if (desktopAPI.clearThumbnails) {
      void desktopAPI.clearThumbnails().catch(() => {});
    }
    this.invalidateCaches();
    notifyDelete();
    broadcastSync({ type: 'library' });
  }

  async resetProgress(): Promise<void> {
    if (desktopAPI.sqliteResetProgress) {
      await desktopAPI.sqliteResetProgress();
    }
    this.invalidateCaches();
    broadcastSync({ type: 'progress' });
  }

  async getStoredSettings(): Promise<Settings | undefined> {
    if (!desktopAPI.sqliteGetSettings) return undefined;
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
    if (desktopAPI.sqliteSaveSettings) {
      await desktopAPI.sqliteSaveSettings(validated);
    }
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
    if (typeof backup === 'string') {
      if (desktopAPI.restoreBackup) {
        const validatedSettings = await desktopAPI.restoreBackup(backup);
        this.invalidateCaches();
        notifyDelete();
        broadcastSync({ type: 'library' });
        return validatedSettings;
      }
      backup = JSON.parse(backup);
    }

    if (desktopAPI.restoreBackup) {
      const jsonStr = JSON.stringify({
        version: 2,
        manga: (backup as { manga: Manga[]; settings: Settings }).manga,
        settings: (backup as { manga: Manga[]; settings: Settings }).settings,
      });
      const validatedSettings = await desktopAPI.restoreBackup(jsonStr);
      this.invalidateCaches();
      notifyDelete();
      broadcastSync({ type: 'library' });
      return validatedSettings;
    }

    const payload = backup as { manga: Manga[]; settings: Settings };
    assertAtMost(payload.manga.length, limits.titles, 'Library titles in backup');
    const validatedSettings = parseSettings(payload.settings);
    for (const m of payload.manga) {
      assertMangaLimits(m);
    }
    const existing = new Map<string, Manga>();
    for (const m of payload.manga) {
      const ex = await this.getManga(m.id);
      if (ex) existing.set(m.id, ex);
    }
    const preparedManga: Manga[] = payload.manga.map((m) => {
      const ex = existing.get(m.id);
      return {
        ...m,
        localPath: ex?.localPath ?? m.localPath,
        slug: ex?.slug ?? m.slug,
      };
    });

    if (desktopAPI.sqliteClearLibrary) {
      await desktopAPI.sqliteClearLibrary();
    }
    if (desktopAPI.importLegacyLibrary) {
      await desktopAPI.importLegacyLibrary({
        manga: preparedManga,
        settings: validatedSettings,
      });
    }
    if (desktopAPI.saveThumbnail) {
      for (const m of payload.manga) {
        if (m.cover instanceof Blob) {
          try {
            const ab = await m.cover.arrayBuffer();
            await desktopAPI.saveThumbnail(m.id, ab);
          } catch (err) {
            console.warn('[restoreBackup] Thumbnail cache failed for', m.id, err);
          }
        }
      }
    }
    this.invalidateCaches();
    notifyDelete();
    broadcastSync({ type: 'library' });
    return validatedSettings;
  }
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

  let sourceRepo = idbRepo;
  if (!sourceRepo) {
    sourceRepo = new IndexedDBLibraryRepo();
  }

  if (sourceRepo) {
    try {
      titles = await sourceRepo.allManga();
      settings = await sourceRepo.getStoredSettings();
    } catch (err) {
      console.warn('[ensureLibraryMigrated] Failed to read from provided IDB repo:', err);
    }
  }

  if (titles.length === 0 && !settings) {
    if (desktopAPI.importLegacyLibrary) {
      await desktopAPI.importLegacyLibrary({ manga: [], settings: {} });
    }
    return true;
  }

  const validated = validateBackup({
    version: 2,
    manga: titles,
    settings: settings ?? {},
  });

  if (desktopAPI.importLegacyLibrary) {
    const ok = await desktopAPI.importLegacyLibrary(validated);
    if (!ok) {
      throw new Error('SQLite legacy library import failed');
    }
  }

  invalidateSummaryCache();
  invalidateBookmarkCache();
  return true;
}
