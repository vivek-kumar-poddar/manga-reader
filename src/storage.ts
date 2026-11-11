import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { uniqueSlug } from './paths';
import {
  type Manga,
  type Summary,
  type Position,
  type Page,
  type Progress,
  type Settings,
  defaults,
} from './model';
import { parseSummary, parseManga, parsePosition, parseSettings, isRecord } from './validation';
import {
  limits,
  LimitError,
  assertAtMost,
  assertPathLimits,
  assertMangaLimits,
  withinTime,
} from './limits';
import { desktopAPI } from './tauriBridge';
import { type LibraryRepo, TauriSqliteLibraryRepo, ensureLibraryMigrated } from './repo';

export interface MangaDB extends DBSchema {
  manga: {
    key: string;
    value: Omit<Manga, 'cover'>;
  };
  summaries: {
    key: string;
    value: Summary;
  };
  covers: {
    key: string;
    value: Blob;
  };
  progress: {
    key: [string, string];
    value: {
      mangaId: string;
      chapter: string;
      read: boolean;
      position?: Position;
      bookmarks?: Position[];
    };
    indexes: {
      mangaId: string;
    };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

export type SourceFile = File | FileSystemFileHandle | { getFile(): Promise<File> };

export const sessionFiles = new Map<string, Map<string, SourceFile>>();

export type MangaDeleteListener = (id?: string) => void;
const deleteListeners: MangaDeleteListener[] = [];

export function onMangaDelete(listener: MangaDeleteListener): () => void {
  deleteListeners.push(listener);
  return () => {
    const idx = deleteListeners.indexOf(listener);
    if (idx >= 0) deleteListeners.splice(idx, 1);
  };
}

export function notifyDelete(id?: string) {
  for (const fn of deleteListeners) {
    try {
      fn(id);
    } catch {
      // Ignore listener errors during cleanup
    }
  }
}

export interface StorageSyncMessage {
  type: 'library' | 'progress';
  id?: string;
}

export const syncChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('manga-reader:sync') : null;

export function broadcastSync(msg: StorageSyncMessage): void {
  try {
    syncChannel?.postMessage(msg);
  } catch {
    // Ignore postMessage failure in disconnected or restricted frames
  }
}

let cachedSummaries: Summary[] | null = null;
let cachedBookmarkedMangaIds: Set<string> | null = null;
let cachedMangaBookmarkedIds: Set<string> | null = null;
let bookmarkCachePromise: Promise<void> | null = null;

export function invalidateSummaryCache(): void {
  cachedSummaries = null;
}

export function invalidateBookmarkCache(): void {
  cachedBookmarkedMangaIds = null;
  cachedMangaBookmarkedIds = null;
  bookmarkCachePromise = null;
}

syncChannel?.addEventListener('message', () => {
  cachedSummaries = null;
  invalidateBookmarkCache();
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

export async function migrateV1ToV2(tx: any, _d?: IDBPDatabase<MangaDB>): Promise<void> {
  let cursor = await tx.objectStore('manga').openCursor();
  while (cursor) {
    const m = cursor.value as unknown as Manga;
    await tx.objectStore('summaries').put(summary(m));
    if (m.cover) await tx.objectStore('covers').put(m.cover, m.id);
    for (const c of m.chapters) {
      await tx.objectStore('progress').put({
        mangaId: m.id,
        chapter: c.name,
        read: c.read,
        position: c.position,
        bookmarks: c.bookmarks,
      });
    }
    const { cover: _cover, ...metadata } = m;
    await cursor.update({
      ...metadata,
      chapters: m.chapters.map(({ position: _p, bookmarks: _b, ...c }) => ({
        ...c,
        read: false,
      })),
    });
    cursor = await cursor.continue();
  }
}

export const db: Promise<IDBPDatabase<MangaDB>> =
  typeof indexedDB !== 'undefined'
    ? openDB<MangaDB>('manga-reader', 2, {
        async upgrade(d, old, _new, tx) {
          if (old < 1) {
            d.createObjectStore('manga', { keyPath: 'id' });
            d.createObjectStore('settings');
          }
          if (old < 2) {
            d.createObjectStore('summaries', { keyPath: 'id' });
            d.createObjectStore('covers');
            const p = d.createObjectStore('progress', { keyPath: ['mangaId', 'chapter'] });
            p.createIndex('mangaId', 'mangaId');
            try {
              await migrateV1ToV2(tx, d);
            } catch (err) {
              console.error('[db upgrade] Migration v1->v2 failed, aborting upgrade:', err);
              tx.abort();
              throw err;
            }
          }
        },
        blocking() {
          void db.then((d) => d.close());
        },
        blocked() {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('reader-storage-blocked'));
          }
        },
      })
    : (new Promise(() => {}) as unknown as Promise<IDBPDatabase<MangaDB>>);

export const listLibraryIdb = async (): Promise<Summary[]> => {
  if (cachedSummaries !== null) {
    return cachedSummaries.slice();
  }
  if (typeof indexedDB === 'undefined') {
    return [];
  }
  const database = await db;
  const rawEntries = (await database.getAll('summaries')) as unknown[];
  const entries: Summary[] = [];
  let needsSlugs = false;
  for (const raw of rawEntries) {
    const s = parseSummary(raw, { preserveHardwarePointers: true });
    if (s) {
      if (!s.slug) needsSlugs = true;
      entries.push(s);
    }
  }
  if (needsSlugs) {
    const tx = database.transaction(['manga', 'summaries'], 'readwrite');
    const used = new Set(entries.map((m) => m.slug).filter((s): s is string => Boolean(s)));
    for (const m of entries.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id))) {
      if (!m.slug) {
        m.slug = uniqueSlug(m.title, used);
        used.add(m.slug);
        await tx.objectStore('summaries').put(m);
        const stored = await tx.objectStore('manga').get(m.id);
        if (stored && isRecord(stored)) {
          await tx.objectStore('manga').put({ ...stored, slug: m.slug });
        }
      }
    }
    await tx.done;
    cachedSummaries = null;
    invalidateBookmarkCache();
  }
  entries.sort((a, b) => b.updatedAt - a.updatedAt);
  cachedSummaries = entries;
  return entries.slice();
};

