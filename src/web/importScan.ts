import { uniqueSlug, normalizePath } from '../paths';
import { type Directory, type Page, type Chapter, type Manga } from '../model';
import { matchingPosition, isRecord } from './validation';
import {
  limits,
  LimitError,
  assertAtMost,
  assertPathLimits,
  assertImageDimensions,
  withinTime,
} from '../limits';
import { desktopAPI, type FolderEntry } from '../tauriBridge';
import { dimensions, thumbnail, imageFile } from '../images';
import {
  db,
  getManga,
  listLibrary,
  saveManga,
  fileFor,
  access,
  errorMessage,
  onMangaDelete,
  sessionFiles,
  type SourceFile,
} from './storage';

/**
 * Generate a UUID v4. Prefers crypto.randomUUID() (secure contexts only),
 * and falls back to crypto.getRandomValues() which works everywhere.
 */
function generateUUID(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // RFC 4122 §4.4 UUID v4 via getRandomValues (works in non-secure contexts)
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6]! & 0x0f) | 0x40; // version 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10xx
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const lexical = new Intl.Collator(undefined, { sensitivity: 'base' });

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

/**
 * Natural sort a list of paths or names using native Rust command on desktop,
 * falling back to JavaScript naturalOrder collation on web.
 */
export async function naturalSortPaths(paths: string[]): Promise<string[]> {
  if (paths.length <= 1) return paths;
  if (desktopAPI.isDesktop && desktopAPI.naturalSortPaths) {
    return await desktopAPI.naturalSortPaths(paths);
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

const tick = () => {
  const sched = (
    typeof globalThis !== 'undefined'
      ? (globalThis as Record<string, unknown>).scheduler
      : undefined
  ) as { yield?: () => Promise<void> } | undefined;
  return typeof sched?.yield === 'function'
    ? sched.yield()
    : new Promise<void>((r) => setTimeout(r, 0));
};

function getDecodeConcurrency(): number {
  if (desktopAPI.isDesktop && typeof navigator !== 'undefined') {
    const cores = navigator.hardwareConcurrency || 4;
    const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (cores >= 8 && (!mem || mem >= 8)) {
      return 6;
    }
    if (cores >= 4 && (!mem || mem >= 4)) {
      return 4;
    }
  }
  return limits.decodeConcurrency;
}

const sessionDimensions = new Map<string, { width: number; height: number }>();

export function clearSessionDimensions(): void {
  sessionDimensions.clear();
}

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
  signal?: AbortSignal;
  update?: (state: ScanState) => void;
}

function alive(signal?: AbortSignal) {
  signal?.throwIfAborted();
}

// Lazily reads a local file through the desktop IPC bridge (no browser permission needed).
export class DesktopHandle {
  constructor(
    readonly name: string,
    readonly absPath: string,
    readonly size: number,
    readonly lastModified: number,
    readonly width?: number | null,
    readonly height?: number | null,
  ) {}
  async getFile(): Promise<File> {
    if (!desktopAPI.isDesktop) throw new Error('Desktop API not available.');
    const buf = await desktopAPI.readFile(this.absPath);
    if (!buf) throw new Error('File not found on disk. The folder may have moved.');
    return new File([buf], this.name, { lastModified: this.lastModified });
  }
}

export type { SourceFile };

export type Source = {
  title: string;
  handle?: Directory;
  localPath?: string; // Desktop only: absolute path to the folder on disk.
  files: Map<string, SourceFile>;
  issues: Issue[];
};

const readFile = (f: SourceFile) =>
  withinTime(
    f instanceof File ? Promise.resolve(f) : f.getFile(),
    limits.ioTimeoutMs,
    'Reading file',
  );

// Scan measurements are temporary until the user confirms import.
const scanned = new WeakMap<SourceFile, Promise<{ file: File; width: number; height: number }>>();

export function scanImage(entry: SourceFile, signal?: AbortSignal) {
  let task = scanned.get(entry);
  if (!task) {
    task = (async () => {
      alive(signal);
      const file = await readFile(entry);
      if (!file.size) throw new Error('Empty file.');
      const size = await dimensions(file, signal);
      alive(signal);
      return { file, ...size };
    })();
    scanned.set(entry, task);
    void task.catch(() => {
      // Failed reads must not poison later user-initiated retries.
      if (scanned.get(entry) === task) scanned.delete(entry);
    });
  }
  return task;
}

export function discardScan(sources: Source[]) {
  for (const source of sources) for (const entry of source.files.values()) scanned.delete(entry);
}

export async function warmSources(
  sources: Source[],
  options: ScanOptions = {},
  sort: Manga['sort'] = 'natural',
) {
  assertSourcesLimits(sources);
  for (const source of sources) {
    options.update?.({ phase: 'discover', done: source.files.size, total: 0, title: source.title });
    const compare =
      sort === 'name'
        ? lexical.compare
        : sort === 'reverse'
          ? (a: string, b: string) => naturalOrder(b, a)
          : naturalOrder;
    let chapterKeys = [...chapterGroups(source).keys()];
    if (desktopAPI.isDesktop && desktopAPI.naturalSortPaths && sort !== 'name') {
      chapterKeys = await desktopAPI.naturalSortPaths(chapterKeys);
      if (sort === 'reverse') chapterKeys.reverse();
    } else {
      chapterKeys.sort(compare);
    }
    const chapters = new Set(chapterKeys.slice(0, limits.warmChapters));
    const entries = [...source.files].filter(([path, entry]) => {
      if (entry instanceof DesktopHandle && entry.width && entry.height) {
        return false;
      }
      return chapters.has(
        path.includes('/') ? path.split('/').slice(0, -1).join(' / ') : 'Root pages',
      );
    });
    await pooled(
      entries,
      async ([, entry]) => {
        try {
          await scanImage(entry, options.signal);
        } catch (e) {
          alive(options.signal);
          if (e instanceof DOMException && e.name === 'AbortError') {
            scanned.delete(entry);
            try {
              await scanImage(entry, options.signal);
            } catch {
              alive(options.signal);
            }
          }
        }
      },
      options.signal,
    );
  }
}

function assertSourceLimits(source: Source) {
  assertAtMost(source.files.size, limits.pagesPerTitle, 'Image candidates per title');
  for (const path of source.files.keys()) assertPathLimits(path);
  assertAtMost(chapterGroups(source).size, limits.chaptersPerTitle, 'Chapters per title');
}

function assertSourcesLimits(sources: Source[]) {
  assertAtMost(sources.length, limits.titles, 'Selected titles');
  let total = 0;
  for (const source of sources) {
    total += source.files.size;
    assertAtMost(total, limits.discoveryEntries, 'Selected image candidates');
    assertSourceLimits(source);
  }
}

async function* directoryEntries(dir: Directory, signal?: AbortSignal) {
  const iterator = dir.values();
  try {
    for (let count = 0; count <= limits.discoveryEntries; count++) {
      alive(signal);
      const result = await withinTime(
        iterator.next(),
        limits.ioTimeoutMs,
        'Reading folder',
        signal,
      );
      if (result.done) return;
      assertAtMost(count + 1, limits.discoveryEntries, 'Folder entries');
      yield result.value;
    }
  } finally {
    if (iterator.return)
      await withinTime(iterator.return(), limits.ioTimeoutMs, 'Closing folder iterator');
  }
}

export async function fromHandle(handle: Directory, options: ScanOptions = {}): Promise<Source> {
  if (typeof __DESKTOP_BUILD__ !== 'undefined' && __DESKTOP_BUILD__) {
    throw new Error('fromHandle is not supported in desktop builds');
  }
  const source: Source = { title: handle.name, handle, files: new Map(), issues: [] };
  let count = 0;
  const chapterNames = new Set<string>();
  const queue: SourceFile[] = [];
  const tasks = new Set<Promise<void>>();
  let discovered = 0;
  let active = 0;
  const pump = () => {
    while (active < getDecodeConcurrency() && queue.length && !options.signal?.aborted) {
      const entry = queue.shift()!;
      active++;
      const task = scanImage(entry, options.signal)
        .then(
          () => {},
          () => {},
        )
        .finally(() => {
          active--;
          tasks.delete(task);
          pump();
        });
      tasks.add(task);
    }
  };
  const add = async (path: string, entry: SourceFile) => {
    assertPathLimits(path);
    assertAtMost(
      source.files.size + (source.files.has(path) ? 0 : 1),
      limits.pagesPerTitle,
      'Image candidates per title',
    );
    source.files.set(path, entry);
    const chapter = path.includes('/') ? path.split('/').slice(0, -1).join(' / ') : 'Root pages';
    // A root cover is not an extra chapter when other pages exist.
    if (path.includes('/') || !/^(thumbnail|cover)\./i.test(path)) chapterNames.add(chapter);
    assertAtMost(chapterNames.size, limits.chaptersPerTitle, 'Chapters per title');
    if ([...chapterNames].sort(naturalOrder).slice(0, limits.warmChapters).includes(chapter)) {
      // Wait for one worker before retaining another queued source handle.
      while (queue.length >= limits.queuedJobs) {
        alive(options.signal);
        await Promise.race(tasks);
      }
      alive(options.signal);
      queue.push(entry);
      pump();
    }
  };

  interface StackFrame {
    dir: Directory;
    prefix: string;
    depth: number;
  }
  const stack: StackFrame[] = [{ dir: handle, prefix: '', depth: 0 }];
  let lastYield = performance.now();

  try {
    while (stack.length > 0) {
      alive(options.signal);
      const { dir, prefix, depth } = stack.pop()!;
      if (depth > limits.directoryDepth) {
        source.issues.push({
          path: prefix,
          reason: `Folder nesting exceeds ${limits.directoryDepth} levels.`,
        });
        continue;
      }
      try {
        const entries: FileSystemHandle[] = [];
        for await (const entry of directoryEntries(dir, options.signal)) {
          alive(options.signal);
          assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
          assertAtMost(
            (prefix + entry.name).length,
            limits.pathChars,
            'Relative path length (characters)',
          );
          if (!ignored(prefix + entry.name)) entries.push(entry);
        }
        entries.sort((a, b) => naturalOrder(a.name, b.name));

        // Push subdirectories in reverse order so pop() processes alphabetically
        for (let i = entries.length - 1; i >= 0; i--) {
          const entry = entries[i];
          const path = prefix + entry.name;
          if (entry.kind === 'directory') {
            stack.push({ dir: entry as Directory, prefix: path + '/', depth: depth + 1 });
          }
        }

        // Process files
        for (const entry of entries) {
          if (entry.kind === 'directory') continue;
          alive(options.signal);
          const path = prefix + entry.name;
          try {
            if (imageFile({ name: entry.name, type: '' }))
              await add(path, entry as FileSystemFileHandle);
            else {
              const file = await readFile(entry as FileSystemFileHandle);
              if (imageFile(file)) await add(path, entry as FileSystemFileHandle);
            }
          } catch (e) {
            alive(options.signal);
            if (e instanceof LimitError) throw e;
            source.issues.push({ path, reason: errorMessage(e) });
          }
          count++;
          const now = performance.now();
          if (count % 16 === 0 || now - lastYield >= 10) {
            lastYield = now;
            options.update?.({ phase: 'discover', done: count, total: 0, title: handle.name });
            await tick();
          }
        }
      } catch (e) {
        alive(options.signal);
        if (e instanceof LimitError) throw e;
        source.issues.push({ path: prefix || handle.name, reason: errorMessage(e) });
      }
    }

    while (active || queue.length) {
      alive(options.signal);
      await Promise.all(tasks);
    }
    await warmSources([source], options);
    alive(options.signal);
    options.update?.({ phase: 'discover', done: count, total: count, title: handle.name });
    return source;
  } catch (e) {
    queue.length = 0;
    await Promise.all(tasks);
    discardScan([source]);
    throw e;
  }
}

export function fromFiles(list: File[]): Source[] {
  if (typeof __DESKTOP_BUILD__ !== 'undefined' && __DESKTOP_BUILD__) {
    return [];
  }
  assertAtMost(list.length, limits.discoveryEntries, 'Selected files');
  const groups = new Map<string, Source>();
  for (const f of list) {
    const parts = (f.webkitRelativePath || f.name).split('/');
    const title = parts.length > 1 ? parts.shift()! : 'Selected images';
    const path = parts.join('/');
    if (ignored(path) || !imageFile(f)) continue;
    assertPathLimits(path);
    const group = groups.get(title) || { title, files: new Map(), issues: [] };
    group.files.set(path, f);
    groups.set(title, group);
    assertAtMost(group.files.size, limits.pagesPerTitle, 'Image candidates per title');
    assertAtMost(groups.size, limits.titles, 'Selected titles');
  }
  const sources = [...groups.values()];
  sources.forEach(assertSourceLimits);
  return sources;
}

export async function fromDesktopFolder(
  folderPath: string,
  options: ScanOptions = {},
): Promise<Source> {
  if (!desktopAPI.isDesktop) throw new Error('Desktop API not available.');
  void desktopAPI.recordOpenedRoot?.(folderPath);
  const folderName = folderPath.split(/[\\/]/).at(-1) ?? folderPath;
  const source: Source = { title: folderName, localPath: folderPath, files: new Map(), issues: [] };

  // 1. Prefer native Rust library discovery when available
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
      if (e instanceof LimitError) {
        throw e;
      }
    }
  }

  // 2. Fallback to listFolder
  let entries: FolderEntry[];
  try {
    entries = await withinTime(
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
  } catch (e) {
    throw new Error(errorMessage(e));
  }
  let discovered = 0;
  for (const entry of entries) {
    alive(options.signal);
    const relPath = normalizePath(entry.relativePath);
    if (ignored(relPath) || !imageFile({ name: relPath, type: '' })) continue;
    try {
      assertPathLimits(relPath);
      assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
      assertAtMost(source.files.size + 1, limits.pagesPerTitle, 'Image candidates per title');
      const name = relPath.split('/').at(-1) ?? relPath;
      source.files.set(
        relPath,
        new DesktopHandle(
          name,
          entry.absolutePath,
          entry.size,
          entry.modified,
          entry.width,
          entry.height,
        ) as unknown as FileSystemFileHandle,
      );
    } catch (e) {
      if (e instanceof LimitError) throw e;
      source.issues.push({ path: relPath, reason: errorMessage(e) });
    }
    if (discovered % 256 === 0)
      options.update?.({ phase: 'discover', done: source.files.size, total: 0, title: folderName });
  }
  options.update?.({
    phase: 'discover',
    done: source.files.size,
    total: source.files.size,
    title: folderName,
  });
  await warmSources([source], options);
  return source;
}

