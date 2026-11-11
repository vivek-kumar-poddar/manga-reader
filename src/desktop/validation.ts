import type { Manga, Chapter, Page, Position, Settings, Summary } from '../model';
import { defaults } from '../model';
import { desktopAPI } from '../tauriBridge';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateRelativePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new ValidationError('Path must be a non-empty string');
  }
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith('/') || normalized.includes('..') || normalized.includes('//')) {
    throw new ValidationError(`Invalid path traversal or structure: ${path}`);
  }
  return normalized;
}

export function matchingPosition(saved?: Position, pages?: Page[]): Position | undefined {
  if (!saved || !pages || !pages.length) return undefined;
  if (saved.path) {
    const idx = pages.findIndex((p) => p.path === saved.path);
    if (idx >= 0) return { page: idx, path: saved.path, fraction: saved.fraction };
  }
  if (saved.page >= 0 && saved.page < pages.length) {
    return {
      page: saved.page,
      path: pages[saved.page].path,
      fraction: saved.fraction,
    };
  }
  return undefined;
}

export function parsePosition(
  value: unknown,
  pages?: Page[],
  fallback?: Position,
): Position | undefined {
  if (value === undefined || value === null) return fallback;
  if (!isRecord(value)) throw new ValidationError('Position must be an object');
  const page = value.page;
  if (typeof page !== 'number' || !Number.isInteger(page) || page < 0) {
    throw new ValidationError('Position page must be a non-negative integer');
  }
  if (pages && page >= pages.length && pages.length > 0) {
    throw new ValidationError('Position page exceeds chapter page count');
  }
  const fraction = value.fraction;
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new ValidationError('Position fraction must be a float between 0 and 1');
  }
  const path = typeof value.path === 'string' ? validateRelativePath(value.path) : undefined;
  const timestamp =
    typeof value.timestamp === 'number' && Number.isFinite(value.timestamp)
      ? value.timestamp
      : undefined;
  return { page, fraction, path, timestamp };
}

export function parsePage(value: unknown, seenPaths: Set<string>): Page {
  if (!isRecord(value)) throw new ValidationError('Page must be an object');
  const path = validateRelativePath(value.path);
  if (seenPaths.has(path)) throw new ValidationError(`Duplicate page path: ${path}`);
  seenPaths.add(path);
  const name = typeof value.name === 'string' ? value.name : path;
  const width = typeof value.width === 'number' && Number.isFinite(value.width) ? value.width : 0;
  const height =
    typeof value.height === 'number' && Number.isFinite(value.height) ? value.height : 0;
  return {
    name,
    path,
    width,
    height,
    size: typeof value.size === 'number' ? value.size : undefined,
    modified: typeof value.modified === 'number' ? value.modified : undefined,
    dimensionsPending: Boolean(value.dimensionsPending),
  };
}

export function parseChapter(value: unknown, chapterIndex: number, oldChapter?: Chapter): Chapter {
  if (!isRecord(value)) throw new ValidationError('Chapter must be an object');
  const name = typeof value.name === 'string' ? value.name : `Chapter ${chapterIndex + 1}`;
  const rawPages = Array.isArray(value.pages) ? value.pages : [];
  const seenPaths = new Set<string>();
  const pages: Page[] = rawPages.map((p) => parsePage(p, seenPaths));
  const read = Boolean(value.read);
  const position = parsePosition(value.position, pages, oldChapter?.position);
  const rawBookmarks = Array.isArray(value.bookmarks) ? value.bookmarks : [];
  const bookmarks = rawBookmarks
    .map((b) => parsePosition(b, pages))
    .filter((b): b is Position => Boolean(b));
  return { name, pages, read, position, bookmarks };
}

export function parseManga(value: unknown, oldManga?: Manga): Manga {
  if (!isRecord(value)) throw new ValidationError('Manga must be an object');
  const id = typeof value.id === 'string' ? value.id : 'unknown';
  const title = typeof value.title === 'string' ? value.title : 'Untitled';
  const slug = typeof value.slug === 'string' ? value.slug : id;
  const lastChapter = typeof value.lastChapter === 'number' ? value.lastChapter : 0;
  const rawChapters = Array.isArray(value.chapters) ? value.chapters : [];
  const chapters = rawChapters.map((c, i) => parseChapter(c, i, oldManga?.chapters[i]));
  return {
    id,
    title,
    slug,
    lastChapter,
    chapters,
    addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
    updatedAt: typeof value.updatedAt === 'number' ? value.updatedAt : Date.now(),
    revision: typeof value.revision === 'number' ? value.revision : 1,
    localPath: typeof value.localPath === 'string' ? value.localPath : undefined,
  };
}