export async function getCoverIdb(id: string): Promise<Blob | undefined> {
  if (desktopAPI.isDesktop && desktopAPI.getThumbnail) {
    try {
      const buf = await desktopAPI.getThumbnail(id);
      if (buf && buf.byteLength > 0) {
        return new Blob([buf], { type: 'image/webp' });
      }
    } catch (err) {
      console.warn(`[getCover] Failed to read native thumbnail for "${id}":`, err);
    }
  }

  // Fallback to IndexedDB
  if (typeof indexedDB === 'undefined') {
    return undefined;
  }

  try {
    const d = await db;
    const blob = await d.get('covers', id);
    if (blob instanceof Blob) {
      if (desktopAPI.isDesktop && desktopAPI.saveThumbnail) {
        void blob
          .arrayBuffer()
          .then((ab) => desktopAPI.saveThumbnail?.(id, ab))
          .catch(() => {});
      }
      return blob;
    }
  } catch (err) {
    console.warn(`[getCover] Failed to read IndexedDB cover for "${id}":`, err);
  }
  return undefined;
}

export async function getMangaIdb(id: string): Promise<Manga | undefined> {
  const d = await db;
  const raw = await d.get('manga', id);
  if (!raw) return undefined;
  let m: Manga;
  try {
    m = parseManga(raw);
  } catch (err) {
    console.warn(`[getManga] Malformed metadata for title "${id}":`, err);
    return undefined;
  }
  const [entries, s, cover] = await Promise.all([
    d.getAllFromIndex('progress', 'mangaId', id),
    d.get('summaries', id),
    getCoverIdb(id),
  ]);
  const byName = new Map(
    (entries as Progress[])
      .filter((p) => p && typeof p.chapter === 'string')
      .map((p) => [p.chapter, p]),
  );
  return {
    ...m,
    cover: cover instanceof Blob ? cover : m.cover,
    lastChapter: s && Number.isInteger(s.lastChapter) ? s.lastChapter : m.lastChapter,
    updatedAt: m.updatedAt,
    chapters: m.chapters.map((c) => {
      const p = byName.get(c.name);
      return {
        ...c,
        read: typeof p?.read === 'boolean' ? p.read : c.read,
        position: p?.position ? parsePosition(p.position, c.pages) : undefined,
        bookmarks: Array.isArray(p?.bookmarks)
          ? p.bookmarks
              .map((bm) => parsePosition(bm, c.pages))
              .filter((bm): bm is Position => Boolean(bm))
          : c.bookmarks || [],
      };
    }),
  };
}