interface Entry {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file(cb: (f: File) => void, err: (e: Error) => void): void;
  createReader(): { readEntries(cb: (e: Entry[]) => void, err: (e: Error) => void): void };
}

export function droppedSources(
  items: DataTransferItem[],
  options: ScanOptions,
): () => Promise<Source[]> {
  if (typeof __DESKTOP_BUILD__ !== 'undefined' && __DESKTOP_BUILD__) {
    return async () => [];
  }
  // Reject asynchronously: App.drop owns cleanup in the returned promise chain.
  if (items.length > limits.discoveryEntries)
    return async () => {
      throw new LimitError(`Dropped items exceed the limit of ${limits.discoveryEntries}.`);
    };
  // Snapshot entries and start handle requests while the drop event is active.
  const entries = items
    .filter((i) => i.kind === 'file')
    .map((item) => {
      const typed = item as DataTransferItem & {
        getAsFileSystemHandle?: () => Promise<FileSystemHandle | null>;
      };
      return {
        entry: item.webkitGetAsEntry?.() as unknown as Entry | null,
        file: item.getAsFile(),
        handle: typed.getAsFileSystemHandle
          ? withinTime(
              typed.getAsFileSystemHandle(),
              limits.ioTimeoutMs,
              'Reading dropped handle',
              options.signal,
            ).catch(() => null)
          : undefined,
      };
    });
  return async () => {
    let discovered = 0;
    const sources: Source[] = [],
      loose: File[] = [];
    for (const item of entries) {
      alive(options.signal);
      assertAtMost(sources.length + 1, limits.titles, 'Dropped titles');
      const handle = await item.handle;
      if (handle?.kind === 'directory') {
        sources.push(await fromHandle(handle as Directory, options));
        assertSourcesLimits(sources);
        continue;
      }
      if (item.entry?.isDirectory) {
        const files = new Map<string, SourceFile>(),
          issues: Issue[] = [];
        async function walk(e: Entry, path: string, depth: number) {
          alive(options.signal);
          if (ignored(path)) return;
          // Count directories, not the leaf file (which is one recursion level deeper).
          if (!e.isFile && depth > limits.directoryDepth) {
            issues.push({
              path,
              reason: `Folder nesting exceeds ${limits.directoryDepth} levels.`,
            });
            return;
          }
          try {
            assertAtMost(path.length, limits.pathChars, 'Relative path length (characters)');
            if (e.isFile) {
              if (imageFile({ name: e.name, type: '' })) {
                assertPathLimits(path);
                assertAtMost(
                  files.size + (files.has(path) ? 0 : 1),
                  limits.pagesPerTitle,
                  'Image candidates per title',
                );
                files.set(
                  path,
                  await withinTime(
                    new Promise<File>((r, j) => e.file(r, j)),
                    limits.ioTimeoutMs,
                    'Reading dropped file',
                    options.signal,
                  ),
                );
              }
              return;
            }
            const reader = e.createReader();
            while (true) {
              alive(options.signal);
              const list = await withinTime(
                new Promise<Entry[]>((r, j) => reader.readEntries(r, j)),
                limits.ioTimeoutMs,
                'Reading dropped folder',
                options.signal,
              );
              if (!list.length) break;
              discovered += list.length;
              assertAtMost(discovered, limits.discoveryEntries, 'Discovered entries');
              for (const child of list.sort((a, b) => naturalOrder(a.name, b.name)))
                await walk(child, path ? path + '/' + child.name : child.name, depth + 1);
              await warmSources([{ title: item.entry?.name || 'Manga', files, issues }], options);
              options.update?.({
                phase: 'discover',
                done: files.size,
                total: 0,
                title: item.entry?.name,
              });
              await tick();
            }
          } catch (e) {
            alive(options.signal);
            if (e instanceof LimitError) throw e;
            issues.push({ path, reason: errorMessage(e) });
          }
        }
        await walk(item.entry, '', 0);
        sources.push({ title: item.entry.name, files, issues });
        assertSourcesLimits(sources);
      } else if (item.file) loose.push(item.file);
    }
    sources.push(...fromFiles(loose));
    assertSourcesLimits(sources);
    return sources;
  };
}

