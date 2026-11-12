import { limits, assertAtMost, assertPathLimits, assertImageDimensions } from '../limits';
import {
  defaults,
  type Manga,
  type Chapter,
  type Page,
  type Position,
  type Settings,
  type Summary,
} from '../model';
import { folderSlug } from '../paths';

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validates a relative file path:
 * - Must be a non-empty string within pathChars and directoryDepth limits.
 * - Cannot start or end with a slash.
 * - Cannot contain backslashes, '.', or '..' segments.
 * - Cannot contain null bytes or control characters.
 */
const RESERVED_DOS_NAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

export function validateRelativePath(path: unknown): string {
  if (typeof path !== 'string' || !path.trim()) {
    throw new ValidationError('Path must be a non-empty string.');
  }
  if (path.startsWith(' ') || path.endsWith(' ')) {
    throw new ValidationError(`Path cannot start or end with whitespace: "${path}"`);
  }
  const trimmed = path.trim();
  // Reject colons (Windows drive letters e.g. C:, alternate data streams e.g. :stream)
  if (trimmed.includes(':')) {
    throw new ValidationError(`Path cannot contain drive prefixes or colons: "${trimmed}"`);
  }
  if (trimmed.startsWith('/') || trimmed.endsWith('/')) {
    throw new ValidationError(`Path cannot start or end with a slash: "${trimmed}"`);
  }
  if (trimmed.startsWith('//')) {
    throw new ValidationError(`Path cannot start with UNC prefix: "${trimmed}"`);
  }
  if (trimmed.includes('\\')) {
    throw new ValidationError(`Path must use forward slashes only: "${trimmed}"`);
  }
  if (trimmed.includes('\0')) {
    throw new ValidationError('Path contains invalid null byte.');
  }
  assertPathLimits(trimmed);
  const segments = trimmed.split('/');
  for (const seg of segments) {
    if (!seg || seg === '.' || seg === '..') {
      throw new ValidationError(`Path contains invalid traversal segment: "${trimmed}"`);
    }
    if (seg.endsWith(' ') || seg.endsWith('.')) {
      throw new ValidationError(`Path segment cannot end with a space or dot: "${seg}"`);
    }
    const stem = seg.split('.')[0].toLowerCase();
    if (RESERVED_DOS_NAMES.has(stem)) {
      throw new ValidationError(`Path segment uses reserved device name: "${seg}"`);
    }
  }
  return trimmed;
}

/**
 * Resolves a Position against a chapter's pages list.
 */
export function matchingPosition(
  p: Position | undefined,
  pages: Page[],
  oldPages: Page[] = [],
): Position | undefined {
  if (!p || !pages.length) return;
  const path = p.path || oldPages[p.page]?.path;
  let page = path ? pages.findIndex((x) => x.path === path) : -1;
  if (page < 0 && path) {
    const name = path.split('/').at(-1);
    const matches = pages.map((x, i) => (x.name === name ? i : -1)).filter((i) => i >= 0);
    if (matches.length === 1) page = matches[0];
  }
  if (page < 0) page = Math.min(p.page, pages.length - 1);
  const validIndex = Math.max(0, page);
  return {
    page: validIndex,
    path: pages[validIndex].path,
    fraction: Math.max(0, Math.min(1, Number.isFinite(p.fraction) ? p.fraction : 0)),
    ...(p.mangaBookmark ? { mangaBookmark: true } : {}),
    ...(typeof p.timestamp === 'number' && Number.isFinite(p.timestamp)
      ? { timestamp: p.timestamp }
      : {}),
  };
}

/**
 * Parses and strictly validates a Position object from unknown input.
 * Rejects non-integers, NaN, negative indexes, or out-of-range fractions.
 */
