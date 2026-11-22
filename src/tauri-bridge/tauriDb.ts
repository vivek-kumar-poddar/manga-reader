import { invokeCommand } from './runtime';
import type { Manga, Summary, Position, Settings, Page } from '../model';
import type { BookmarkCardsQuery, BookmarkCardsResult } from './types';

export async function isLibraryMigrated(): Promise<boolean> {
  try {
    return await invokeCommand('is_library_migrated');
  } catch (err) {
    console.warn('Tauri isLibraryMigrated failed:', err);
    return false;
  }
}

export async function importLegacyLibrary(payload: unknown): Promise<boolean> {
  try {
    return await invokeCommand('import_legacy_library', { payload });
  } catch (err) {
    console.warn('Tauri importLegacyLibrary failed:', err);
    return false;
  }
}

export async function sqliteListLibrary(): Promise<Summary[]> {
  try {
    const records = await invokeCommand('sqlite_list_library');
    return Array.isArray(records) ? records : [];
  } catch (err) {
    console.warn('Tauri sqliteListLibrary failed:', err);
    return [];
  }
}

export async function sqliteGetManga(id: string): Promise<Manga | undefined> {
  try {
    const record = await invokeCommand('sqlite_get_manga', { id });
    return record ?? undefined;
  } catch (err) {
    console.warn('Tauri sqliteGetManga failed for', id, err);
    return undefined;
  }
}

export async function sqliteSaveManga(manga: Manga): Promise<void> {
  await invokeCommand('sqlite_save_manga', { manga });
}

export async function sqliteSaveProgress(params: {
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

export async function sqliteAddBookmark(params: {
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

export async function sqliteRemoveBookmark(params: {
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

export async function sqliteGetBookmarkedMangaIds(): Promise<{
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

export async function getBookmarkCards(
  query: BookmarkCardsQuery = {},
): Promise<BookmarkCardsResult> {
  try {
    return await invokeCommand('get_bookmark_cards', { query });
  } catch (err) {
    console.warn('Tauri getBookmarkCards failed, falling back to empty:', err);
    return { cards: [], total: 0 };
  }
}

export async function sqliteDeleteManga(id: string): Promise<void> {
  await invokeCommand('sqlite_delete_manga', { id });
}

export async function sqliteClearLibrary(): Promise<void> {
  await invokeCommand('sqlite_clear_library');
}

export async function sqliteResetProgress(): Promise<void> {
  await invokeCommand('sqlite_reset_progress');
}

export async function sqliteGetSettings(): Promise<Settings | undefined> {
  try {
    const record = await invokeCommand('sqlite_get_settings');
    return record ?? undefined;
  } catch (err) {
    console.warn('Tauri sqliteGetSettings failed:', err);
    return undefined;
  }
}

export async function sqliteSaveSettings(settings: Settings): Promise<Settings> {
  await invokeCommand('sqlite_save_settings', { settings });
  return settings;
}

export async function exportBackup(): Promise<string> {
  return await invokeCommand('export_library_backup');
}

export async function restoreBackup(backupJson: string): Promise<Settings> {
  return (await invokeCommand('restore_library_backup', { backupJson })) as any;
}

export async function validateBackup(backupJson: string): Promise<unknown> {
  return await invokeCommand('validate_library_backup', { backupJson });
}

export async function validateRelativePath(path: string): Promise<string> {
  return await invokeCommand('validate_relative_path_cmd', { path });
}

export async function matchingPosition(
  saved?: Position,
  pages?: Page[],
  oldPages?: Page[],
): Promise<Position | undefined> {
  const res = await invokeCommand('matching_position_cmd', { saved, pages, oldPages });
  return res ?? undefined;
}

export async function parseSettings(value: unknown): Promise<Settings> {
  return await invokeCommand('parse_settings_cmd', { value });
}