export async function splitSource(source: Source): Promise<Source[]> {
  assertSourceLimits(source);
  const result = new Map<string, Source>();
  for (const [path, file] of source.files) {
    const parts = path.split('/');
    const title = parts.length > 1 ? parts.shift()! : source.title + ' — root pages';
    const s = result.get(title) || { title, files: new Map(), issues: [] };
    s.files.set(parts.join('/'), file);
    result.set(title, s);
    assertAtMost(result.size, limits.titles, 'Selected titles');
  }
  for (const s of result.values())
    if (source.handle && s.title !== source.title + ' — root pages') {
      try {
        s.handle = (await withinTime(
          source.handle.getDirectoryHandle(s.title),
          limits.ioTimeoutMs,
          'Opening subfolder',
        )) as Directory;
      } catch (e) {
        s.issues.push({ path: s.title, reason: errorMessage(e) });
      }
    }
  return [...result.values()];
}

export function chapterGroups(source: Source) {
  const groups = new Map<string, number>();
  for (const path of source.files.keys()) {
    const parts = path.split('/');
    const name = parts.length === 1 ? 'Root pages' : parts.slice(0, -1).join(' / ');
    if (parts.length === 1 && /^(thumbnail|cover)\./i.test(path) && source.files.size > 1) continue;
    groups.set(name, (groups.get(name) || 0) + 1);
  }
  return groups;
}

