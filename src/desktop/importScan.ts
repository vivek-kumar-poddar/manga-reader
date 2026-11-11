import { uniqueSlug, normalizePath } from '../paths';
import { type Directory, type Page, type Chapter, type Manga } from '../model';
import { matchingPosition, isRecord } from './validation';
import { limits, LimitError, assertAtMost, assertPathLimits, withinTime } from '../limits';
import { desktopAPI, type FolderEntry, type PageHeader } from '../tauriBridge';
import {
  type SourceFile,
  summary,
  saveManga,
  getManga,
  errorMessage,
  onMangaDelete,
} from './storage';

export function naturalOrder(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

export async function naturalSortPaths(paths: string[]): Promise<string[]> {
  if (desktopAPI.naturalSortPaths) {
    try {
      return await desktopAPI.naturalSortPaths(paths);
    } catch {
      // fallback
    }
  }
  return [...paths].sort(naturalOrder);
}

export const ignored = (path: string): boolean =>
  /(^|\/)\.[^/]+$/.test(path) ||
  /(^|\/)__MACOSX(\/|$)/.test(path) ||
  /(^|\/)Thumbs\.db$/i.test(path) ||
  /(^|\/)desktop\.ini$/i.test(path);

export function clearSessionDimensions(): void {}

export interface Issue {
  path: string;
  reason: string;
}

export interface ScanState {
  phase: 'discover' | 'index';
  done: number;
  total: number;
  title: string;
}

export interface ScanOptions {
  update?: (state: ScanState) => void;
  signal?: AbortSignal;
}

export class DesktopHandle {
  readonly kind = 'file';
  constructor(
    readonly name: string,
    readonly absolutePath: string,
    readonly size: number,
    readonly modified: number,
    readonly width?: number | null,
    readonly height?: number | null,
  ) {}

  async getFile(): Promise<File> {
    const buffer = await desktopAPI.readFile(this.absolutePath);
    if (!buffer) {
      throw new Error(`Failed to read file from desktop path: ${this.absolutePath}`);
    }
    return new File([buffer], this.name, {
      lastModified: this.modified,
    });
  }
}

export type { SourceFile };

export type Source = {
  title: string;
  handle?: Directory;
  localPath?: string;
  files: Map<string, SourceFile>;
  issues: Issue[];
};

function alive(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Import cancelled', 'AbortError');
}

export async function fromDesktopFolder(
  folderPath: string,
  options: ScanOptions = {},
): Promise<Source> {
  if (!desktopAPI.isDesktop) throw new Error('Desktop API not available.');
  void desktopAPI.recordOpenedRoot?.(folderPath);
  const folderName = folderPath.split(/[\\/]/).at(-1) ?? folderPath;
  const source: Source = { title: folderName, localPath: folderPath, files: new Map(), issues: [] };

  if (desktopAPI.discoverLibrary) {
    try {
      const discovery = await withinTime(
        desktopAPI.discoverLibrary(folderPath, {
          signal: options.signal,
          onProgress: (prog) => {
            if (prog.total > 0) {
              desktopAPI.setProgressBar(prog.done / prog.total);
            }
          },
        }),
        limits.ioTimeoutMs * 5,
        'Discovering library',
        options.signal,
      );

      if (discovery && discovery.titles.length > 0) {
        let discovered = 0;
        for (const title of discovery.titles) {
          for (const ch of title.chapters) {
            for (const p of ch.pages) {
              alive(options.signal);
              const relPath =
                discovery.titles.length > 1 ? `${title.title}/${p.relativePath}` : p.relativePath;
              assertPathLimits(relPath);
              assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
              assertAtMost(
                source.files.size + 1,
                limits.pagesPerTitle,
                'Image candidates per title',
              );
              source.files.set(
                relPath,
                new DesktopHandle(
                  p.name,
                  p.absolutePath,
                  p.size,
                  p.modified,
                  p.width,
                  p.height,
                ) as unknown as FileSystemFileHandle,
              );
            }
          }
        }
        return source;
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw e;
      }
      console.warn('Native discoverLibrary failed, falling back to listFolder:', e);
    }
  }

  const entries: FolderEntry[] = await withinTime(
    desktopAPI.listFolder(folderPath, {
      signal: options.signal,
      onProgress: (prog) => {
        if (prog.total > 0) {
          desktopAPI.setProgressBar(prog.done / prog.total);
        }
      },
    }),
    limits.ioTimeoutMs * 5,
    'Listing folder',
    options.signal,
  );

  let discovered = 0;
  for (const entry of entries) {
    alive(options.signal);
    assertPathLimits(entry.relativePath);
    assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
    assertAtMost(source.files.size + 1, limits.pagesPerTitle, 'Image candidates per title');

    source.files.set(
      entry.relativePath,
      new DesktopHandle(
        entry.relativePath.split(/[\\/]/).at(-1) ?? entry.relativePath,
        entry.absolutePath,
        entry.size,
        entry.modified,
        entry.width,
        entry.height,
      ) as unknown as FileSystemFileHandle,
    );
  }

  return source;
}

export function fromFiles(_list: File[]): Source[] {
  return [];
}

export async function fromHandle(_handle: Directory, _options: ScanOptions = {}): Promise<Source> {
  throw new Error('fromHandle is not supported in desktop builds');
}

export function droppedSources(): () => Promise<Source[]> {
  return async () => [];
}

export async function splitSource(source: Source): Promise<Source[]> {
  return [source];
}

export function chapterGroups(_source: Source): Map<string, [string, SourceFile][]> {
  return new Map();
}

export async function pooled<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  const executing: Promise<void>[] = [];
  for (const item of items) {
    const p = Promise.resolve().then(() => fn(item));
    executing.push(p);
    if (limit <= items.length) {
      const e: Promise<void> = p.then(() => {
        executing.splice(executing.indexOf(e), 1);
      });
    }
  }
  await Promise.all(executing);
}

