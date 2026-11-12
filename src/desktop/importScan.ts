import { uniqueSlug, normalizePath, normalizeRelativePath } from '../paths';
import { type Directory, type Page, type Chapter, type Manga } from '../model';
import { matchingPosition, isRecord } from './validation';
import { limits, LimitError, assertAtMost, assertPathLimits, assertImageDimensions, withinTime } from '../limits';
import { imageFile } from '../images';
import {
  desktopAPI,
  type FolderEntry,
  type PageHeader,
  type LibraryDiscovery,
} from '../tauriBridge';
import {
  type SourceFile,
  summary,
  saveManga,
  getManga,
  listLibrary,
  access,
  errorMessage,
  onMangaDelete,
  invalidateSummaryCache,
  invalidateBookmarkCache,
  broadcastSync,
} from './storage';

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function naturalOrder(a: string, b: string): number {
  const tokens = (s: string) =>
    s
      .normalize('NFC')
      .toLowerCase()
      .replace(/\b(chapter|ch)\.?\s*(?=\d)/g, 'ch ')
      .replace(/\b(volume|vol)\.?\s*(?=\d)/g, 'vol ')
      .match(/\d+(?:\.\d+)?|[^\d]+/g) || [];
  const category = (s: string) =>
    /^(prologue|opening)\b/i.test(s) ? -1 : /^(extra|bonus|special|epilogue)\b/i.test(s) ? 1 : 0;
  const categoryDiff = category(a) - category(b);
  if (categoryDiff) return categoryDiff;
  const aa = tokens(a),
    bb = tokens(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const x = aa[i],
      y = bb[i],
      nx = Number(x),
      ny = Number(y);
    const both = x.trim() !== '' && y.trim() !== '' && Number.isFinite(nx) && Number.isFinite(ny);
    const result = both ? nx - ny : natural.compare(x, y);
    if (result) return result;
  }
  return aa.length - bb.length || natural.compare(a, b);
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
  path
    .split('/')
    .some(
      (p) =>
        p.startsWith('.') ||
        p === '__MACOSX' ||
        p.toLowerCase() === 'thumbs.db' ||
        p.toLowerCase() === 'desktop.ini',
    );

export function clearSessionDimensions(): void { }

export interface Issue {
  path: string;
  reason: string;
}

export interface ScanState {
  phase: 'discover' | 'index';
  done: number;
  total: number;
  title?: string;
}

export interface ScanOptions {
  update?: (state: ScanState) => void;
  signal?: AbortSignal;
}

export interface PrepareChapterOptions {
  signal?: AbortSignal;
  update?: (state: ScanState) => void;
}

export interface ChapterPreview {
  name: string;
  pageCount: number;
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
  ) { }

  get absPath(): string {
    return this.absolutePath;
  }

  get lastModified(): number {
    return this.modified;
  }

  async getFile(): Promise<File> {
    if (!desktopAPI.isDesktop) throw new Error('Desktop API not available.');
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
  discoveredTitles?: LibraryDiscovery['titles'];
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
        source.discoveredTitles = discovery.titles;
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
    const relPath = normalizeRelativePath(entry.relativePath);
    if (ignored(relPath) || !imageFile({ name: relPath, type: '' })) continue;
    assertPathLimits(relPath);
    assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
    assertAtMost(source.files.size + 1, limits.pagesPerTitle, 'Image candidates per title');

    source.files.set(
      relPath,
      new DesktopHandle(
        relPath.split('/').at(-1) ?? relPath,
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

export function droppedSources(
  _items?: DataTransferItem[],
  _options?: ScanOptions,
): () => Promise<Source[]> {
  return async () => [];
}

export async function splitSource(source: Source): Promise<Source[]> {
  if (source.discoveredTitles && source.discoveredTitles.length > 1) {
    const splitTitles: Source[] = [];
    for (const dt of source.discoveredTitles) {
      const s: Source = {
        title: dt.title,
        localPath: dt.rootPath,
        files: new Map(),
        issues: [],
      };
      for (const ch of dt.chapters) {
        for (const p of ch.pages) {
          s.files.set(
            p.relativePath,
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
      splitTitles.push(s);
      assertAtMost(splitTitles.length, limits.titles, 'Selected titles');
    }
    return splitTitles.length > 0 ? splitTitles : [source];
  }

  const result = new Map<string, Source>();
  const sep = source.localPath?.includes('\\') ? '\\' : '/';
  for (const [path, file] of source.files) {
    const parts = path.split('/');
    const title = parts.length > 1 ? parts.shift()! : `${source.title} — root pages`;
    let s = result.get(title);
    if (!s) {
      const childLocalPath =
        source.localPath && title !== `${source.title} — root pages`
          ? `${source.localPath.replace(/[\\/]+$/, '')}${sep}${title}`
          : source.localPath;
      s = {
        title,
        localPath: childLocalPath,
        files: new Map(),
        issues: [],
      };
      result.set(title, s);
      assertAtMost(result.size, limits.titles, 'Selected titles');
    }
    s.files.set(parts.join('/'), file);
  }
  return result.size > 0 ? [...result.values()] : [source];
}

export function chapterGroups(source: Source): Map<string, number> {
  const groups = new Map<string, number>();
  for (const path of source.files.keys()) {
    const parts = path.split('/');
    const name = parts.length === 1 ? 'Root pages' : parts.slice(0, -1).join(' / ');
    if (parts.length === 1 && /^(thumbnail|cover)\./i.test(path) && source.files.size > 1) continue;
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return groups;
}

export function chapterPreviews(source: Source): ChapterPreview[] {
  const groups = chapterGroups(source);
  return Array.from(groups.entries(), ([name, pageCount]) => ({ name, pageCount }));
}

export async function pooled<T>(
  items: T[],
  limitOrFn: number | ((item: T) => Promise<void>),
  fnOrSignal?: ((item: T) => Promise<void>) | AbortSignal,
  signal?: AbortSignal,
): Promise<void> {
  const limit = typeof limitOrFn === 'number' ? limitOrFn : 4;
  const fn =
    typeof limitOrFn === 'function' ? limitOrFn : (fnOrSignal as (item: T) => Promise<void>);
  const sig = fnOrSignal instanceof AbortSignal ? fnOrSignal : signal;

  if (items.length === 0) return;
  const poolLimit = Math.max(1, Math.min(limit, items.length));
  let next = 0;

  const workers = Array.from({ length: poolLimit }, async () => {
    while (next < items.length) {
      if (sig?.aborted) throw new DOMException('Operation cancelled', 'AbortError');
      const idx = next++;
      await fn(items[idx]);
    }
  });

  await Promise.all(workers);
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
    const confirmedTitle = source.title?.trim() || undefined;
    const jobId = `index-${Math.random().toString(36).slice(2)}`;

    let abortHandler: (() => void) | undefined;
    if (options.signal) {
      abortHandler = () => {
        void desktopAPI.cancelScan?.(jobId);
      };
      options.signal.addEventListener('abort', abortHandler, { once: true });
    }

    try {
      const dto = await desktopAPI.indexTitle(
        source.localPath,
        {
          sort,
          previous,
          targetId: previous?.id,
          title: confirmedTitle,
          jobId,
          signal: options.signal,
        },
        (progress) => {
          alive(options.signal);
          options.update?.({
            phase: progress.phase as 'discover' | 'index',
            done: progress.done,
            total: progress.total,
            title: confirmedTitle || progress.title,
          });
          if (progress.total > 0) {
            desktopAPI.setProgressBar(Math.min(1, Math.max(0, progress.done / progress.total)));
          }
        },
      );
      alive(options.signal);

      const m: Manga = {
        id: dto.id,
        title: confirmedTitle || dto.title,
        slug: dto.slug,
        localPath: dto.localPath,
        lastChapter: dto.lastChapter,
        addedAt: dto.addedAt,
        updatedAt: dto.updatedAt,
        revision: dto.revision,
        sort: dto.sort as 'natural' | 'name' | 'reverse',
        chapters: (dto.chapters || []).map((c: any) => ({
          ...(c.id ? { id: c.id } : {}),
          name: c.name,
          read: c.read,
          position: c.position,
          bookmarks: c.bookmarks,
          pages: (c.pages || []).map((p: any) => ({
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

      alive(options.signal);
      // Natively committed directly to SQLite in Rust index_title; invalidate JS caches
      invalidateSummaryCache();
      invalidateBookmarkCache();
      broadcastSync({ type: 'library', id: m.id });

      return {
        m,
        issues: [...source.issues, ...dto.issues],
        reused: dto.reused,
      };
    } finally {
      if (abortHandler && options.signal) {
        options.signal.removeEventListener('abort', abortHandler);
      }
    }
  }

  throw new Error('Desktop indexing requires native indexTitle and localPath');
}

export async function prepareChapter(
  manga: Manga,
  chapterIndex: number,
  options: PrepareChapterOptions = {},
): Promise<Issue[]> {
  alive(options.signal);
  const ch = manga.chapters[chapterIndex];
  if (!ch) return [];

  const unmeasured = ch.pages.filter((p) => p.dimensionsPending || !p.width || !p.height);
  if (!unmeasured.length) return [];

  const issues: Issue[] = [];

  if (desktopAPI.prepareChapterHeaders) {
    const paths = unmeasured.map((p) => p.path).filter((p): p is string => Boolean(p));
    if (paths.length > 0) {
      try {
        alive(options.signal);
        const headers = await desktopAPI.prepareChapterHeaders(paths, manga.id);
        alive(options.signal);
        const headerMap = new Map<string, PageHeader>();
        for (const h of headers) {
          headerMap.set(h.path, h);
        }
        let done = 0;
        let updated = false;
        for (const p of unmeasured) {
          const found = p.path ? headerMap.get(p.path) : undefined;
          if (found && found.width > 0 && found.height > 0) {
            assertImageDimensions(found.width, found.height);
            p.width = found.width;
            p.height = found.height;
            p.dimensionsPending = false;
            updated = true;
          } else {
            issues.push({
              path: p.path || p.name,
              reason: 'Could not resolve image dimensions',
            });
          }
          done++;
          options.update?.({
            phase: 'index',
            done,
            total: unmeasured.length,
            title: manga.title,
          });
        }
        if (updated) {
          await saveManga(manga);
        }
        return issues;
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') throw err;
        console.warn('Native prepareChapterHeaders failed:', err);
        return unmeasured.map((p) => ({
          path: p.path || p.name,
          reason: `Failed to prepare chapter headers: ${errorMessage(err)}`,
        }));
      }
    }
  }

  return unmeasured.map((p) => ({
    path: p.path || p.name,
    reason: 'Header preparation unavailable or paths missing',
  }));
}

interface BackgroundJob {
  id: string;
  revision?: number;
  updatedAt?: number;
  controller: AbortController;
}

const backgroundJobs = new Map<string, BackgroundJob>();
let backgroundRunning = false;

export function stopBackground(id: string): void {
  const job = backgroundJobs.get(id);
  if (job) {
    job.controller.abort();
    backgroundJobs.delete(id);
  }
}

export function stopAllBackground(): void {
  for (const job of backgroundJobs.values()) {
    job.controller.abort();
  }
  backgroundJobs.clear();
}

onMangaDelete((id) => {
  if (id) stopBackground(id);
  else stopAllBackground();
});

export function scheduleBackground(manga: Manga): void {
  if (
    backgroundJobs.has(manga.id) ||
    !manga.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))
  ) {
    return;
  }
  if (backgroundJobs.size >= limits.queuedJobs) return;
  backgroundJobs.set(manga.id, {
    id: manga.id,
    revision: manga.revision,
    updatedAt: manga.updatedAt,
    controller: new AbortController(),
  });
  void drainBackground();
}

async function runDrainPass(): Promise<void> {
  let remaining = backgroundJobs.size;
  while (backgroundJobs.size && remaining-- > 0) {
    const entry = backgroundJobs.entries().next().value;
    if (!entry) break;
    const [id, job] = entry;
    try {
      const initial = await getManga(id);
      if (
        !initial ||
        initial.updatedAt !== job.updatedAt ||
        (job.revision !== undefined && initial.revision !== job.revision)
      ) {
        continue;
      }
      for (let i = 0; i < initial.chapters.length; i++) {
        alive(job.controller.signal);
        if (!initial.chapters[i].pages.some((p) => p.dimensionsPending)) continue;
        await new Promise<void>((r) => setTimeout(r, 50));
        alive(job.controller.signal);
        if (!(await access(initial))) break;
        const stored = await getManga(id);
        if (
          !stored ||
          stored.updatedAt !== job.updatedAt ||
          (job.revision !== undefined && stored.revision !== job.revision)
        ) {
          break;
        }
        const issues = await prepareChapter(stored, i, { signal: job.controller.signal });
        job.updatedAt = stored.updatedAt;
        job.revision = stored.revision;
        if (issues.length > 0 && stored.chapters[i]?.pages.some((p) => p.dimensionsPending)) {
          break;
        }
      }
    } catch {
      /* Interrupted jobs remain pending in saved metadata and can resume later */
    } finally {
      if (backgroundJobs.get(id) === job) {
        backgroundJobs.delete(id);
      }
    }
  }
}

async function drainBackground(): Promise<void> {
  if (backgroundRunning) return;
  backgroundRunning = true;
  try {
    await runDrainPass();
  } finally {
    backgroundRunning = false;
    if (backgroundJobs.size > 0) {
      setTimeout(() => void drainBackground(), 100);
    }
  }
}

export async function resumeBackground(): Promise<void> {
  try {
    const list = await listLibrary();
    for (const item of list) {
      const m = await getManga(item.id);
      if (m && m.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))) {
        scheduleBackground(m);
      }
    }
  } catch (err) {
    console.warn('Failed to resume background jobs:', err);
  }
}

export function scanImage(_entry: SourceFile, _signal?: AbortSignal) {
  return Promise.resolve({ width: 0, height: 0 });
}
export function discardScan(_sources: Source[]): void { }
export async function warmSources(
  sources: Source[],
  options: ScanOptions = {},
  _sort: Manga['sort'] = 'natural',
): Promise<void> {
  for (const source of sources) {
    alive(options.signal);
    options.update?.({
      phase: 'discover',
      done: source.files.size,
      total: 0,
      title: source.title,
    });
  }
}