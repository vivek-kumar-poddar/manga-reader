import type { Manga } from './model';

export const limits = Object.freeze({
  backupBytes: 32 * 1024 * 1024,
  titles: 1_000,
  chaptersPerTitle: 1_000,
  pagesPerTitle: 100_000,
  backupPages: 1_000_000,
  bookmarksPerChapter: 1_000,
  pathChars: 4_096,
  directoryDepth: 64,
  discoveryEntries: 100_000,
  imagePixels: 16_000_000,
  imageSide: 32_768,
  queuedJobs: 64,
  decodeConcurrency: 3,
  mobilePageConcurrency: 1,
  desktopPageConcurrency: 4,
  headerBytes: 256 * 1024,
  imageTimeoutMs: 20_000,
  coverTimeoutMs: 10_000,
  ioTimeoutMs: 20_000,
  updateTimeoutMs: 10_000,
  warmChapters: 5,
});

export class LimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LimitError';
  }
}

export function assertAtMost(value: number, maximum: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new LimitError(`${label} exceeds the limit of ${maximum}. Use a smaller selection.`);
  }
}

export function assertPathLimits(path: string): void {
  assertAtMost(path.length, limits.pathChars, 'Relative path length (characters)');
  assertAtMost(path.split('/').length - 1, limits.directoryDepth, 'Folder depth');
}

export function assertImageDimensions(width: number, height: number): void {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) {
    throw new LimitError('Image dimensions must be positive integer pixels.');
  }
  if (!Number.isSafeInteger(width * height)) {
    throw new LimitError('Image area cannot be represented safely.');
  }
}

export function assertMangaLimits(manga: Manga): number {
  assertAtMost(manga.chapters.length, limits.chaptersPerTitle, 'Chapters per title');
  let pages = 0;
  for (const chapter of manga.chapters) {
    pages += chapter.pages.length;
    assertAtMost(pages, limits.pagesPerTitle, 'Pages per title');
    assertAtMost(
      chapter.bookmarks?.length ?? 0,
      limits.bookmarksPerChapter,
      'Bookmarks per chapter',
    );
    for (const page of chapter.pages) {
      assertPathLimits(page.path);
      if (!(page.dimensionsPending && page.width === 0 && page.height === 0)) {
        assertImageDimensions(page.width, page.height);
      }
    }
  }
  return pages;
}

export function withinTime<T>(
  task: PromiseLike<T>,
  milliseconds: number,
  operation: string,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (success: boolean, value: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (success) resolve(value as T);
      else reject(value);
    };
    const abort = () =>
      finish(false, signal?.reason ?? new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(
      () => finish(false, new Error(`${operation} timed out. Please retry.`)),
      milliseconds,
    );
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(task).then(
      (value) => finish(true, value),
      (error) => finish(false, error),
    );
    if (signal?.aborted) abort();
  });
}