export async function indexSource(
  source: Source,
  options: ScanOptions = {},
  previous?: Manga,
  sort: Manga['sort'] = 'natural',
) {
  if (previous) stopBackground(previous.id);

  if (desktopAPI.isDesktop && desktopAPI.indexTitle && source.localPath) {
    alive(options.signal);
    const dto = await desktopAPI.indexTitle(source.localPath, { sort, previous }, (progress) => {
      alive(options.signal);
      options.update?.({
        phase: progress.phase as 'discover' | 'index',
        done: progress.done,
        total: progress.total,
        title: progress.title,
      });
      if (progress.total > 0) {
        desktopAPI.setProgressBar(Math.min(1, Math.max(0, progress.done / progress.total)));
      }
    });
    alive(options.signal);

    const m: Manga = {
      id: dto.id,
      title: dto.title,
      slug: dto.slug,
      localPath: dto.localPath,
      lastChapter: dto.lastChapter,
      addedAt: dto.addedAt,
      updatedAt: dto.updatedAt,
      revision: dto.revision,
      sort: dto.sort as 'natural' | 'name' | 'reverse',
      chapters: dto.chapters.map((c) => ({
        name: c.name,
        read: c.read,
        position: c.position,
        bookmarks: c.bookmarks,
        pages: c.pages.map((p) => ({
          name: p.name,
          path: p.path,
          width: p.width,
          height: p.height,
          size: p.size,
          modified: p.modified,
          dimensionsPending: p.dimensionsPending,
        })),
      })),
    };

    return {
      m,
      issues: [...source.issues, ...dto.issues],
      reused: dto.reused,
    };
  }

  throw new Error('Desktop indexing requires native indexTitle and localPath');
}

export async function prepareChapter(
  manga: Manga,
  chapterIndex: number,
  _signal?: AbortSignal,
): Promise<Issue[]> {
  const ch = manga.chapters[chapterIndex];
  if (!ch) return [];

  const unmeasured = ch.pages.filter((p) => p.dimensionsPending || !p.width || !p.height);
  if (!unmeasured.length) return [];

  if (desktopAPI.prepareChapterHeaders) {
    const paths = unmeasured.map((p) => p.path).filter((p): p is string => Boolean(p));
    if (paths.length > 0) {
      try {
        const headers = await desktopAPI.prepareChapterHeaders(paths);
        const headerMap = new Map<string, PageHeader>();
        for (const h of headers) {
          headerMap.set(h.path, h);
        }
        for (const p of unmeasured) {
          const found = p.path ? headerMap.get(p.path) : undefined;
          if (found && found.width > 0 && found.height > 0) {
            p.width = found.width;
            p.height = found.height;
            p.dimensionsPending = false;
          }
        }
        return [];
      } catch (err) {
        console.warn('Native prepareChapterHeaders failed:', err);
      }
    }
  }

  return [];
}

export function stopBackground(_id: string): void {}
export function stopAllBackground(): void {}
export function scheduleBackground(_manga: Manga): void {}
export async function resumeBackground(): Promise<void> {}
export function scanImage(_entry: SourceFile, _signal?: AbortSignal) {
  return Promise.resolve({ width: 0, height: 0 });
}
export function discardScan(_sources: Source[]): void {}
export async function warmSources(_sources: Source[], _signal?: AbortSignal): Promise<void> {}