export async function allMangaIdb(): Promise<Manga[]> {
  return (await Promise.all((await listLibraryIdb()).map((m) => getMangaIdb(m.id)))).filter(
    (m): m is Manga => Boolean(m),
  );
}

export async function saveMangaIdb(m: Manga): Promise<void> {
  assertMangaLimits(m);
  const updatedAt = Date.now();
  const tx = (await db).transaction(['manga', 'summaries', 'progress', 'covers'], 'readwrite');
  const existing = (await tx.objectStore('summaries').get(m.id)) as Summary | undefined;
  if (!existing && (await tx.objectStore('summaries').count()) >= limits.titles) {
    tx.abort();
    await tx.done.catch(() => {}); // Expected rejection from our explicit abort.
    throw new LimitError(
      `Library title limit is ${limits.titles}. Remove a title before importing.`,
    );
  }
  const revision = (existing?.revision ?? 0) + 1;
  const entries = (await tx.objectStore('summaries').getAll()) as Summary[];
  const slug =
    existing?.slug ||
    uniqueSlug(m.title, new Set(entries.filter((x) => x.id !== m.id).map((x) => x.slug || '')));
  const { cover, ...metadata } = m;
  await tx.objectStore('manga').put({
    ...metadata,
    updatedAt,
    revision,
    slug,
    chapters: m.chapters.map(({ position: _p, bookmarks: _b, ...c }) => ({ ...c, read: false })),
  });
  await tx.objectStore('summaries').put(summary({ ...m, updatedAt, revision, slug }));
  if (cover) await tx.objectStore('covers').put(cover, m.id);
  const progressStore = tx.objectStore('progress');
  const keys = await progressStore.index('mangaId').getAllKeys(m.id);
  await Promise.all(keys.map((k) => progressStore.delete(k)));
  await Promise.all(
    m.chapters.map((c) =>
      progressStore.put({
        mangaId: m.id,
        chapter: c.name,
        read: c.read,
        position: c.position,
        bookmarks: c.bookmarks,
      }),
    ),
  );
  await tx.done;
  m.updatedAt = updatedAt;
  m.revision = revision;
  m.slug = slug;
  cachedSummaries = null;
  invalidateBookmarkCache();
  clearDirHandleCache(m.id);

  if (cover && desktopAPI.isDesktop && desktopAPI.saveThumbnail) {
    try {
      const buffer = await cover.arrayBuffer();
      await desktopAPI.saveThumbnail(m.id, buffer);
    } catch (err) {
      console.warn(`[saveManga] Failed to cache thumbnail to disk for "${m.id}":`, err);
    }
  }

  broadcastSync({ type: 'library', id: m.id });
}

export type SaveProgressResult = 'saved' | 'stale' | 'missing';

export async function saveProgressIdb(
  m: Manga,
  index: number,
  position: Position,
  read: boolean,
  bookmarks?: Position[],
  updateLast = true,
): Promise<SaveProgressResult> {
  const chapter = m.chapters[index];
  if (!chapter) return 'missing';
  if (bookmarks)
    assertAtMost(bookmarks.length, limits.bookmarksPerChapter, 'Bookmarks per chapter');
  const tx = (await db).transaction(['progress', 'summaries'], 'readwrite');
  const s = (await tx.objectStore('summaries').get(m.id)) as Summary | undefined;
  if (!s) {
    await tx.done;
    return 'missing';
  }
  if (s.indexedAt !== m.updatedAt || (m.revision && s.revision && s.revision !== m.revision)) {
    await tx.done;
    return 'stale';
  }
  const key: [string, string] = [m.id, chapter.name];
  const old = (await tx.objectStore('progress').get(key)) as Progress | undefined;
  const isRead = Boolean(old?.read || read);
  await tx.objectStore('progress').put({
    mangaId: m.id,
    chapter: chapter.name,
    read: isRead,
    position,
    bookmarks: bookmarks ?? old?.bookmarks ?? [],
  });
  await tx.objectStore('summaries').put({
    ...s,
    ...(updateLast
      ? {
          lastChapter: index,
          lastChapterName: chapter.name,
          hasProgress: true,
          updatedAt: Date.now(),
        }
      : {}),
    chaptersRead: s.chaptersRead + (!old?.read && isRead ? 1 : 0),
  });
  await tx.done;
  if (cachedSummaries) {
    const idx = cachedSummaries.findIndex((x) => x.id === m.id);
    if (idx >= 0) {
      const cur = cachedSummaries[idx];
      cachedSummaries[idx] = {
        ...cur,
        ...(updateLast
          ? {
              lastChapter: index,
              lastChapterName: chapter.name,
              hasProgress: true,
              updatedAt: Date.now(),
            }
          : {}),
        chaptersRead: cur.chaptersRead + (!old?.read && isRead ? 1 : 0),
      };
      cachedSummaries.sort((a, b) => b.updatedAt - a.updatedAt);
    } else {
      cachedSummaries = null;
    }
  }
  if (bookmarks) {
    invalidateBookmarkCache();
  }
  broadcastSync({ type: 'progress', id: m.id });
  return 'saved';
}