function chapterMatch(name: string, pages: Page[], old: Manga | undefined) {
  const exact = old?.chapters.find((c) => c.name === name);
  if (exact) return exact;
  const signature = (p: Page) => `${p.name}\0${p.size ?? ''}\0${p.modified ?? ''}`;
  const values = new Set(pages.map(signature));
  const matches = old?.chapters.filter(
    (c) => c.pages.length === pages.length && c.pages.every((p) => values.has(signature(p))),
  );
  return matches?.length === 1 ? matches[0] : undefined;
}

export async function pooled<T>(
  items: T[],
  work: (item: T) => Promise<void>,
  signal?: AbortSignal,
) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(getDecodeConcurrency(), items.length) }, async () => {
      while (next < items.length) {
        alive(signal);
        await work(items[next++]);
      }
    }),
  );
  const failure = results.find((r) => r.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

export async function indexSource(
  source: Source,
  options: ScanOptions = {},
  previous?: Manga,
  sort: Manga['sort'] = 'natural',
) {
  assertSourceLimits(source);
  if (previous) stopBackground(previous.id);

  // High-performance native Rust indexing on desktop
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

  // High-performance native Rust indexing on desktop
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

  const issues = [...source.issues];
  const grouped = new Map<string, Page[]>();
  const oldPages = new Map(
    previous?.chapters.flatMap((c) => c.pages.map((p) => [p.path, p] as const)) || [],
  );
  let reused = 0;
  const compare =
    sort === 'name'
      ? lexical.compare
      : sort === 'reverse'
        ? (a: string, b: string) => naturalOrder(b, a)
        : naturalOrder;
  for (const [path, entry] of source.files) {
    alive(options.signal);
    if (!path.includes('/') && /^(thumbnail|cover)\./i.test(path) && source.files.size > 1)
      continue;
    const parts = path.split('/');
    const name = parts.length === 1 ? 'Root pages' : parts.slice(0, -1).join(' / ');
    const cached = oldPages.get(path);
    const desktop = entry instanceof DesktopHandle ? entry : undefined;
    const known = entry instanceof File ? entry : desktop;
    const knownModified = entry instanceof File ? entry.lastModified : desktop?.lastModified;
    const hasDesktopDim = Boolean(desktop?.width && desktop?.height);
    const unchanged = Boolean(
      known &&
      cached &&
      !cached.dimensionsPending &&
      cached.size === known.size &&
      cached.modified === knownModified,
    );
    const pages = grouped.get(name) || [];
    pages.push({
      name: parts.at(-1)!,
      path,
      width: desktop?.width ?? cached?.width ?? 800,
      height: desktop?.height ?? cached?.height ?? 1200,
      size: known?.size ?? cached?.size,
      modified: knownModified ?? cached?.modified,
      dimensionsPending: !unchanged && !hasDesktopDim,
    });
    grouped.set(name, pages);
  }
  const naturalSort = desktopAPI.isDesktop ? desktopAPI.naturalSortPaths : undefined;
  let chapterNames = [...grouped.keys()];
  if (naturalSort && sort !== 'name') {
    chapterNames = await naturalSort(chapterNames);
    if (sort === 'reverse') chapterNames.reverse();
  } else {
    chapterNames.sort(compare);
  }
  const first = chapterNames.slice(0, limits.warmChapters);
  const initial = first.flatMap((name) => grouped.get(name)!);
  let done = 0;
  let lastYield = performance.now();
  options.update?.({
    phase: 'index',
    done,
    total: initial.length,
    title: source.title + ' · first 5 chapters',
  });
  const failed = new Set<string>();
  await pooled(
    initial,
    async (page) => {
      try {
        const entry = source.files.get(page.path)!;
        const desktop = entry instanceof DesktopHandle ? entry : undefined;
        if (desktop?.width && desktop?.height && !page.dimensionsPending) {
          assertImageDimensions(desktop.width, desktop.height);
          done++;
          return;
        }
        if (desktop && desktopAPI.isDesktop && desktopAPI.getImageDimensions) {
          const dim = await desktopAPI.getImageDimensions(desktop.absPath);
          if (dim && dim.width > 0 && dim.height > 0) {
            assertImageDimensions(dim.width, dim.height);
            Object.assign(page, {
              width: dim.width,
              height: dim.height,
              size: desktop.size,
              modified: desktop.lastModified,
              dimensionsPending: false,
            });
            done++;
            return;
          }
        }
        const staged = scanned.get(entry);
        const measured = staged ? await staged : undefined;
        const f = measured?.file || (await readFile(entry));
        alive(options.signal);
        if (!f.size) throw new Error('Empty file.');
        const cached = oldPages.get(page.path);
        let size;
        if (measured) size = measured;
        else if (
          cached &&
          !cached.dimensionsPending &&
          cached.size === f.size &&
          cached.modified === f.lastModified
        ) {
          size = cached;
          reused++;
        } else size = await dimensions(f, options.signal);
        assertImageDimensions(size.width, size.height);
        Object.assign(page, {
          width: size.width,
          height: size.height,
          size: f.size,
          modified: f.lastModified,
          dimensionsPending: false,
        });
      } catch (e) {
        alive(options.signal);
        issues.push({ path: page.path, reason: errorMessage(e) });
        failed.add(page.path);
      }
      done++;
      const now = performance.now();
      if (done % 8 === 0 || done === initial.length || now - lastYield >= 10) {
        lastYield = now;
        options.update?.({
          phase: 'index',
          done,
          total: initial.length,
          title: source.title + ' · first 5 chapters',
        });
        await tick();
      }
    },
    options.signal,
  );
  for (const [name, pages] of grouped) {
    const kept = pages.filter((p) => !failed.has(p.path));
    if (kept.length) grouped.set(name, kept);
    else grouped.delete(name);
  }
  const sortedNames =
    naturalSort && sort !== 'name'
      ? await (async () => {
          const names = await naturalSort([...grouped.keys()]);
          return sort === 'reverse' ? names.reverse() : names;
        })()
      : [...grouped.keys()].sort(compare);

  const chapters = await Promise.all(
    sortedNames.map(async (name) => {
      const p = grouped.get(name)!;
      let pages: Page[];
      if (naturalSort && sort !== 'name' && p.length > 1) {
        const pageNames = p.map((pg) => pg.name);
        const sortedPageNames = await naturalSort(pageNames);
        if (sort === 'reverse') sortedPageNames.reverse();
        const pMap = new Map(p.map((pg) => [pg.name, pg]));
        pages = sortedPageNames.map((n) => pMap.get(n)!).filter(Boolean);
      } else {
        pages = p.sort((a, b) => compare(a.name, b.name));
      }
      const old = chapterMatch(name, pages, previous);
      const oldNames = new Set(old?.pages.map((p) => p.name));
      return {
        name,
        pages,
        read: Boolean(old?.read && pages.every((p) => oldNames.has(p.name))),
        position: matchingPosition(old?.position, pages, old?.pages),
        bookmarks: (old?.bookmarks || [])
          .map((p) => matchingPosition(p, pages, old?.pages)!)
          .filter(Boolean),
      };
    }),
  );
  if (!chapters.length)
    throw new Error(
      issues.length
        ? `No readable pages. ${issues[0].path}: ${issues[0].reason}`
        : 'No image pages found in this selection.',
    );
  const coverEntry = [...source.files]
    .sort(([a], [b]) => natural.compare(a, b))
    .find(([p]) => !p.includes('/') && /^(thumbnail|cover)\./i.test(p))?.[1];
  let cover = previous?.cover;
  const mangaId = previous?.id || generateUUID();

  // Desktop optimization (C2): Generate thumbnail in Rust via image crate + fast_image_resize directly from disk
  const targetEntry = coverEntry || source.files.get(chapters[0].pages[0].path);
  if (
    !cover &&
    desktopAPI.isDesktop &&
    desktopAPI.generateThumbnail &&
    targetEntry &&
    'absPath' in targetEntry &&
    typeof (targetEntry as any).absPath === 'string'
  ) {
    try {
      await desktopAPI.generateThumbnail((targetEntry as any).absPath, mangaId);
      // Thumbnail generated and saved atomically on disk under cache/thumbnails/{mangaId}.webp
      // Cover Blob is left undefined to prevent memory retention and JS-to-Rust IPC upload
    } catch {
      // Fallback to JS canvas thumbnail path
    }
  }

  // Web fallback: ImageBitmap and canvas path only for web builds
  if (!cover && !desktopAPI.isDesktop) {
    try {
      cover = await thumbnail(
        await readFile(coverEntry || source.files.get(chapters[0].pages[0].path)!),
      );
    } catch {
      try {
        cover = await thumbnail(await readFile(source.files.get(chapters[0].pages[0].path)!));
      } catch {
        /* A text cover is displayed if no preview can be decoded. */
      }
    }
  }
  alive(options.signal);
  const oldChapter = previous?.chapters[previous.lastChapter];
  const oldName = oldChapter?.name;
  let lastChapter = chapters.findIndex((c) => c.name === oldName);
  if (lastChapter < 0 && oldChapter)
    lastChapter = chapters.findIndex(
      (c) =>
        c.position?.path &&
        oldChapter.pages.some((p) => p.name === c.position?.path?.split('/').at(-1)),
    );
  const m: Manga = {
    id: mangaId,
    title: source.title.trim(),
    chapters,
    handle: source.handle,
    localPath: source.localPath, // persisted so native desktop can re-access files after restart
    cover,
    lastChapter: Math.max(0, lastChapter),
    addedAt: previous?.addedAt || Date.now(),
    updatedAt: Date.now(),
    sort,
  };
  const used = new Set(
    (await listLibrary()).map((x) => x.slug).filter((s): s is string => Boolean(s)),
  );
  m.slug = uniqueSlug(m.title, used);
  await saveManga(m);
  if (!source.handle && !source.localPath) sessionFiles.set(m.id, source.files);
  else sessionFiles.delete(m.id);
  return { m, issues, reused };
}

export async function prepareChapter(
  m: Manga,
  index: number,
  options: { signal?: AbortSignal; update?: (state: ScanState) => void } = {},
) {
  const chapter = m.chapters[index];
  if (!chapter) return [];
  const database = typeof indexedDB !== 'undefined' ? await db : undefined;
  const cached = database ? ((await database.get('manga', m.id)) as Manga | undefined) : undefined;
  alive(options.signal);
  const savedChapter =
    cached?.updatedAt === m.updatedAt || cached?.chapters[index]?.name === chapter.name
      ? cached.chapters[index]
      : undefined;
  const savedMap = new Map(savedChapter?.pages.map((p) => [p.path, p]));
  const pages = chapter.pages.map((p) => {
    const hit = savedMap.get(p.path);
    if (hit && !hit.dimensionsPending) {
      sessionDimensions.set(`${m.id}:${p.path}`, { width: hit.width, height: hit.height });
      return { ...hit };
    }
    const sessionHit = sessionDimensions.get(`${m.id}:${p.path}`);
    if (sessionHit) {
      return { ...p, ...sessionHit, dimensionsPending: false };
    }
    return { ...p };
  });
  const pending = pages.filter((p) => p.dimensionsPending);
  if (!pending.length) {
    m.chapters[index] = { ...chapter, pages };
    return [];
  }

  // Batch dimension extraction via native Rust prepareChapterHeaders on desktop
  if (desktopAPI.isDesktop && desktopAPI.prepareChapterHeaders && m.localPath) {
    const sep = m.localPath.includes('\\') ? '\\' : '/';
    const pathMap = new Map<string, Page>();
    const absPaths: string[] = [];
    for (const page of pending) {
      const absPath = m.localPath + sep + page.path.split('/').join(sep);
      pathMap.set(absPath, page);
      absPaths.push(absPath);
    }
    try {
      const headers = await desktopAPI.prepareChapterHeaders(absPaths);
      for (const h of headers) {
        const page = pathMap.get(h.path);
        if (page && h.width > 0 && h.height > 0) {
          assertImageDimensions(h.width, h.height);
          page.width = h.width;
          page.height = h.height;
          page.size = h.size;
          page.modified = h.modified;
          page.dimensionsPending = false;
          sessionDimensions.set(`${m.id}:${page.path}`, { width: h.width, height: h.height });
        }
      }
    } catch {
      // Fall through to per-page resolution
    }
  }

  const remainingPending = pages.filter((p) => p.dimensionsPending);
  if (!remainingPending.length) {
    alive(options.signal);
    if (database) {
      const tx = database.transaction('manga', 'readwrite');
      const stored = (await tx.store.get(m.id)) as unknown as Manga | undefined;
      if (
        stored &&
        stored.updatedAt === m.updatedAt &&
        (m.revision === undefined || stored.revision === m.revision) &&
        stored.chapters[index]?.name === chapter.name
      ) {
        stored.chapters[index].pages = pages;
        await tx.store.put(stored as unknown as Omit<Manga, 'cover'>);
      }
      await tx.done;
    }
    alive(options.signal);
    m.chapters[index] = { ...chapter, pages };
    return [];
  }

  const issues: Issue[] = [];
  let done = 0;
  let lastYield = performance.now();
  await pooled(
    remainingPending,
    async (page) => {
      try {
        if (desktopAPI.isDesktop && desktopAPI.getImageDimensions && m.localPath) {
          const sep = m.localPath.includes('\\') ? '\\' : '/';
          const absPath = m.localPath + sep + page.path.split('/').join(sep);
          const dim = await desktopAPI.getImageDimensions(absPath);
          if (dim && dim.width > 0 && dim.height > 0) {
            assertImageDimensions(dim.width, dim.height);
            Object.assign(page, dim, { dimensionsPending: false });
            sessionDimensions.set(`${m.id}:${page.path}`, {
              width: dim.width,
              height: dim.height,
            });
            done++;
            const now = performance.now();
            if (done % 8 === 0 || done === pending.length || now - lastYield >= 10) {
              lastYield = now;
              options.update?.({
                phase: 'index',
                done,
                total: pending.length,
                title: chapter.name,
              });
              await tick();
            }
            return;
          }
        }
        const file = await fileFor(m, page);
        alive(options.signal);
        if (!file.size) throw new Error('Empty file.');
        const size = await dimensions(file, options.signal);
        Object.assign(page, size, {
          size: file.size,
          modified: file.lastModified,
          dimensionsPending: false,
        });
        sessionDimensions.set(`${m.id}:${page.path}`, { width: size.width, height: size.height });
      } catch (e) {
        alive(options.signal);
        issues.push({ path: page.path, reason: errorMessage(e) });
      }
      done++;
      const now = performance.now();
      if (done % 8 === 0 || done === pending.length || now - lastYield >= 10) {
        lastYield = now;
        options.update?.({ phase: 'index', done, total: pending.length, title: chapter.name });
        await tick();
      }
    },
    options.signal,
  );
  alive(options.signal);
  if (database) {
    const tx = database.transaction('manga', 'readwrite');
    const stored = (await tx.store.get(m.id)) as unknown as Manga | undefined;
    if (
      stored &&
      stored.updatedAt === m.updatedAt &&
      (m.revision === undefined || stored.revision === m.revision) &&
      stored.chapters[index]?.name === chapter.name
    ) {
      stored.chapters[index].pages = pages;
      await tx.store.put(stored as unknown as Omit<Manga, 'cover'>);
    }
    await tx.done;
  }
  alive(options.signal);
  m.chapters[index] = { ...chapter, pages };
  return issues;
}

interface BackgroundJob {
  id: string;
  revision?: number;
  updatedAt: number;
  controller: AbortController;
}

const backgroundJobs = new Map<string, BackgroundJob>();
let backgroundRunning = false;

export function stopBackground(id: string) {
  backgroundJobs.get(id)?.controller.abort();
  backgroundJobs.delete(id);
}

export function stopAllBackground() {
  for (const job of backgroundJobs.values()) {
    job.controller.abort();
  }
  backgroundJobs.clear();
}

// Subscribe to manga deletions so jobs are cleanly halted
onMangaDelete((id) => {
  if (id) stopBackground(id);
  else stopAllBackground();
});

export function scheduleBackground(manga: Manga) {
  if (
    backgroundJobs.has(manga.id) ||
    !manga.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))
  )
    return;
  // Overflow stays pending in IndexedDB; opening that chapter prepares it on demand.
  if (backgroundJobs.size >= limits.queuedJobs) return;
  backgroundJobs.set(manga.id, {
    id: manga.id,
    revision: manga.revision,
    updatedAt: manga.updatedAt,
    controller: new AbortController(),
  });
  void drainBackground();
}