export function parsePosition(
  value: unknown,
  pages: Page[],
  oldPages: Page[] = [],
): Position | undefined {
  if (!value) return undefined;
  if (!isRecord(value)) {
    throw new ValidationError('Position must be an object.');
  }

  if (typeof value.page !== 'number' || !Number.isInteger(value.page) || value.page < 0) {
    throw new ValidationError('Position page must be a non-negative integer.');
  }

  if (typeof value.fraction !== 'number' || !Number.isFinite(value.fraction)) {
    throw new ValidationError('Position fraction must be a finite number.');
  }

  const fraction = Math.max(0, Math.min(1, value.fraction));
  let validatedPath: string | undefined;
  if (value.path !== undefined) {
    validatedPath = validateRelativePath(value.path);
  }

  let mangaBookmark: boolean | undefined;
  if ('mangaBookmark' in value && value.mangaBookmark !== undefined) {
    if (typeof value.mangaBookmark !== 'boolean') {
      throw new ValidationError('Position mangaBookmark must be a boolean.');
    }
    if (value.mangaBookmark) {
      mangaBookmark = true;
    }
  }

  let timestamp: number | undefined;
  if ('timestamp' in value && value.timestamp !== undefined) {
    if (typeof value.timestamp !== 'number' || !Number.isFinite(value.timestamp)) {
      throw new ValidationError('Position timestamp must be a finite number.');
    }
    timestamp = value.timestamp;
  }

  return matchingPosition(
    {
      page: value.page,
      path: validatedPath,
      fraction,
      ...(mangaBookmark ? { mangaBookmark: true } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
    },
    pages,
    oldPages,
  );
}

/**
 * Parses and validates an individual Page object.
 */
export function parsePage(value: unknown, seenPaths: Set<string>): Page {
  if (!isRecord(value)) {
    throw new ValidationError('Page record must be an object.');
  }

  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new ValidationError('Page name must be a non-empty string.');
  }

  const path = validateRelativePath(value.path);
  if (seenPaths.has(path)) {
    throw new ValidationError(`Duplicate page path within chapter: "${path}"`);
  }
  seenPaths.add(path);

  const isPending = value.dimensionsPending === true;
  const isWidthPending = isPending && value.width === 0;
  const isHeightPending = isPending && value.height === 0;

  if (
    typeof value.width !== 'number' ||
    !Number.isInteger(value.width) ||
    typeof value.height !== 'number' ||
    !Number.isInteger(value.height) ||
    (value.width <= 0 && !isWidthPending) ||
    (value.height <= 0 && !isHeightPending)
  ) {
    throw new ValidationError('Page dimensions must be positive integer pixels.');
  }
  if (value.width > 0 && value.height > 0) {
    assertImageDimensions(value.width, value.height);
  }

  let size: number | undefined;
  if (value.size !== undefined) {
    if (typeof value.size !== 'number' || !Number.isInteger(value.size) || value.size < 0) {
      throw new ValidationError('Page size must be a non-negative integer bytes count.');
    }
    size = value.size;
  }

  let modified: number | undefined;
  if (value.modified !== undefined) {
    if (
      typeof value.modified !== 'number' ||
      !Number.isFinite(value.modified) ||
      value.modified < 0
    ) {
      throw new ValidationError('Page modified timestamp must be a non-negative number.');
    }
    modified = value.modified;
  }

  const dimensionsPending =
    typeof value.dimensionsPending === 'boolean' ? value.dimensionsPending : undefined;

  return {
    name: value.name.trim(),
    path,
    width: value.width,
    height: value.height,
    ...(size !== undefined ? { size } : {}),
    ...(modified !== undefined ? { modified } : {}),
    ...(dimensionsPending !== undefined ? { dimensionsPending } : {}),
  };
}

/**
 * Parses and validates a Chapter object.
 */