async function ensureBookmarkCaches(): Promise<void> {
  if (cachedBookmarkedMangaIds && cachedMangaBookmarkedIds) {
    return;
  }
  if (bookmarkCachePromise) {
    return bookmarkCachePromise;
  }
  bookmarkCachePromise = (async () => {
    try {
      if (typeof indexedDB === 'undefined') {
        cachedBookmarkedMangaIds = new Set();
        cachedMangaBookmarkedIds = new Set();
        return;
      }
      const d = await db;
      const progress = await d.getAll('progress');
      const allBookmarked = new Set<string>();
      const mangaBookmarked = new Set<string>();

      for (const p of progress) {
        if (!p.bookmarks || p.bookmarks.length === 0) continue;
        allBookmarked.add(p.mangaId);
        for (const b of p.bookmarks) {
          if (b.mangaBookmark) {
            mangaBookmarked.add(p.mangaId);
            break;
          }
        }
      }

      cachedBookmarkedMangaIds = allBookmarked;
      cachedMangaBookmarkedIds = mangaBookmarked;
    } finally {
      bookmarkCachePromise = null;
    }
  })();
  return bookmarkCachePromise;
}

export async function getBookmarkedMangaIdsIdb(): Promise<Set<string>> {
  await ensureBookmarkCaches();
  return new Set(cachedBookmarkedMangaIds ?? []);
}

export async function getMangaBookmarkedIdsIdb(): Promise<Set<string>> {
  await ensureBookmarkCaches();
  return new Set(cachedMangaBookmarkedIds ?? []);
}

export async function addBookmarkIdb(
  mangaId: string,
  chapterName: string,
  position: Position,
): Promise<Position[]> {
  const database = await db;
  const tx = database.transaction('progress', 'readwrite');
  const key: [string, string] = [mangaId, chapterName];
  const old = (await tx.store.get(key)) as Progress | undefined;
  const marks = Array.isArray(old?.bookmarks) ? [...old.bookmarks] : [];

  const exists = marks.some((p) => {
    if (position.mangaBookmark) {
      return Boolean(p.mangaBookmark);
    }
    return position.path ? p.path === position.path : p.page === position.page;
  });

  if (!exists) {
    assertAtMost(marks.length + 1, limits.bookmarksPerChapter, 'Bookmarks per chapter');
    marks.push(position);
    await tx.store.put({
      mangaId,
      chapter: chapterName,
      read: Boolean(old?.read),
      position: old?.position,
      bookmarks: marks,
    });
  }

  await tx.done;
  invalidateBookmarkCache();
  broadcastSync({ type: 'progress', id: mangaId });
  return marks;
}

export async function removeBookmarkIdb(
  mangaId: string,
  chapterName: string,
  position: Position,
): Promise<Position[]> {
  const database = await db;
  const tx = database.transaction('progress', 'readwrite');
  const key: [string, string] = [mangaId, chapterName];
  const old = (await tx.store.get(key)) as Progress | undefined;
  const marks = (old?.bookmarks || []).filter((p: Position) => {
    if (position.mangaBookmark) {
      return !p.mangaBookmark;
    }
    if (p.mangaBookmark) {
      return true;
    }
    return position.path ? p.path !== position.path : p.page !== position.page;
  });

  if (old) {
    await tx.store.put({
      ...old,
      bookmarks: marks,
    });
  }

  await tx.done;
  invalidateBookmarkCache();
  broadcastSync({ type: 'progress', id: mangaId });
  return marks;
}