async function runDrainPass() {
  let remaining = backgroundJobs.size; // New arrivals run in a later bounded pass.
  while (backgroundJobs.size && remaining-- > 0) {
    const [id, job] = backgroundJobs.entries().next().value!;
    try {
      const manga = await getManga(id);
      if (
        !manga ||
        manga.updatedAt !== job.updatedAt ||
        (job.revision !== undefined && manga.revision !== job.revision)
      ) {
        break;
      }
      for (let i = 0; i < manga.chapters.length; i++) {
        alive(job.controller.signal);
        if (!manga.chapters[i].pages.some((p) => p.dimensionsPending)) continue;
        await new Promise<void>((r) => setTimeout(r, 100));
        alive(job.controller.signal);
        if (!(await access(manga))) break;
        const stored = await (await db).get('manga', id);
        if (
          !stored ||
          stored.updatedAt !== job.updatedAt ||
          (job.revision !== undefined && stored.revision !== job.revision)
        ) {
          break;
        }
        await prepareChapter(manga, i, { signal: job.controller.signal });
      }
    } catch {
      /* Interrupted jobs remain pending in saved metadata and can resume later. */
    } finally {
      if (backgroundJobs.get(id) === job) backgroundJobs.delete(id);
    }
  }
}

async function drainBackground() {
  if (backgroundRunning) return;
  backgroundRunning = true;
  try {
    if (typeof navigator !== 'undefined' && 'locks' in navigator && navigator.locks?.request) {
      await navigator.locks.request('manga-reader:bg-prep', { ifAvailable: true }, async (lock) => {
        if (!lock) return;
        await runDrainPass();
      });
    } else {
      await runDrainPass();
    }
  } finally {
    backgroundRunning = false;
    if (backgroundJobs.size) setTimeout(() => void drainBackground(), 0);
  }
}

export async function resumeBackground() {
  for (const item of await listLibrary()) {
    const m = await getManga(item.id);
    if (m && (await access(m))) scheduleBackground(m);
  }
}