export function parseChapter(value: unknown, chapterIndex: number, oldChapter?: Chapter): Chapter {
  if (!isRecord(value)) {
    throw new ValidationError(`Chapter ${chapterIndex + 1} must be an object.`);
  }

  if (typeof value.name !== 'string' || !value.name.trim()) {
    throw new ValidationError(`Chapter ${chapterIndex + 1} name must be a non-empty string.`);
  }

  if (!Array.isArray(value.pages) || !value.pages.length) {
    throw new ValidationError(`Chapter "${value.name}" must contain at least one page.`);
  }

  const seenPaths = new Set<string>();
  const pages: Page[] = value.pages.map((p, idx) => {
    try {
      return parsePage(p, seenPaths);
    } catch (e) {
      throw new ValidationError(
        `Chapter "${value.name}" page ${idx + 1} is invalid: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  });

  const position = value.position
    ? parsePosition(value.position, pages, oldChapter?.pages)
    : undefined;

  let bookmarks: Position[] | undefined;
  if (value.bookmarks !== undefined) {
    if (!Array.isArray(value.bookmarks)) {
      throw new ValidationError(`Chapter "${value.name}" bookmarks must be an array.`);
    }
    assertAtMost(value.bookmarks.length, limits.bookmarksPerChapter, 'Bookmarks per chapter');
    const seenBookmarks = new Set<string>();
    bookmarks = [];
    for (const b of value.bookmarks) {
      const parsed = parsePosition(b, pages, oldChapter?.pages);
      if (parsed) {
        const key = `${parsed.page}:${parsed.path}`;
        if (!seenBookmarks.has(key)) {
          seenBookmarks.add(key);
          bookmarks.push(parsed);
        }
      }
    }
  }

  const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined;

  return {
    ...(id ? { id } : {}),
    name: value.name.trim(),
    read: value.read === true,
    pages,
    position,
    bookmarks,
  };
}

/**
 * Parses and validates a Manga object.
 */
export function parseManga(
  value: unknown,
  oldManga?: Manga,
  options: { preserveHardwarePointers?: boolean } = { preserveHardwarePointers: true },
): Manga {
  if (!isRecord(value)) {
    throw new ValidationError('Manga record must be an object.');
  }

  if (typeof value.id !== 'string' || !value.id.trim()) {
    throw new ValidationError('Manga ID must be a non-empty string.');
  }

  if (typeof value.title !== 'string' || !value.title.trim()) {
    throw new ValidationError('Manga title must be a non-empty string.');
  }

  if (!Array.isArray(value.chapters) || !value.chapters.length) {
    throw new ValidationError(`Manga "${value.title}" must contain at least one chapter.`);
  }

  assertAtMost(value.chapters.length, limits.chaptersPerTitle, 'Chapters per title');

  let titlePages = 0;
  const chapters: Chapter[] = value.chapters.map((c, idx) => {
    const oldChapter = oldManga?.chapters[idx];
    const parsed = parseChapter(c, idx, oldChapter);
    titlePages += parsed.pages.length;
    assertAtMost(titlePages, limits.pagesPerTitle, 'Pages per title');
    return parsed;
  });

  const lastChapter =
    typeof value.lastChapter === 'number' && Number.isInteger(value.lastChapter)
      ? Math.max(0, Math.min(chapters.length - 1, value.lastChapter))
      : 0;

  const now = Date.now();
  const addedAt =
    typeof value.addedAt === 'number' && Number.isFinite(value.addedAt) && value.addedAt > 0
      ? value.addedAt
      : now;

  const updatedAt =
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) && value.updatedAt > 0
      ? value.updatedAt
      : now;

  const sort =
    value.sort === 'name' || value.sort === 'reverse' || value.sort === 'natural'
      ? value.sort
      : undefined;

  const revision =
    typeof value.revision === 'number' && Number.isFinite(value.revision) && value.revision >= 0
      ? value.revision
      : 1;

  const title = value.title.trim();
  const slug =
    typeof value.slug === 'string' && value.slug.trim() ? value.slug.trim() : folderSlug(title);

  const localPath =
    options.preserveHardwarePointers &&
    typeof value.localPath === 'string' &&
    value.localPath.trim()
      ? value.localPath.trim()
      : undefined;

  const handle =
    options.preserveHardwarePointers && value.handle && typeof value.handle === 'object'
      ? (value.handle as Manga['handle'])
      : undefined;

  const cover =
    options.preserveHardwarePointers && value.cover instanceof Blob ? value.cover : undefined;

  return {
    id: value.id.trim(),
    title,
    slug,
    chapters,
    lastChapter,
    addedAt,
    updatedAt,
    revision,
    ...(sort ? { sort } : {}),
    handle,
    localPath,
    cover,
  };
}

/**
 * Validates a Summary record read from IndexedDB.
 * Returns undefined if the record is missing essential identifiers.
 */
export function parseSummary(
  value: unknown,
  options: { preserveHardwarePointers?: boolean } = {},
): Summary | undefined {
  if (!isRecord(value)) return undefined;
  if (typeof value.id !== 'string' || !value.id.trim()) return undefined;
  if (typeof value.title !== 'string' || !value.title.trim()) return undefined;

  const id = value.id.trim();
  const title = value.title.trim();
  const slug =
    typeof value.slug === 'string' && value.slug.trim() ? value.slug.trim() : folderSlug(title);

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

  const revision =
    typeof value.revision === 'number' && Number.isFinite(value.revision) && value.revision >= 0
      ? value.revision
      : undefined;

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
    ...(revision !== undefined ? { revision } : {}),
    ...(localPath ? { localPath } : {}),
    ...(handle ? { handle } : {}),
    ...(sort ? { sort } : {}),
  };
}

/**
 * Parses and validates Settings, allowlisting valid fields and falling back to defaults.
 */
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

  const fontSizeTitle =
    typeof s.fontSizeTitle === 'number' && Number.isFinite(s.fontSizeTitle)
      ? Math.max(10, Math.min(36, Math.round(s.fontSizeTitle)))
      : defaults.fontSizeTitle;

  const fontSizeUi =
    typeof s.fontSizeUi === 'number' && Number.isFinite(s.fontSizeUi)
      ? Math.max(10, Math.min(36, Math.round(s.fontSizeUi)))
      : defaults.fontSizeUi;

  const fontSizeButton =
    typeof s.fontSizeButton === 'number' && Number.isFinite(s.fontSizeButton)
      ? Math.max(10, Math.min(36, Math.round(s.fontSizeButton)))
      : defaults.fontSizeButton;

  const confirmDelete =
    typeof s.confirmDelete === 'boolean' ? s.confirmDelete : (defaults.confirmDelete ?? false);

  const shelfSort: Settings['shelfSort'] =
    s.shelfSort === 'recent' ||
    s.shelfSort === 'title' ||
    s.shelfSort === 'added' ||
    s.shelfSort === 'progress'
      ? s.shelfSort
      : undefined;

  return {
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
    fontSizeTitle,
    fontSizeUi,
    fontSizeButton,
    confirmDelete,
    ...(shelfSort ? { shelfSort } : {}),
  };
}

/**
 * Validates untrusted backup JSON records before any database writes.
 * Rejects corrupt versions, oversized payloads, duplicate IDs, and invalid structures.
 */
export function validateBackup(value: unknown): { manga: Manga[]; settings: Settings } {
  if (!isRecord(value)) {
    throw new ValidationError('Backup must be an object.');
  }

  if (value.version !== 1 && value.version !== 2) {
    throw new ValidationError('Invalid backup version. Supported versions: 1, 2.');
  }

  if (!Array.isArray(value.manga)) {
    throw new ValidationError('Backup manga list must be an array.');
  }

  assertAtMost(value.manga.length, limits.titles, 'Backup titles');

  const seenIds = new Set<string>();
  let totalBackupPages = 0;

  const manga: Manga[] = value.manga.map((rawManga, index) => {
    if (!isRecord(rawManga) || typeof rawManga.id !== 'string') {
      throw new ValidationError(`Manga item ${index + 1} has an invalid or missing ID.`);
    }
    const id = rawManga.id.trim();
    if (seenIds.has(id)) {
      throw new ValidationError(`Duplicate manga ID found in backup: "${id}"`);
    }
    seenIds.add(id);

    const parsed = parseManga(rawManga, undefined, { preserveHardwarePointers: false });
    for (const ch of parsed.chapters) {
      totalBackupPages += ch.pages.length;
      assertAtMost(totalBackupPages, limits.backupPages, 'Backup pages');
    }
    return parsed;
  });

  const settings = parseSettings(value.settings);

  return {
    manga,
    settings,
  };
}