export async function deleteMangaIdb(id: string): Promise<void> {
  notifyDelete(id);
  const tx = (await db).transaction(['manga', 'summaries', 'covers', 'progress'], 'readwrite');
  const progressStore = tx.objectStore('progress');
  const keys = await progressStore.index('mangaId').getAllKeys(id);
  await Promise.all([
    tx.objectStore('manga').delete(id),
    tx.objectStore('summaries').delete(id),
    tx.objectStore('covers').delete(id),
    ...keys.map((k) => progressStore.delete(k)),
  ]);
  await tx.done;
  cachedSummaries = null;
  invalidateBookmarkCache();
  clearDirHandleCache(id);
  sessionFiles.delete(id);
  if (desktopAPI.isDesktop && desktopAPI.deleteThumbnail) {
    desktopAPI.deleteThumbnail(id).catch((err) => {
      console.warn(`[deleteManga] Failed to delete thumbnail from disk for "${id}":`, err);
    });
  }
  broadcastSync({ type: 'library', id });
}

export async function clearLibraryIdb(): Promise<void> {
  notifyDelete(undefined);
  const tx = (await db).transaction(['manga', 'summaries', 'covers', 'progress'], 'readwrite');
  await Promise.all(
    (['manga', 'summaries', 'covers', 'progress'] as const).map((name) =>
      tx.objectStore(name).clear(),
    ),
  );
  await tx.done;
  cachedSummaries = [];
  invalidateBookmarkCache();
  clearDirHandleCache();
  sessionFiles.clear();
  if (desktopAPI.isDesktop && desktopAPI.clearThumbnails) {
    desktopAPI.clearThumbnails().catch((err) => {
      console.warn(`[clearLibrary] Failed to clear disk thumbnails:`, err);
    });
  }
  broadcastSync({ type: 'library' });
}

let isRestoring = false;

export async function restoreBackupIdb(backup: {
  manga: Manga[];
  settings: Settings;
}): Promise<Settings> {
  if (isRestoring) {
    throw new Error('Another restore operation is already in progress.');
  }
  isRestoring = true;
  try {
    assertAtMost(backup.manga.length, limits.titles, 'Library titles in backup');
    const validatedSettings = parseSettings(backup.settings);

    for (const m of backup.manga) {
      assertMangaLimits(m);
    }

    const database = await db;

    // Read existing handles, local paths, and covers to preserve them
    const existingManga = new Map<string, Manga>();
    for (const m of backup.manga) {
      const existing = await getMangaIdb(m.id);
      if (existing) {
        existingManga.set(m.id, existing);
      }
    }

    const now = Date.now();
    const usedSlugs = new Set<string>();
    const preparedList: {
      manga: Omit<Manga, 'cover'>;
      summary: Summary;
      coverBlob?: Blob;
      progress: {
        mangaId: string;
        chapter: string;
        read: boolean;
        position?: Position;
        bookmarks?: Position[];
      }[];
    }[] = [];

    for (const raw of backup.manga) {
      const old = existingManga.get(raw.id);
      const handle = old?.handle;
      const localPath = old?.localPath;
      const coverBlob = old?.cover;

      const slug = old?.slug || uniqueSlug(raw.title, usedSlugs);
      usedSlugs.add(slug);

      const m: Manga = {
        ...raw,
        handle,
        localPath,
        slug,
        updatedAt: now,
      };

      const { cover: _c, ...metadata } = m;
      const mangaRecord = {
        ...metadata,
        updatedAt: now,
        slug,
        chapters: m.chapters.map(({ position: _p, bookmarks: _b, ...c }) => ({
          ...c,
          read: false,
        })),
      };

      const summaryRecord = summary(m);

      const progressRecords = m.chapters.map((c) => ({
        mangaId: m.id,
        chapter: c.name,
        read: Boolean(c.read),
        position: c.position,
        bookmarks: c.bookmarks,
      }));

      preparedList.push({
        manga: mangaRecord,
        summary: summaryRecord,
        coverBlob,
        progress: progressRecords,
      });
    }

    // Atomic transaction across all 5 stores: manga, summaries, covers, progress, settings
    const tx = database.transaction(
      ['manga', 'summaries', 'covers', 'progress', 'settings'],
      'readwrite',
    );

    try {
      for (const item of preparedList) {
        await tx.objectStore('manga').put(item.manga);
        await tx.objectStore('summaries').put(item.summary);
        if (item.coverBlob) {
          await tx.objectStore('covers').put(item.coverBlob, item.manga.id);
        }
        const progressStore = tx.objectStore('progress');
        const oldKeys = await progressStore.index('mangaId').getAllKeys(item.manga.id);
        await Promise.all(oldKeys.map((k) => progressStore.delete(k)));
        await Promise.all(item.progress.map((p) => progressStore.put(p)));
      }

      await tx.objectStore('settings').put(validatedSettings, 'global');
      await tx.done;
      cachedSummaries = null;
      invalidateBookmarkCache();
      clearDirHandleCache();

      if (desktopAPI.isDesktop && desktopAPI.saveThumbnail) {
        for (const item of preparedList) {
          if (item.coverBlob) {
            try {
              const buffer = await item.coverBlob.arrayBuffer();
              await desktopAPI.saveThumbnail(item.manga.id, buffer);
            } catch (err) {
              console.warn(
                `[restoreBackup] Failed to cache thumbnail to disk for "${item.manga.id}":`,
                err,
              );
            }
          }
        }
      }
    } catch (err) {
      try {
        tx.abort();
      } catch {}
      throw err;
    }

    return validatedSettings;
  } finally {
    isRestoring = false;
  }
}