export function parseSummary(
  value: unknown,
  options: { preserveHardwarePointers?: boolean } = {},
): Summary | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || !value.id.trim()) return undefined;
  if (typeof value.title !== 'string' || !value.title.trim()) return undefined;

  const id = value.id.trim();
  const title = value.title.trim();
  const slug = typeof value.slug === 'string' && value.slug.trim() ? value.slug.trim() : id;

  const chapterCount =
    typeof value.chapterCount === 'number' &&
    Number.isInteger(value.chapterCount) &&
    value.chapterCount >= 0
      ? value.chapterCount
      : 0;

  const chaptersRead =
    typeof value.chaptersRead === 'number' &&
    Number.isInteger(value.chaptersRead) &&
    value.chaptersRead >= 0
      ? Math.min(chapterCount, value.chaptersRead)
      : 0;

  const lastChapter =
    typeof value.lastChapter === 'number' &&
    Number.isInteger(value.lastChapter) &&
    value.lastChapter >= 0
      ? Math.max(0, Math.min(Math.max(0, chapterCount - 1), value.lastChapter))
      : 0;

  const lastChapterName = typeof value.lastChapterName === 'string' ? value.lastChapterName : '';
  const hasProgress = typeof value.hasProgress === 'boolean' ? value.hasProgress : false;

  const now = Date.now();
  const indexedAt =
    typeof value.indexedAt === 'number' && Number.isFinite(value.indexedAt) && value.indexedAt > 0
      ? value.indexedAt
      : now;

  const addedAt =
    typeof value.addedAt === 'number' && Number.isFinite(value.addedAt) && value.addedAt > 0
      ? value.addedAt
      : now;

  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt > 0
      ? value.updatedAt
      : now;

  const localPath =
    typeof value.localPath === 'string' && value.localPath.trim()
      ? value.localPath.trim()
      : undefined;

  const handle =
    options.preserveHardwarePointers && value.handle && typeof value.handle === 'object'
      ? (value.handle as Summary['handle'])
      : undefined;

  const sort =
    value.sort === 'name' || value.sort === 'reverse' || value.sort === 'natural'
      ? value.sort
      : undefined;

  return {
    id,
    title,
    slug,
    chapterCount,
    chaptersRead,
    lastChapter,
    lastChapterName,
    hasProgress,
    indexedAt,
    addedAt,
    updatedAt,
    ...(localPath ? { localPath } : {}),
    ...(handle ? { handle } : {}),
    ...(sort ? { sort } : {}),
  };
}

export function parseSettings(value: unknown): Settings {
  if (!isRecord(value)) {
    return { ...defaults };
  }

  const s = value;
  const theme: Settings['theme'] =
    s.theme === 'light' || s.theme === 'dark' || s.theme === 'system' ? s.theme : defaults.theme;

  const mode: Settings['mode'] = s.mode === 'single' ? 'single' : defaults.mode;

  const layout: Settings['layout'] =
    s.layout === 'width' || s.layout === 'height' || s.layout === 'auto' || s.layout === 'max'
      ? s.layout
      : defaults.layout;

  const maxWidth =
    s.maxWidth === 920 || s.maxWidth === 1024 || s.maxWidth === 1280 || s.maxWidth === 0
      ? s.maxWidth
      : defaults.maxWidth;

  const seconds =
    typeof s.seconds === 'number' && Number.isFinite(s.seconds)
      ? Math.max(0.5, Math.min(120, s.seconds))
      : defaults.seconds;

  const advance = typeof s.advance === 'boolean' ? s.advance : defaults.advance;
  const reduced = typeof s.reduced === 'boolean' ? s.reduced : defaults.reduced;
  const lowQuality = typeof s.lowQuality === 'boolean' ? s.lowQuality : defaults.lowQuality;
  const customSeconds =
    typeof s.customSeconds === 'boolean' ? s.customSeconds : ![2, 3, 4, 5].includes(seconds);

  const autoHideBars = typeof s.autoHideBars === 'boolean' ? s.autoHideBars : defaults.autoHideBars;

  const resumeDelay =
    typeof s.resumeDelay === 'number' && Number.isFinite(s.resumeDelay)
      ? Math.max(0.5, Math.min(15, s.resumeDelay))
      : defaults.resumeDelay;

  const direction: Settings['direction'] = s.direction === 'rtl' ? 'rtl' : defaults.direction;
  const spread = typeof s.spread === 'boolean' ? s.spread : defaults.spread;
  const singleCover = typeof s.singleCover === 'boolean' ? s.singleCover : defaults.singleCover;

  const endAction: Settings['endAction'] =
    s.endAction === 'stop' || s.endAction === 'replay' || s.endAction === 'next'
      ? s.endAction
      : advance === false
        ? 'stop'
        : defaults.endAction;

  return {
    ...defaults,
    theme,
    mode,
    layout,
    maxWidth,
    seconds,
    advance,
    reduced,
    lowQuality,
    customSeconds,
    autoHideBars,
    resumeDelay,
    direction,
    spread,
    singleCover,
    endAction,
  };
}

/**
 * On desktop, backup validation delegates directly to the native Rust validator.
 */
export async function validateBackupAsync(
  value: unknown,
): Promise<{ manga: Manga[]; settings: Settings }> {
  const jsonStr = typeof value === 'string' ? value : JSON.stringify(value);
  if (desktopAPI.validateBackup) {
    const validated = (await desktopAPI.validateBackup(jsonStr)) as any;
    return {
      manga: (validated.manga || []).map((m: any) => parseManga(m)),
      settings: parseSettings(validated.settings),
    };
  }
  throw new ValidationError('Rust desktop backup validation unavailable');
}

export function validateBackup(value: unknown): { manga: Manga[]; settings: Settings } {
  if (typeof value === 'string') {
    value = JSON.parse(value);
  }
  if (!isRecord(value)) throw new ValidationError('Backup must be an object');
  const mangaList = Array.isArray(value.manga) ? value.manga.map((m) => parseManga(m)) : [];
  const settings = parseSettings(value.settings);
  return { manga: mangaList, settings };
}
