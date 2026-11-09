import { headerDimensions } from './imageDimensions';
import { uniqueSlug } from './paths';
import { openDB } from 'idb';
import {
  defaults,
  type Directory,
  type Page,
  type Position,
  type Manga,
  type Summary,
  type Progress,
  type Settings,
} from './model';
export { defaults } from './model';
export type {
  Directory,
  Page,
  Position,
  Chapter,
  Manga,
  Summary,
  Progress,
  Settings,
} from './model';
export {
  matchingPosition,
  validateBackup,
  ValidationError,
  parsePosition,
  parseSettings,
  parseManga,
  parseSummary,
  validateRelativePath,
} from './validation';
import {
  matchingPosition,
  validateBackup,
  parseManga,
  parseSummary,
  parsePosition,
  isRecord,
} from './validation';
import {
  limits,
  LimitError,
  assertAtMost,
  assertPathLimits,
  assertImageDimensions,
  assertMangaLimits,
  withinTime,
} from './limits';
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
const summary = (m: Manga): Summary => {
  const { chapters, cover, ...rest } = m;

  return {
    ...rest,
    chapterCount: chapters.length,
    chaptersRead: chapters.filter((c) => c.read).length,
    lastChapterName: chapters[m.lastChapter]?.name || '',
    hasProgress: chapters.some((c) => !!c.position),
    indexedAt: m.updatedAt,
  };
};
export const db = openDB('manga-reader', 2, {
  upgrade(d, old, _new, tx) {
    if (old < 1) {
      d.createObjectStore('manga', { keyPath: 'id' });
      d.createObjectStore('settings');
    }
    if (old < 2) {
      d.createObjectStore('summaries', { keyPath: 'id' });
      d.createObjectStore('covers');
      const p = d.createObjectStore('progress', { keyPath: ['mangaId', 'chapter'] });
      p.createIndex('mangaId', 'mangaId');
      void (async () => {
        let cursor = await tx.objectStore('manga').openCursor();
        while (cursor) {
          const m = cursor.value as Manga;
          await tx.objectStore('summaries').put(summary(m));
          if (m.cover) await tx.objectStore('covers').put(m.cover, m.id);
          for (const c of m.chapters)
            await tx.objectStore('progress').put({
              mangaId: m.id,
              chapter: c.name,
              read: c.read,
              position: c.position,
              bookmarks: c.bookmarks,
            });
          const { cover, ...metadata } = m;
          await cursor.update({
            ...metadata,
            chapters: m.chapters.map(({ position, bookmarks, ...c }) => ({ ...c, read: false })),
          });
          cursor = await cursor.continue();
        }
      })();
    }
  },
  blocking() {
    void db.then((d) => d.close());
  },
  blocked() {
    window.dispatchEvent(new CustomEvent('reader-storage-blocked'));
  },
});
export const sessionFiles = new Map<string, Map<string, SourceFile>>();
export const listLibrary = async (): Promise<Summary[]> => {
  const tx = (await db).transaction(['manga', 'summaries'], 'readwrite');
  const rawEntries = (await tx.objectStore('summaries').getAll()) as unknown[];
  const entries: Summary[] = [];
  for (const raw of rawEntries) {
    const s = parseSummary(raw);
    if (s) entries.push(s);
  }
  const used = new Set(entries.map((m) => m.slug).filter((s): s is string => !!s));
  for (const m of entries.sort((a, b) => a.addedAt - b.addedAt || a.id.localeCompare(b.id)))
    if (!m.slug) {
      m.slug = uniqueSlug(m.title, used);
      used.add(m.slug);
      await tx.objectStore('summaries').put(m);
      const stored = await tx.objectStore('manga').get(m.id);
      if (stored && isRecord(stored))
        await tx.objectStore('manga').put({ ...stored, slug: m.slug });
    }
  await tx.done;
  return entries.sort((a, b) => b.updatedAt - a.updatedAt);
};
export async function getManga(id: string): Promise<Manga | undefined> {
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
    d.get('covers', id),
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
          ? p.bookmarks.map((bm) => parsePosition(bm, c.pages)).filter((bm): bm is Position => !!bm)
          : c.bookmarks || [],
      };
    }),
  };
}
export async function allManga(): Promise<Manga[]> {
  return (await Promise.all((await listLibrary()).map((m) => getManga(m.id)))).filter(
    (m): m is Manga => !!m,
  );
}
export async function saveManga(m: Manga) {
  assertMangaLimits(m);
  m.updatedAt = Date.now();
  const tx = (await db).transaction(['manga', 'summaries', 'progress', 'covers'], 'readwrite');
  const existing = (await tx.objectStore('summaries').get(m.id)) as Summary | undefined;
  if (!existing && (await tx.objectStore('summaries').count()) >= limits.titles) {
    tx.abort();
    await tx.done.catch(() => {}); // Expected rejection from our explicit abort.
    throw new LimitError(
      `Library title limit is ${limits.titles}. Remove a title before importing.`,
    );
  }
  const entries = (await tx.objectStore('summaries').getAll()) as Summary[];
  m.slug =
    existing?.slug ||
    uniqueSlug(m.title, new Set(entries.filter((x) => x.id !== m.id).map((x) => x.slug || '')));
  const { cover, ...metadata } = m;
  await tx.objectStore('manga').put({
    ...metadata,
    chapters: m.chapters.map(({ position, bookmarks, ...c }) => ({ ...c, read: false })),
  });
  await tx.objectStore('summaries').put(summary(m));
  if (cover) await tx.objectStore('covers').put(cover, m.id);
  const keys = await tx.objectStore('progress').index('mangaId').getAllKeys(m.id);
  for (const k of keys) await tx.objectStore('progress').delete(k);
  for (const c of m.chapters)
    await tx.objectStore('progress').put({
      mangaId: m.id,
      chapter: c.name,
      read: c.read,
      position: c.position,
      bookmarks: c.bookmarks,
    });
  await tx.done;
}
export async function saveProgress(
  m: Manga,
  index: number,
  position: Position,
  read: boolean,
  bookmarks?: Position[],
  updateLast = true,
) {
  const chapter = m.chapters[index];
  if (!chapter) return;
  if (bookmarks)
    assertAtMost(bookmarks.length, limits.bookmarksPerChapter, 'Bookmarks per chapter');
  const tx = (await db).transaction(['progress', 'summaries'], 'readwrite');
  const s = (await tx.objectStore('summaries').get(m.id)) as Summary | undefined;
  if (!s || s.indexedAt !== m.updatedAt) {
    await tx.done;
    return;
  }
  const key = [m.id, chapter.name];
  const old = (await tx.objectStore('progress').get(key)) as Progress | undefined;
  const isRead = !!(old?.read || read);
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
}
export async function deleteManga(id: string) {
  stopBackground(id);
  const tx = (await db).transaction(['manga', 'summaries', 'covers', 'progress'], 'readwrite');
  await tx.objectStore('manga').delete(id);
  await tx.objectStore('summaries').delete(id);
  await tx.objectStore('covers').delete(id);
  for (const key of await tx.objectStore('progress').index('mangaId').getAllKeys(id))
    await tx.objectStore('progress').delete(key);
  await tx.done;
  sessionFiles.delete(id);
}
export async function clearLibrary() {
  for (const id of backgroundJobs.keys()) stopBackground(id);
  const tx = (await db).transaction(['manga', 'summaries', 'covers', 'progress'], 'readwrite');
  for (const name of ['manga', 'summaries', 'covers', 'progress'])
    await tx.objectStore(name).clear();
  await tx.done;
  sessionFiles.clear();
}
export function errorMessage(e: unknown) {
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
export async function fileFor(m: Manga, p: Page): Promise<File> {
  assertPathLimits(p.path);
  // Electron: read directly from the filesystem via IPC — works across restarts.
  const api = electronAPI();
  if (api?.isElectron && m.localPath) {
    const sep = m.localPath.includes('\\') ? '\\' : '/';
    const absPath = m.localPath + sep + p.path.split('/').join(sep);
    const buf = await withinTime(api.readFile(absPath), limits.ioTimeoutMs, 'Reading file');
    if (!buf) throw new Error('File not found on disk. The folder may have moved.');
    return new File([buf], p.path.split('/').at(-1) ?? p.path);
  }
  if (m.handle) {
    const parts = p.path.split('/');
    let h: FileSystemDirectoryHandle = m.handle;
    for (const part of parts.slice(0, -1))
      h = await withinTime(h.getDirectoryHandle(part), limits.ioTimeoutMs, 'Opening folder');
    const handle = await withinTime(
      h.getFileHandle(parts.at(-1)!),
      limits.ioTimeoutMs,
      'Opening file',
    );
    return readFile(handle);
  }
  const f = sessionFiles.get(m.id)?.get(p.path);
  if (!f) throw new Error('Folder access is needed. Re-link your folder to continue.');
  return readFile(f);
}
export async function access(m: Pick<Manga, 'id' | 'handle' | 'localPath'>, request = false) {
  // Electron: local files are always accessible via IPC; no permission model needed.
  if (electronAPI()?.isElectron) return m.localPath ? true : sessionFiles.has(m.id);
  if (!m.handle) return sessionFiles.has(m.id);
  try {
    return (
      (await withinTime(
        request
          ? m.handle.requestPermission({ mode: 'read' })
          : m.handle.queryPermission({ mode: 'read' }),
        limits.ioTimeoutMs,
        'Checking folder access',
      )) === 'granted'
    );
  } catch {
    return false;
  }
}
const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const lexical = new Intl.Collator(undefined, { sensitivity: 'base' });
export function naturalOrder(a: string, b: string) {
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
export const ignored = (path: string) =>
  path
    .split('/')
    .some(
      (p) =>
        p.startsWith('.') ||
        p === '__MACOSX' ||
        p.toLowerCase() === 'thumbs.db' ||
        p.toLowerCase() === 'desktop.ini',
    );
export const imageFile = (f: Pick<File, 'name' | 'type'>) =>
  f.type.startsWith('image/') ||
  /\.(jpe?g|png|webp|avif|gif|bmp|svg|ico|heic|heif|tiff?)$/i.test(f.name);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));
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
async function dimensions(f: File, signal?: AbortSignal) {
  alive(signal);
  const header = await headerDimensions(f);
  alive(signal);
  if (header) return header;
  const url = URL.createObjectURL(f);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const im = new Image();
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        im.onload = null;
        im.onerror = null;
        try {
          if (error) reject(error);
          else {
            assertImageDimensions(im.naturalWidth, im.naturalHeight);
            resolve({ width: im.naturalWidth, height: im.naturalHeight });
          }
        } catch (e) {
          reject(e);
        } finally {
          im.src = '';
        }
      };
      const abort = () => finish(new DOMException('Import cancelled', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error('Image took too long to read. Retry this file.')),
        limits.imageTimeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      im.onload = () => finish();
      im.onerror = () =>
        finish(new Error('Corrupt image or a format this browser cannot display.'));
      im.src = url;
      if (signal?.aborted) abort();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
async function thumbnail(file: File) {
  const size = await headerDimensions(file);
  // A cover is optional; avoid a second large decode just to make a thumbnail.
  if (
    size &&
    (size.width * size.height > limits.imagePixels ||
      Math.max(size.width, size.height) > limits.imageSide)
  )
    return undefined;
  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      const t = setTimeout(() => reject(new Error('Cover timed out')), limits.coverTimeoutMs);
      img.onload = () => {
        clearTimeout(t);
        resolve(img);
      };
      img.onerror = () => {
        clearTimeout(t);
        reject(new Error('Cover unavailable'));
      };
      img.src = url;
    });
    assertImageDimensions(im.naturalWidth, im.naturalHeight);
    const c = document.createElement('canvas');
    const scale = Math.min(160 / im.width, 320 / im.height);
    c.width = Math.max(1, Math.round(im.width * scale));
    c.height = Math.max(1, Math.round(im.height * scale));
    c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height);
    return await withinTime(
      new Promise<Blob | undefined>((r) => c.toBlob((b) => r(b ?? undefined), 'image/webp', 0.8)),
      limits.coverTimeoutMs,
      'Encoding cover',
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
// ElectronAPI shape exposed by preload.ts.
interface ElectronAPI {
  isElectron: boolean;
  selectFolder(): Promise<string | null>;
  listFolder(
    folderPath: string,
  ): Promise<{ relativePath: string; absolutePath: string; size: number; modified: number }[]>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
}
function electronAPI(): ElectronAPI | undefined {
  return (window as unknown as { electronAPI?: ElectronAPI }).electronAPI;
}
// Lazily reads a local file through the Electron IPC bridge (no browser permission needed).
class ElectronHandle {
  constructor(
    readonly name: string,
    private readonly absPath: string,
    readonly size: number,
    readonly lastModified: number,
  ) {}
  async getFile(): Promise<File> {
    const api = electronAPI();
    if (!api) throw new Error('Electron API not available.');
    const buf = await api.readFile(this.absPath);
    if (!buf) throw new Error('File not found on disk. The folder may have moved.');
    return new File([buf], this.name, { lastModified: this.lastModified });
  }
}
export type SourceFile = File | FileSystemFileHandle | ElectronHandle;
export type Source = {
  title: string;
  handle?: Directory;
  localPath?: string; // Electron only: absolute path to the folder on disk.
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
function scanImage(entry: SourceFile, signal?: AbortSignal) {
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
    const chapters = new Set(
      [...chapterGroups(source).keys()].sort(compare).slice(0, limits.warmChapters),
    );
    const entries = [...source.files].filter(([path]) =>
      chapters.has(path.includes('/') ? path.split('/').slice(0, -1).join(' / ') : 'Root pages'),
    );
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
  const source: Source = { title: handle.name, handle, files: new Map(), issues: [] };
  let count = 0;
  const chapterNames = new Set<string>();
  const queue: SourceFile[] = [];
  const tasks = new Set<Promise<void>>();
  let discovered = 0;
  let active = 0;
  const pump = () => {
    while (active < limits.decodeConcurrency && queue.length && !options.signal?.aborted) {
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
  async function walk(dir: Directory, prefix: string, depth: number) {
    alive(options.signal);
    if (depth > limits.directoryDepth) {
      source.issues.push({
        path: prefix,
        reason: `Folder nesting exceeds ${limits.directoryDepth} levels.`,
      });
      return;
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
      for (const entry of entries) {
        alive(options.signal);
        const path = prefix + entry.name;
        try {
          if (entry.kind === 'directory') await walk(entry as Directory, path + '/', depth + 1);
          else if (imageFile({ name: entry.name, type: '' }))
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
        if (count % 32 === 0) {
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
  try {
    await walk(handle, '', 0);
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
export async function fromElectronFolder(
  folderPath: string,
  options: ScanOptions = {},
): Promise<Source> {
  const api = electronAPI();
  if (!api) throw new Error('Electron API not available.');
  const folderName = folderPath.split(/[\\/]/).at(-1) ?? folderPath;
  const source: Source = { title: folderName, localPath: folderPath, files: new Map(), issues: [] };
  let entries: { relativePath: string; absolutePath: string; size: number; modified: number }[];
  try {
    entries = await withinTime(
      api.listFolder(folderPath),
      limits.ioTimeoutMs * 5,
      'Listing folder',
    );
  } catch (e) {
    throw new Error(errorMessage(e));
  }
  let discovered = 0;
  for (const entry of entries) {
    alive(options.signal);
    const relPath = entry.relativePath.replace(/\\/g, '/');
    if (ignored(relPath) || !imageFile({ name: relPath, type: '' })) continue;
    try {
      assertPathLimits(relPath);
      assertAtMost(++discovered, limits.discoveryEntries, 'Discovered entries');
      assertAtMost(source.files.size + 1, limits.pagesPerTitle, 'Image candidates per title');
      const name = relPath.split('/').at(-1) ?? relPath;
      source.files.set(
        relPath,
        new ElectronHandle(
          name,
          entry.absolutePath,
          entry.size,
          entry.modified,
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
async function pooled<T>(items: T[], work: (item: T) => Promise<void>, signal?: AbortSignal) {
  let next = 0;
  const results = await Promise.allSettled(
    Array.from({ length: Math.min(limits.decodeConcurrency, items.length) }, async () => {
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
  const issues = [...source.issues];
  const grouped = new Map<string, Page[]>();
  const oldPages = new Map(
    previous?.chapters.flatMap((c) => c.pages.map((p) => [p.path, p] as const)) || [],
  );
  const files = new Map(source.files);
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
    const known = entry instanceof File ? entry : undefined;
    const unchanged = !!(
      known &&
      cached &&
      !cached.dimensionsPending &&
      cached.size === known.size &&
      cached.modified === known.lastModified
    );
    const pages = grouped.get(name) || [];
    pages.push({
      name: parts.at(-1)!,
      path,
      width: cached?.width || 800,
      height: cached?.height || 1200,
      size: known?.size ?? cached?.size,
      modified: known?.lastModified ?? cached?.modified,
      dimensionsPending: !unchanged,
    });
    grouped.set(name, pages);
  }
  const first = [...grouped.keys()].sort(compare).slice(0, limits.warmChapters);
  const initial = first.flatMap((name) => grouped.get(name)!);
  let done = 0;
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
      if (done % 8 === 0 || done === initial.length) {
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
  const chapters = [...grouped]
    .sort(([a], [b]) => compare(a, b))
    .map(([name, p]) => {
      const pages = p.sort((a, b) => compare(a.name, b.name));
      const old = chapterMatch(name, pages, previous);
      const oldNames = new Set(old?.pages.map((p) => p.name));
      return {
        name,
        pages,
        read: !!old?.read && pages.every((p) => oldNames.has(p.name)),
        position: matchingPosition(old?.position, pages, old?.pages),
        bookmarks: (old?.bookmarks || [])
          .map((p) => matchingPosition(p, pages, old?.pages)!)
          .filter(Boolean),
      };
    });
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
    id: previous?.id || generateUUID(),
    title: source.title.trim(),
    chapters,
    handle: source.handle,
    localPath: source.localPath, // persisted so Electron can re-access files after restart
    cover,
    lastChapter: Math.max(0, lastChapter),
    addedAt: previous?.addedAt || Date.now(),
    updatedAt: Date.now(),
    sort,
  };
  await saveManga(m);
  if (!source.handle && !source.localPath) sessionFiles.set(m.id, files);
  else sessionFiles.delete(m.id);
  return { m, issues, reused };
}
/** Resolve a deferred chapter, without rewriting bookmarks, progress or index timestamps. */
export async function prepareChapter(m: Manga, index: number, options: ScanOptions = {}) {
  assertMangaLimits(m);
  const chapter = m.chapters[index];
  const cached = (await (await db).get('manga', m.id)) as Manga | undefined;
  alive(options.signal);
  const saved = cached?.updatedAt === m.updatedAt ? cached.chapters[index] : undefined;
  const pages = chapter.pages.map((p) => {
    const hit = saved?.pages.find((q) => q.path === p.path);
    return hit && !hit.dimensionsPending ? { ...hit } : { ...p };
  });
  const pending = pages.filter((p) => p.dimensionsPending);
  if (!pending.length) {
    m.chapters[index] = { ...chapter, pages };
    return [];
  }
  const issues: Issue[] = [];
  let done = 0;
  await pooled(
    pending,
    async (page) => {
      try {
        const file = await fileFor(m, page);
        alive(options.signal);
        if (!file.size) throw new Error('Empty file.');
        const size = await dimensions(file, options.signal);
        Object.assign(page, size, {
          size: file.size,
          modified: file.lastModified,
          dimensionsPending: false,
        });
      } catch (e) {
        alive(options.signal);
        issues.push({ path: page.path, reason: errorMessage(e) });
      }
      done++;
      if (done % 8 === 0 || done === pending.length) {
        options.update?.({ phase: 'index', done, total: pending.length, title: chapter.name });
        await tick();
      }
    },
    options.signal,
  );
  alive(options.signal);
  const tx = (await db).transaction('manga', 'readwrite');
  const stored = (await tx.store.get(m.id)) as Manga | undefined;
  if (stored && stored.updatedAt === m.updatedAt && stored.chapters[index]?.name === chapter.name) {
    stored.chapters[index].pages = pages;
    await tx.store.put(stored);
  }
  await tx.done;
  alive(options.signal);
  m.chapters[index] = { ...chapter, pages };
  return issues;
}
const backgroundJobs = new Map<string, { manga: Manga; controller: AbortController }>();
let backgroundRunning = false;
export function stopBackground(id: string) {
  backgroundJobs.get(id)?.controller.abort();
  backgroundJobs.delete(id);
}
export function scheduleBackground(manga: Manga) {
  if (
    backgroundJobs.has(manga.id) ||
    !manga.chapters.some((c) => c.pages.some((p) => p.dimensionsPending))
  )
    return;
  // Overflow stays pending in IndexedDB; opening that chapter prepares it on demand.
  if (backgroundJobs.size >= limits.queuedJobs) return;
  backgroundJobs.set(manga.id, { manga, controller: new AbortController() });
  void drainBackground();
}
async function drainBackground() {
  if (backgroundRunning) return;
  backgroundRunning = true;
  try {
    let remaining = backgroundJobs.size; // New arrivals run in a later bounded pass.
    while (backgroundJobs.size && remaining-- > 0) {
      const [id, job] = backgroundJobs.entries().next().value!;
      try {
        for (let i = 0; i < job.manga.chapters.length; i++) {
          alive(job.controller.signal);
          if (!job.manga.chapters[i].pages.some((p) => p.dimensionsPending)) continue;
          await new Promise<void>((r) => setTimeout(r, 100));
          alive(job.controller.signal);
          if (!(await access(job.manga))) break;
          const stored = await (await db).get('manga', id);
          if (!stored || stored.updatedAt !== job.manga.updatedAt) break;
          await prepareChapter(job.manga, i, { signal: job.controller.signal });
        }
      } catch {
        /* Interrupted jobs remain pending in saved metadata and can resume later. */
      } finally {
        if (backgroundJobs.get(id) === job) backgroundJobs.delete(id);
      }
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