export async function resetProgressIdb(): Promise<void> {
  const database = await db;
  const tx = database.transaction(['progress', 'summaries'], 'readwrite');
  try {
    let cursor = await tx.objectStore('progress').openCursor();
    while (cursor) {
      const p = cursor.value;
      if (p.read || p.position) {
        await cursor.update({
          ...p,
          read: false,
          position: undefined,
        });
      }
      cursor = await cursor.continue();
    }

    let sCursor = await tx.objectStore('summaries').openCursor();
    while (sCursor) {
      const s = sCursor.value;
      await sCursor.update({
        ...s,
        chaptersRead: 0,
        lastChapter: 0,
        hasProgress: false,
      });
      sCursor = await sCursor.continue();
    }

    await tx.done;
    cachedSummaries = null;
    invalidateBookmarkCache();
  } catch (err) {
    try {
      tx.abort();
    } catch {}
    throw err;
  }
}

export async function getStoredSettingsIdb(): Promise<Settings | undefined> {
  const d = await db;
  const raw = await d.get('settings', 'global');
  return raw ? parseSettings(raw) : undefined;
}

export async function saveStoredSettingsIdb(settings: Settings): Promise<Settings> {
  const validated = parseSettings(settings);
  const d = await db;
  await d.put('settings', validated, 'global');
  return validated;
}

export class IndexedDBLibraryRepo implements LibraryRepo {
  listLibrary(): Promise<Summary[]> {
    return listLibraryIdb();
  }
  getManga(id: string): Promise<Manga | undefined> {
    return getMangaIdb(id);
  }
  getCover(id: string): Promise<Blob | undefined> {
    return getCoverIdb(id);
  }
  allManga(): Promise<Manga[]> {
    return allMangaIdb();
  }
  saveManga(m: Manga): Promise<void> {
    return saveMangaIdb(m);
  }
  saveProgress(
    m: Manga,
    index: number,
    position: Position,
    read: boolean,
    bookmarks?: Position[],
    updateLast = true,
  ): Promise<SaveProgressResult> {
    return saveProgressIdb(m, index, position, read, bookmarks, updateLast);
  }
  getBookmarkedMangaIds(): Promise<Set<string>> {
    return getBookmarkedMangaIdsIdb();
  }
  getMangaBookmarkedIds(): Promise<Set<string>> {
    return getMangaBookmarkedIdsIdb();
  }
  addBookmark(mangaId: string, chapterName: string, position: Position): Promise<Position[]> {
    return addBookmarkIdb(mangaId, chapterName, position);
  }
  removeBookmark(mangaId: string, chapterName: string, position: Position): Promise<Position[]> {
    return removeBookmarkIdb(mangaId, chapterName, position);
  }
  deleteManga(id: string): Promise<void> {
    return deleteMangaIdb(id);
  }
  clearLibrary(): Promise<void> {
    return clearLibraryIdb();
  }
  resetProgress(): Promise<void> {
    return resetProgressIdb();
  }
  getStoredSettings(): Promise<Settings | undefined> {
    return getStoredSettingsIdb();
  }
  saveStoredSettings(settings: Settings): Promise<Settings> {
    return saveStoredSettingsIdb(settings);
  }
  async exportBackup(): Promise<string> {
    const list = await this.allManga();
    const manga = list.map(({ handle, cover, ...rest }) => rest);
    const settings = (await this.getStoredSettings()) ?? defaults;
    return JSON.stringify({ version: 2, manga, settings });
  }
  restoreBackup(backup: { manga: Manga[]; settings: Settings } | string): Promise<Settings> {
    const payload = typeof backup === 'string' ? JSON.parse(backup) : backup;
    return restoreBackupIdb(payload);
  }
}

let activeRepo: LibraryRepo = desktopAPI.isDesktop
  ? new TauriSqliteLibraryRepo()
  : new IndexedDBLibraryRepo();

export function setRepo(newRepo: LibraryRepo): void {
  activeRepo = newRepo;
}

export function getRepo(): LibraryRepo {
  return activeRepo;
}

export const repo: LibraryRepo = {
  listLibrary: () => activeRepo.listLibrary(),
  getManga: (id) => activeRepo.getManga(id),
  getCover: (id) => activeRepo.getCover(id),
  allManga: () => activeRepo.allManga(),
  saveManga: (m) => activeRepo.saveManga(m),
  saveProgress: (m, index, position, read, bookmarks, updateLast) =>
    activeRepo.saveProgress(m, index, position, read, bookmarks, updateLast),
  getBookmarkedMangaIds: () => activeRepo.getBookmarkedMangaIds(),
  getMangaBookmarkedIds: () => activeRepo.getMangaBookmarkedIds(),
  addBookmark: (mangaId, chapterName, position) =>
    activeRepo.addBookmark(mangaId, chapterName, position),
  removeBookmark: (mangaId, chapterName, position) =>
    activeRepo.removeBookmark(mangaId, chapterName, position),
  deleteManga: (id) => activeRepo.deleteManga(id),
  clearLibrary: () => activeRepo.clearLibrary(),
  resetProgress: () => activeRepo.resetProgress(),
  getStoredSettings: () => activeRepo.getStoredSettings(),
  saveStoredSettings: (s) => activeRepo.saveStoredSettings(s),
  exportBackup: () => (activeRepo.exportBackup ? activeRepo.exportBackup() : Promise.resolve('')),
  restoreBackup: (b) => activeRepo.restoreBackup(b),
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
  activeRepo.exportBackup ? activeRepo.exportBackup() : '';
export const restoreBackup = async (
  backup: { manga: Manga[]; settings: Settings } | string,
): Promise<Settings> => repo.restoreBackup(backup);

export { type LibraryRepo, TauriSqliteLibraryRepo, ensureLibraryMigrated } from './repo';

export function errorMessage(e: unknown): string {
  const err = e as { name?: string; message?: string };
  if (err?.name === 'QuotaExceededError')
    return 'Browser storage is full. Export a backup and remove unused library entries before retrying.';
  if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError')
    return 'Folder permission was denied. Re-link the folder or use standard file selection.';
  if (err?.name === 'NotFoundError')
    return 'A file or folder moved or disappeared. Re-link the folder to update its index.';
  if (err?.name === 'InvalidStateError')
    return 'Storage is unavailable or another tab is upgrading it. Close other Reader tabs and reopen.';
  return err?.message || 'The operation could not complete. Please try again.';
}

const readFile = (f: SourceFile): Promise<File> =>
  withinTime(
    f instanceof File ? Promise.resolve(f) : f.getFile(),
    limits.ioTimeoutMs,
    'Reading file',
  );

const MAX_CACHED_DIR_HANDLES = 500;
export const dirHandleCache = new Map<string, FileSystemDirectoryHandle>();

export const ACCESS_CACHE_TTL_MS = 7500;

export interface AccessCacheEntry {
  granted: boolean;
  timestamp: number;
}

export const accessCache = new Map<string, AccessCacheEntry>();
const accessInFlight = new Map<string, Promise<boolean>>();

export function clearAccessCache(mangaId?: string): void {
  if (mangaId) {
    accessCache.delete(mangaId);
    accessInFlight.delete(mangaId);
  } else {
    accessCache.clear();
    accessInFlight.clear();
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
  assertPathLimits(p.path);
  // Desktop: read directly from the filesystem via IPC — works across restarts.
  if (desktopAPI.isDesktop && m.localPath) {
    const sep = m.localPath.includes('\\') ? '\\' : '/';
    const absPath = m.localPath + sep + p.path.split('/').join(sep);
    const buf = await withinTime(desktopAPI.readFile(absPath), limits.ioTimeoutMs, 'Reading file');
    if (!buf) throw new Error('File not found on disk. The folder may have moved.');
    return new File([buf], p.path.split('/').at(-1) ?? p.path);
  }
  if (m.handle) {
    const parts = p.path.split('/');
    const dirParts = parts.slice(0, -1);
    const dirPath = dirParts.join('/');
    const cacheKey = `${m.id}:${m.updatedAt}:${dirPath}`;

    let h: FileSystemDirectoryHandle | undefined =
      dirParts.length === 0 ? m.handle : dirHandleCache.get(cacheKey);

    try {
      if (!h) {
        h = m.handle;
        let subPath = '';
        for (const part of dirParts) {
          subPath = subPath ? `${subPath}/${part}` : part;
          const subKey = `${m.id}:${m.updatedAt}:${subPath}`;
          let subHandle = dirHandleCache.get(subKey);
          if (!subHandle) {
            subHandle = await withinTime(
              h.getDirectoryHandle(part),
              limits.ioTimeoutMs,
              'Opening folder',
            );
            if (dirHandleCache.size >= MAX_CACHED_DIR_HANDLES) {
              const oldest = dirHandleCache.keys().next().value;
              if (oldest) dirHandleCache.delete(oldest);
            }
            dirHandleCache.set(subKey, subHandle);
          }
          h = subHandle;
        }
        if (dirHandleCache.size >= MAX_CACHED_DIR_HANDLES) {
          const oldest = dirHandleCache.keys().next().value;
          if (oldest) dirHandleCache.delete(oldest);
        }
        dirHandleCache.set(cacheKey, h);
      }
      const handle = await withinTime(
        h.getFileHandle(parts.at(-1)!),
        limits.ioTimeoutMs,
        'Opening file',
      );
      return await readFile(handle);
    } catch (err) {
      clearDirHandleCache(m.id);
      throw err;
    }
  }
  const f = sessionFiles.get(m.id)?.get(p.path);
  if (!f) throw new Error('Folder access is needed. Re-link your folder to continue.');
  return readFile(f);
}

export async function access(
  m: Pick<Manga, 'id' | 'handle' | 'localPath'>,
  request = false,
): Promise<boolean> {
  // Desktop: local files are always accessible via IPC; no permission model needed.
  if (desktopAPI.isDesktop) {
    if (m.localPath) return true;
    if (sessionFiles.has(m.id)) return true;
    const full = await getManga(m.id);
    return Boolean(full?.localPath || sessionFiles.has(m.id));
  }

  // In-memory session files are always accessible without querying handle permissions.
  if (sessionFiles.has(m.id)) {
    return true;
  }

  // Passive access checks (request=false) reuse cached permission status within TTL
  // to avoid bursts of File System Access API queries when alt-tabbing or window refocusing.
  const now = Date.now();
  if (!request) {
    const cached = accessCache.get(m.id);
    if (cached && now - cached.timestamp < ACCESS_CACHE_TTL_MS) {
      return cached.granted;
    }
    const inFlight = accessInFlight.get(m.id);
    if (inFlight) {
      return inFlight;
    }
  }

  const queryOrRequest = async (): Promise<boolean> => {
    let handle = m.handle;
    if (!handle) {
      if (sessionFiles.has(m.id)) return true;
      const full = await getManga(m.id);
      handle = full?.handle;
    }
    if (!handle) return sessionFiles.has(m.id);
    try {
      const res = await withinTime(
        request
          ? handle.requestPermission({ mode: 'read' })
          : handle.queryPermission({ mode: 'read' }),
        limits.ioTimeoutMs,
        'Checking folder access',
      );
      return res === 'granted';
    } catch {
      return false;
    }
  };

  if (request) {
    accessInFlight.delete(m.id);
    const granted = await queryOrRequest();
    accessCache.set(m.id, { granted, timestamp: Date.now() });
    return granted;
  }

  const task = queryOrRequest();
  accessInFlight.set(m.id, task);
  try {
    const granted = await task;
    accessCache.set(m.id, { granted, timestamp: Date.now() });
    return granted;
  } finally {
    accessInFlight.delete(m.id);
  }
}
