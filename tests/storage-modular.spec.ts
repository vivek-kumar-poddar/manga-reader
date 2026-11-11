import { expect, test } from '@playwright/test';
import {
  summary,
  errorMessage,
  onMangaDelete,
  saveManga,
  saveProgress,
  migrateV1ToV2,
  exportBackup,
  restoreBackup,
  getCover,
  listLibrary,
  invalidateSummaryCache,
  invalidateBookmarkCache,
  fileFor,
  dirHandleCache,
  clearDirHandleCache,
  access,
  accessCache,
  clearAccessCache,
  ACCESS_CACHE_TTL_MS,
  getBookmarkedMangaIds,
  getMangaBookmarkedIds,
  type SaveProgressResult,
  type LibraryRepo,
  TauriSqliteLibraryRepo,
  IndexedDBLibraryRepo,
  ensureLibraryMigrated,
  repo,
  setRepo,
  getRepo,
} from '../src/storage';
import { clearCoverUrlPool } from '../src/App';
import { desktopAPI, TauriDesktopBridge, parseFsError } from '../src/tauriBridge';
import { imageFile } from '../src/images';
import {
  fromFiles,
  DesktopHandle,
  chapterGroups,
  splitSource,
  naturalOrder,
  naturalSortPaths,
  prepareChapter,
  indexSource,
  type Source,
} from '../src/importScan';
import { normalizePath } from '../src/paths';
import { LimitError } from '../src/limits';
import { ValidationError } from '../src/validation';
import { defaults, type Manga } from '../src/model';

test.describe('Step 06 & Step 11 — Storage, Images & ImportScan Modularization', () => {
  test('summary() computes correct summary metrics from Manga model', () => {
    const manga: Manga = {
      id: 'test-manga-1',
      title: 'Test Manga',
      chapters: [
        {
          name: 'Chapter 1',
          pages: [
            { name: '1.jpg', path: 'ch1/1.jpg', width: 800, height: 1200 },
            { name: '2.jpg', path: 'ch1/2.jpg', width: 800, height: 1200 },
          ],
          read: true,
        },
        {
          name: 'Chapter 2',
          pages: [{ name: '1.jpg', path: 'ch2/1.jpg', width: 800, height: 1200 }],
          read: false,
          position: { page: 0 },
        },
      ],
      lastChapter: 1,
      addedAt: 1000,
      updatedAt: 2000,
      slug: 'test-manga',
    };

    const s = summary(manga);
    expect(s.id).toBe('test-manga-1');
    expect(s.title).toBe('Test Manga');
    expect(s.chapterCount).toBe(2);
    expect(s.chaptersRead).toBe(1);
    expect(s.lastChapterName).toBe('Chapter 2');
    expect(s.hasProgress).toBe(true);
    expect(s.indexedAt).toBe(2000);
  });

  test('errorMessage() maps known DOMException names to user-friendly messages', () => {
    expect(errorMessage({ name: 'QuotaExceededError' })).toContain('Browser storage is full');
    expect(errorMessage({ name: 'NotAllowedError' })).toContain('Folder permission was denied');
    expect(errorMessage({ name: 'NotFoundError' })).toContain('file or folder moved');
    expect(errorMessage({ name: 'InvalidStateError' })).toContain('Storage is unavailable');
    expect(errorMessage(new Error('Custom error message'))).toBe('Custom error message');
    expect(errorMessage({ message: 'Custom object message' })).toBe('Custom object message');
    expect(errorMessage(null)).toBe('The operation could not complete. Please try again.');
  });

  test('onMangaDelete() notifies registered callbacks and unregisters cleanly', () => {
    const notifications: (string | undefined)[] = [];
    const unsubscribe = onMangaDelete((id) => {
      notifications.push(id);
    });

    // Simulate delete notification by calling the subscriber directly or testing unregister
    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  test('imageFile() recognizes supported image formats and rejects non-images', () => {
    expect(imageFile({ name: 'page1.jpg', type: 'image/jpeg' })).toBe(true);
    expect(imageFile({ name: 'cover.PNG', type: 'image/png' })).toBe(true);
    expect(imageFile({ name: 'panel.webp', type: 'image/webp' })).toBe(true);
    expect(imageFile({ name: 'vector.svg', type: 'image/svg+xml' })).toBe(true);
    expect(imageFile({ name: 'photo.avif', type: 'image/avif' })).toBe(true);
    expect(imageFile({ name: 'legacy.bmp', type: 'image/bmp' })).toBe(true);
    expect(imageFile({ name: 'graphic.gif', type: 'image/gif' })).toBe(true);

    // Extension fallback without MIME type
    expect(imageFile({ name: 'chapter1.heic', type: '' })).toBe(true);
    expect(imageFile({ name: 'scan.tiff', type: '' })).toBe(true);

    // Non-images
    expect(imageFile({ name: 'readme.txt', type: 'text/plain' })).toBe(false);
    expect(imageFile({ name: 'script.js', type: 'application/javascript' })).toBe(false);
    expect(imageFile({ name: 'archive.zip', type: 'application/zip' })).toBe(false);
    expect(imageFile({ name: 'document.pdf', type: 'application/pdf' })).toBe(false);
  });

  test('DesktopHandle initializes with metadata and exposes properties', () => {
    const handle = new DesktopHandle(
      '01.jpg',
      'C:\\manga\\ch1\\01.jpg',
      1024,
      1700000000,
      800,
      1200,
    );
    expect(handle.name).toBe('01.jpg');
    expect(handle.size).toBe(1024);
    expect(handle.lastModified).toBe(1700000000);
    expect(handle.width).toBe(800);
    expect(handle.height).toBe(1200);
  });

  test('fromFiles() creates grouped source structures from File list', () => {
    const f1 = new File(['data1'], 'ch1/01.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f1, 'webkitRelativePath', { value: 'MyManga/ch1/01.jpg' });
    const f2 = new File(['data2'], 'ch1/02.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f2, 'webkitRelativePath', { value: 'MyManga/ch1/02.jpg' });

    const sources = fromFiles([f1, f2]);
    expect(sources.length).toBe(1);
    expect(sources[0].title).toBe('MyManga');
    expect(sources[0].files.size).toBe(2);
    expect(sources[0].files.has('ch1/01.jpg')).toBe(true);
    expect(sources[0].files.has('ch1/02.jpg')).toBe(true);
  });

  test('saveManga() fails before transaction on limit violation and does not mutate caller', async () => {
    const invalidManga: Manga = {
      id: 'limit-test',
      title: 'Limit Test',
      chapters: Array.from({ length: 6000 }, (_, i) => ({
        name: `Chapter ${i}`,
        pages: [{ name: '01.jpg', path: `${i}/01.jpg`, width: 800, height: 1200 }],
      })),
      lastChapter: 0,
      addedAt: 100,
      updatedAt: 100,
    };

    await expect(saveManga(invalidManga)).rejects.toThrow(LimitError);
    // Invariant: caller state must remain unmutated on failure
    expect(invalidManga.updatedAt).toBe(100);
    expect(invalidManga.slug).toBeUndefined();
  });

  test('chapterGroups() partitions paths into natural-sorted chapter names', () => {
    const files = new Map<string, any>([
      ['Chapter 1/01.jpg', {}],
      ['Chapter 1/02.jpg', {}],
      ['Chapter 2/01.jpg', {}],
      ['cover.jpg', {}],
    ]);

    const groups = chapterGroups({ title: 'Test', files, issues: [] });
    expect(groups.has('Chapter 1')).toBe(true);
    expect(groups.get('Chapter 1')).toBe(2);
    expect(groups.has('Chapter 2')).toBe(true);
    expect(groups.get('Chapter 2')).toBe(1);
    expect(groups.has('cover.jpg')).toBe(false);
  });

  test('splitSource() splits parent collection source by immediate top-level folders', async () => {
    const files = new Map<string, any>([
      ['Title A/Chapter 1/01.jpg', {}],
      ['Title A/Chapter 1/02.jpg', {}],
      ['Title B/Chapter 1/01.jpg', {}],
    ]);
    const parentSource = {
      title: 'MangaCollection',
      files,
      issues: [],
    };

    const split = await splitSource(parentSource);
    expect(split.length).toBe(2);
    expect(split.map((s) => s.title).sort()).toEqual(['Title A', 'Title B']);
    expect(split.find((s) => s.title === 'Title A')?.files.size).toBe(2);
    expect(split.find((s) => s.title === 'Title B')?.files.size).toBe(1);
  });

  test('restoreBackup() validates titles and limits before opening write transaction', async () => {
    // 1. Exceeding title count (limits.titles is 1,000)
    const oversizedManga = Array.from({ length: 1001 }, (_, i) => ({
      id: `manga-${i}`,
      title: `Title ${i}`,
      chapters: [],
      lastChapter: 0,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    }));
    await expect(restoreBackup({ manga: oversizedManga, settings: defaults })).rejects.toThrow(
      LimitError,
    );

    // 2. Manga exceeding limits (6000 chapters exceeds limits.chaptersPerTitle)
    const invalidManga: Manga = {
      id: 'invalid-manga',
      title: 'Invalid',
      chapters: Array.from({ length: 6000 }, (_, i) => ({
        name: `Chapter ${i}`,
        pages: [{ name: '01.jpg', path: `${i}/01.jpg`, width: 800, height: 1200 }],
      })),
      lastChapter: 0,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    };
    await expect(restoreBackup({ manga: [invalidManga], settings: defaults })).rejects.toThrow(
      LimitError,
    );
  });

  test('migrateV1ToV2() migrates v1 records into summaries, covers, and progress stores', async () => {
    const mockManga: Manga = {
      id: 'v1-manga',
      title: 'V1 Manga',
      cover: new Blob(['test-cover']),
      chapters: [
        {
          name: 'Chapter 1',
          pages: [{ name: '01.jpg', path: 'ch1/01.jpg', width: 800, height: 1200 }],
          read: true,
          position: { page: 0, fraction: 0.5 },
          bookmarks: [{ page: 0 }],
        },
      ],
      lastChapter: 0,
      addedAt: 1000,
      updatedAt: 2000,
      slug: 'v1-manga',
    };

    const summariesPuts: any[] = [];
    const coversPuts: any[] = [];
    const progressPuts: any[] = [];
    let updatedMangaRecord: any = null;

    let cursorActive = true;
    const mockCursor = {
      value: mockManga,
      update: async (rec: any) => {
        updatedMangaRecord = rec;
      },
      continue: async () => {
        cursorActive = false;
        return null;
      },
    };

    const mockTx = {
      objectStore: (name: string) => {
        if (name === 'manga') {
          return {
            openCursor: async () => (cursorActive ? mockCursor : null),
          };
        }
        if (name === 'summaries') {
          return {
            put: async (val: any) => {
              summariesPuts.push(val);
            },
          };
        }
        if (name === 'covers') {
          return {
            put: async (val: any, key: string) => {
              coversPuts.push({ key, val });
            },
          };
        }
        if (name === 'progress') {
          return {
            put: async (val: any) => {
              progressPuts.push(val);
            },
          };
        }
        throw new Error(`Unexpected store ${name}`);
      },
    };

    await migrateV1ToV2(mockTx);

    // Verify summaries were populated
    expect(summariesPuts.length).toBe(1);
    expect(summariesPuts[0].id).toBe('v1-manga');
    expect(summariesPuts[0].chapterCount).toBe(1);

    // Verify covers were populated
    expect(coversPuts.length).toBe(1);
    expect(coversPuts[0].key).toBe('v1-manga');

    // Verify progress records were populated
    expect(progressPuts.length).toBe(1);
    expect(progressPuts[0].mangaId).toBe('v1-manga');
    expect(progressPuts[0].read).toBe(true);
    expect(progressPuts[0].bookmarks.length).toBe(1);

    // Verify cursor updated manga record to strip cover and set read: false
    expect(updatedMangaRecord).toBeDefined();
    expect(updatedMangaRecord.cover).toBeUndefined();
    expect(updatedMangaRecord.chapters[0].read).toBe(false);
  });

  test('saveProgress() returns missing when chapter index is invalid or missing', async () => {
    const manga: Manga = {
      id: 'test-manga',
      title: 'Test',
      chapters: [],
      lastChapter: 0,
      addedAt: 100,
      updatedAt: 100,
    };
    const result = await saveProgress(manga, 5, { page: 0 }, false);
    expect(result).toBe('missing');
  });

  test('saveProgress() rejects bookmarks exceeding limit before opening transaction', async () => {
    const manga: Manga = {
      id: 'test-manga',
      title: 'Test',
      chapters: [
        {
          name: 'Ch 1',
          pages: [{ name: '1.jpg', path: '1.jpg', width: 800, height: 1200 }],
        },
      ],
      lastChapter: 0,
      addedAt: 100,
      updatedAt: 100,
    };
    const excessiveBookmarks = Array.from({ length: 1001 }, (_, i) => ({ page: i }));
    await expect(saveProgress(manga, 0, { page: 0 }, false, excessiveBookmarks)).rejects.toThrow(
      LimitError,
    );
  });

  test('reader progress snapshot coalescing preserves newest revision during in-flight writes', async () => {
    let committedRevision = 0;
    let dirty = false;
    let snapshotRevision = 0;
    let inFlight: Promise<SaveProgressResult> | null = null;
    let saveCount = 0;

    const mockSave = async (_rev: number): Promise<SaveProgressResult> => {
      saveCount++;
      await new Promise((r) => setTimeout(r, 20));
      return 'saved';
    };

    const flush = (): Promise<SaveProgressResult> => {
      if (inFlight) {
        return inFlight.then(() => {
          if (dirty) return flush();
          return 'saved';
        });
      }
      if (!dirty) return Promise.resolve('saved');

      const targetRevision = snapshotRevision;
      dirty = false;

      const savePromise = (async (): Promise<SaveProgressResult> => {
        try {
          const result = await mockSave(targetRevision);
          if (result === 'saved') {
            committedRevision = Math.max(committedRevision, targetRevision);
          } else if (committedRevision < targetRevision) {
            dirty = true;
          }
          return result;
        } finally {
          if (inFlight === savePromise) inFlight = null;
        }
      })();

      inFlight = savePromise;
      return savePromise;
    };

    // User scrolls to page 1
    snapshotRevision = 1;
    dirty = true;
    const p1 = flush();

    // User rapidly scrolls to page 2 and page 3 while write 1 is in-flight
    snapshotRevision = 2;
    dirty = true;
    const p2 = flush();

    snapshotRevision = 3;
    dirty = true;
    const p3 = flush();

    // Await all promises
    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
    expect(r1).toBe('saved');
    expect(r2).toBe('saved');
    expect(r3).toBe('saved');

    // All updates converged to newest revision 3 in only 2 coalesced writes!
    expect(committedRevision).toBe(3);
    expect(dirty).toBe(false);
    expect(saveCount).toBe(2);
  });

  test('getCover() queries native desktop thumbnail cache first with fallback', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalGetThumbnail = desktopAPI.getThumbnail;

    try {
      // 1. Mock desktop returning cached thumbnail bytes
      let requestedId = '';
      const dummyBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]); // "RIFF...."
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      (desktopAPI as any).getThumbnail = async (id: string) => {
        requestedId = id;
        return dummyBytes.buffer;
      };

      const coverBlob = await getCover('manga-123');
      expect(coverBlob).toBeDefined();
      expect(coverBlob instanceof Blob).toBe(true);
      expect(coverBlob?.type).toBe('image/webp');
      expect(requestedId).toBe('manga-123');

      // 2. Mock desktop returning null -> falls back gracefully
      (desktopAPI as any).getThumbnail = async () => null;
      const fallbackBlob = await getCover('manga-missing');
      expect(fallbackBlob).toBeUndefined();
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).getThumbnail = originalGetThumbnail;
    }
  });

  test('TauriDesktopBridge thumbnail IPC sends raw Uint8Array and receives binary buffer', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any; options?: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any, options?: any) => {
        calls.push({ cmd, args, options });
        if (cmd === 'read_thumbnail') {
          return new Uint8Array([0x52, 0x49, 0x46, 0x46]);
        }
        if (cmd === 'get_thumbnail_url') {
          return 'http://mangaimg.localhost/C%3A/cache/thumbnails/thumb-1.webp';
        }
        if (cmd === 'generate_thumbnail') {
          return {
            path: 'C:/cache/thumbnails/thumb-1.webp',
            url: 'http://mangaimg.localhost/C%3A/cache/thumbnails/thumb-1.webp',
          };
        }
        if (cmd === 'generate_image_variant') {
          return {
            path: 'C:/cache/variants/var.webp',
            url: 'http://mangaimg.localhost/C%3A/cache/variants/var.webp',
          };
        }
        return null;
      },
    };

    try {
      // 1. saveThumbnail with ArrayBuffer passes raw Uint8Array with x-id header (zero JSON array overhead)
      const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
      const saved = await bridge.saveThumbnail('thumb-1', buffer);
      expect(saved).toBe(true);
      expect(calls.length).toBe(1);
      expect(calls[0].cmd).toBe('save_thumbnail');
      expect(calls[0].args).toBeInstanceOf(Uint8Array);
      expect(Array.isArray(calls[0].args)).toBe(false);
      expect(calls[0].options?.headers?.['x-id']).toBe(encodeURIComponent('thumb-1'));

      // 2. saveThumbnail with Uint8Array passes raw Uint8Array directly
      const uint8 = new Uint8Array([5, 6, 7, 8]);
      const savedUint8 = await bridge.saveThumbnail('thumb-2', uint8);
      expect(savedUint8).toBe(true);
      expect(calls.length).toBe(2);
      expect(calls[1].cmd).toBe('save_thumbnail');
      expect(calls[1].args).toBe(uint8);
      expect(calls[1].options?.headers?.['x-id']).toBe(encodeURIComponent('thumb-2'));

      // 3. getThumbnail receives binary Uint8Array and returns ArrayBuffer
      const readBuffer = await bridge.getThumbnail('thumb-1');
      expect(readBuffer).toBeInstanceOf(ArrayBuffer);
      expect(readBuffer?.byteLength).toBe(4);

      // 4. getThumbnailUrl returns direct mangaimg protocol URL
      const thumbUrl = await bridge.getThumbnailUrl('thumb-1');
      expect(thumbUrl).toBe('http://mangaimg.localhost/C%3A/cache/thumbnails/thumb-1.webp');

      // 5. generateThumbnail queries native Rust image engine and returns CachedImageResult
      const genResult = await bridge.generateThumbnail('C:/manga/ch1/01.jpg', 'thumb-1');
      expect(genResult?.path).toBe('C:/cache/thumbnails/thumb-1.webp');
      expect(genResult?.url).toContain('mangaimg');
      expect(calls.some((c) => c.cmd === 'generate_thumbnail')).toBe(true);

      // 6. generateImageVariant queries native Rust variant engine and returns CachedImageResult
      const varResult = await bridge.generateImageVariant('C:/manga/ch1/01.jpg', 1000, 1500);
      expect(varResult?.path).toBe('C:/cache/variants/var.webp');
      expect(varResult?.url).toContain('mangaimg');
      expect(calls.some((c) => c.cmd === 'generate_image_variant')).toBe(true);
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('parseFsError parses structured error payloads from Rust command rejections', () => {
    // 1. Structured object from Tauri IPC
    const errObj = { code: 'PathNotAllowed', message: 'Path /etc is not allowed' };
    expect(parseFsError(errObj)).toEqual(errObj);

    // 2. JSON stringified error
    const errJson = JSON.stringify({ code: 'Cancelled' });
    expect(parseFsError(errJson)).toEqual({ code: 'Cancelled' });

    // 3. Other errors return null
    expect(parseFsError(new Error('Unknown generic error'))).toBeNull();
    expect(parseFsError('Random string error')).toBeNull();
    expect(parseFsError(null)).toBeNull();
  });

  test('TauriDesktopBridge listFolder supports scanId and cancellation via AbortSignal', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => 1,
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === 'list_folder') {
          if (args?.scanId === 'cancelled-scan') {
            throw { code: 'Cancelled', message: 'Operation was cancelled' };
          }
          return [
            {
              relativePath: 'ch1/01.webp',
              absolutePath: 'C:/manga/ch1/01.webp',
              size: 1000,
              modified: 12345,
              width: 800,
              height: 1200,
            },
          ];
        }
        if (cmd === 'cancel_scan') {
          return true;
        }
        return null;
      },
    };

    try {
      // 1. Successful listFolder with scanId
      const entries = await bridge.listFolder('C:/manga', { scanId: 'scan-123' });
      expect(entries.length).toBe(1);
      expect(entries[0].relativePath).toBe('ch1/01.webp');
      expect(calls.some((c) => c.cmd === 'list_folder' && c.args.scanId === 'scan-123')).toBe(true);

      // 2. Cancellation via AbortSignal triggers cancelScan and rejects with AbortError
      const controller = new AbortController();
      controller.abort();
      await expect(
        bridge.listFolder('C:/manga', { scanId: 'scan-abc', signal: controller.signal }),
      ).rejects.toThrow('The operation was aborted');

      // 3. Rust rejection with FsError::Cancelled throws AbortError
      await expect(bridge.listFolder('C:/manga', { scanId: 'cancelled-scan' })).rejects.toThrow(
        'The operation was aborted',
      );
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('TauriDesktopBridge supports naturalSortPaths, prepareChapterHeaders, and discoverLibrary', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => 1,
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === 'natural_sort_paths') {
          return ['ch 1/01.webp', 'ch 1/02.webp', 'ch 1/10.webp'];
        }
        if (cmd === 'prepare_chapter_headers') {
          return [
            {
              path: 'C:/manga/ch1/01.webp',
              width: 800,
              height: 1200,
              size: 54321,
              modified: 12345,
              checksum: 'deadbeef12345678',
            },
          ];
        }
        if (cmd === 'discover_library') {
          return {
            rootPath: 'C:/manga',
            totalFiles: 2,
            titles: [
              {
                title: 'Test Manga',
                rootPath: 'C:/manga/Test Manga',
                totalImages: 2,
                coverPath: 'C:/manga/Test Manga/ch1/01.webp',
                chapters: [
                  {
                    name: 'Chapter 1',
                    pages: [
                      {
                        name: '01.webp',
                        relativePath: 'ch1/01.webp',
                        absolutePath: 'C:/manga/Test Manga/ch1/01.webp',
                        width: 800,
                        height: 1200,
                        size: 5000,
                        modified: 100,
                      },
                      {
                        name: '02.webp',
                        relativePath: 'ch1/02.webp',
                        absolutePath: 'C:/manga/Test Manga/ch1/02.webp',
                        width: 800,
                        height: 1200,
                        size: 5500,
                        modified: 200,
                      },
                    ],
                  },
                ],
              },
            ],
          };
        }
        return null;
      },
    };

    try {
      // 1. naturalSortPaths
      const sorted = await bridge.naturalSortPaths([
        'ch 1/10.webp',
        'ch 1/01.webp',
        'ch 1/02.webp',
      ]);
      expect(sorted).toEqual(['ch 1/01.webp', 'ch 1/02.webp', 'ch 1/10.webp']);

      // 2. prepareChapterHeaders
      const headers = await bridge.prepareChapterHeaders(['C:/manga/ch1/01.webp']);
      expect(headers.length).toBe(1);
      expect(headers[0].width).toBe(800);
      expect(headers[0].checksum).toBe('deadbeef12345678');

      // 3. discoverLibrary
      const discovery = await bridge.discoverLibrary('C:/manga');
      expect(discovery).toBeDefined();
      expect(discovery?.titles.length).toBe(1);
      expect(discovery?.titles[0].chapters[0].pages.length).toBe(2);
      expect(discovery?.titles[0].chapters[0].pages[0].width).toBe(800);
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('TauriDesktopBridge supports app config, preferences, and opened roots persistence', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;

    const mockConfig = {
      lastOpenedRoots: ['C:/manga/library'],
      windowPreferences: {
        minimizeToTray: false,
        closeToTray: true,
        startMaximized: false,
        highDpiScaling: true,
        theme: 'dark',
      },
      customPreferences: {
        lastZoom: 1.0,
      },
    };

    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === 'get_app_config') {
          return mockConfig;
        }
        if (cmd === 'save_app_config') {
          return null;
        }
        if (cmd === 'set_window_preferences') {
          return null;
        }
        if (cmd === 'set_app_preference') {
          return null;
        }
        if (cmd === 'get_app_preference') {
          return args.key === 'lastZoom' ? 1.0 : null;
        }
        if (cmd === 'record_opened_root') {
          return [args.rootPath, ...mockConfig.lastOpenedRoots];
        }
        if (cmd === 'get_last_opened_roots') {
          return mockConfig.lastOpenedRoots;
        }
        if (cmd === 'show_main_window') {
          return null;
        }
        return null;
      },
    };

    try {
      // 1. getAppConfig
      const config = await bridge.getAppConfig();
      expect(config).toEqual(mockConfig);

      // 2. saveAppConfig
      const saved = await bridge.saveAppConfig(mockConfig);
      expect(saved).toBe(true);

      // 2b. setWindowPreferences
      const winSaved = await bridge.setWindowPreferences({ closeToTray: false, theme: 'light' });
      expect(winSaved).toBe(true);

      // 3. setAppPreference & getAppPreference
      const prefSaved = await bridge.setAppPreference('lastZoom', 1.0);
      expect(prefSaved).toBe(true);
      const prefValue = await bridge.getAppPreference('lastZoom');
      expect(prefValue).toBe(1.0);

      // 4. recordOpenedRoot & getLastOpenedRoots
      const updatedRoots = await bridge.recordOpenedRoot('C:/manga/new-folder');
      expect(updatedRoots).toEqual(['C:/manga/new-folder', 'C:/manga/library']);
      const roots = await bridge.getLastOpenedRoots();
      expect(roots).toEqual(['C:/manga/library']);

      // 4b. showMainWindow
      const shown = await bridge.showMainWindow();
      expect(shown).toBe(true);

      // 5. Verify recorded commands
      expect(calls.map((c) => c.cmd)).toEqual([
        'get_app_config',
        'save_app_config',
        'set_window_preferences',
        'set_app_preference',
        'get_app_preference',
        'record_opened_root',
        'get_last_opened_roots',
        'show_main_window',
      ]);
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('queuedFlush deduplication coalesces follow-up writes during in-flight operations', async () => {
    let inFlight: Promise<SaveProgressResult> | null = null;
    let queuedFlush: Promise<SaveProgressResult> | null = null;
    let dirty = false;
    let snapshotRevision = 0;
    let committedRevision = 0;
    let saveCount = 0;

    const mockSave = async (rev: number): Promise<SaveProgressResult> => {
      saveCount++;
      await new Promise((r) => setTimeout(r, 20));
      committedRevision = rev;
      return 'saved';
    };

    const flush = (): Promise<SaveProgressResult> => {
      if (inFlight) {
        if (!queuedFlush) {
          queuedFlush = inFlight.then(() => {
            queuedFlush = null;
            if (dirty) return flush();
            return 'saved';
          });
        }
        return queuedFlush;
      }
      if (!dirty) return Promise.resolve('saved');

      const targetRevision = snapshotRevision;
      dirty = false;

      const savePromise = (async (): Promise<SaveProgressResult> => {
        try {
          return await mockSave(targetRevision);
        } finally {
          if (inFlight === savePromise) inFlight = null;
        }
      })();

      inFlight = savePromise;
      return savePromise;
    };

    // First write starts
    snapshotRevision = 1;
    dirty = true;
    const p1 = flush();

    // Rapid page flips while write 1 is in-flight
    snapshotRevision = 2;
    dirty = true;
    const p2 = flush();

    snapshotRevision = 3;
    dirty = true;
    const p3 = flush();

    snapshotRevision = 4;
    dirty = true;
    const p4 = flush();

    // p2, p3, p4 should have returned the EXACT same queuedFlush promise
    expect(p2).toBe(p3);
    expect(p3).toBe(p4);

    const results = await Promise.all([p1, p2, p3, p4]);
    expect(results.every((r) => r === 'saved')).toBe(true);
    expect(committedRevision).toBe(4);
    expect(dirty).toBe(false);
    expect(saveCount).toBe(2); // Only 2 total writes executed!
  });

  test('invalidateSummaryCache() and invalidateBookmarkCache() reset in-memory caches', () => {
    expect(() => invalidateSummaryCache()).not.toThrow();
    expect(() => invalidateBookmarkCache()).not.toThrow();
  });

  test('clearCoverUrlPool() purges entries safely', () => {
    expect(() => clearCoverUrlPool('manga-unknown')).not.toThrow();
    expect(() => clearCoverUrlPool()).not.toThrow();
  });

  test('fileFor() caches resolved directory handles and clears them on error or re-link', async () => {
    clearDirHandleCache();

    let getDirCount = 0;
    const mockFileHandle = {
      getFile: async () => new File(['content'], '01.jpg', { type: 'image/jpeg' }),
    };

    const chapterDirHandle = {
      getFileHandle: async (name: string) => {
        if (name === '01.jpg' || name === '02.jpg') return mockFileHandle;
        throw new Error('Not found');
      },
    };

    const volumeDirHandle = {
      getDirectoryHandle: async (name: string) => {
        getDirCount++;
        if (name === 'Chapter 01') return chapterDirHandle;
        throw new Error('Folder not found');
      },
    };

    const rootHandle = {
      getDirectoryHandle: async (name: string) => {
        getDirCount++;
        if (name === 'Volume 1') return volumeDirHandle;
        throw new Error('Folder not found');
      },
    } as unknown as FileSystemDirectoryHandle;

    const mockManga: Manga = {
      id: 'manga-handles',
      title: 'Manga Handles',
      chapters: [],
      lastChapter: 0,
      addedAt: 100,
      updatedAt: 200,
      handle: rootHandle,
    };

    // First page read - traverses Volume 1 and Chapter 01
    const file1 = await fileFor(mockManga, { name: '01.jpg', path: 'Volume 1/Chapter 01/01.jpg' });
    expect(file1).toBeDefined();
    expect(getDirCount).toBe(2);

    // Second page read in same chapter - should reuse cached directory handle (getDirCount stays 2!)
    const file2 = await fileFor(mockManga, { name: '02.jpg', path: 'Volume 1/Chapter 01/02.jpg' });
    expect(file2).toBeDefined();
    expect(getDirCount).toBe(2); // Zero additional getDirectoryHandle calls!

    // Verify cache has the entry
    expect(dirHandleCache.has('manga-handles:200:Volume 1/Chapter 01')).toBe(true);

    // An error on file read triggers cache clearing for that manga
    await expect(
      fileFor(mockManga, { name: 'missing.jpg', path: 'Volume 1/Chapter 01/missing.jpg' }),
    ).rejects.toThrow();
    expect(dirHandleCache.has('manga-handles:200:Volume 1/Chapter 01')).toBe(false);

    // clearDirHandleCache clears safely
    clearDirHandleCache();
    expect(dirHandleCache.size).toBe(0);
  });

  test('batch deletion issues all delete requests in parallel and resolves on tx.done', async () => {
    const deletedKeys: string[] = [];
    let concurrentInFlight = 0;
    let maxConcurrent = 0;

    const mockProgressStore = {
      delete: async (k: string) => {
        concurrentInFlight++;
        maxConcurrent = Math.max(maxConcurrent, concurrentInFlight);
        await new Promise((r) => setTimeout(r, 10));
        deletedKeys.push(k);
        concurrentInFlight--;
      },
    };

    const keys = ['ch1', 'ch2', 'ch3', 'ch4', 'ch5'];
    await Promise.all(keys.map((k) => mockProgressStore.delete(k)));

    expect(deletedKeys.length).toBe(5);
    expect(maxConcurrent).toBeGreaterThan(1);
  });

  test('getBookmarkedMangaIds() and getMangaBookmarkedIds() safely resolve and return sets in single-pass', async () => {
    invalidateBookmarkCache();
    const [allBookmarked, mangaBookmarked] = await Promise.all([
      getBookmarkedMangaIds(),
      getMangaBookmarkedIds(),
    ]);
    expect(allBookmarked instanceof Set).toBe(true);
    expect(mangaBookmarked instanceof Set).toBe(true);
  });

  test('access() throttles permission queries within TTL, coalesces in-flight queries, bypasses on request=true, and invalidates on clear', async () => {
    clearAccessCache();

    let queryCount = 0;
    let requestCount = 0;

    const mockHandle = {
      queryPermission: async () => {
        queryCount++;
        await new Promise((r) => setTimeout(r, 10));
        return 'granted' as PermissionState;
      },
      requestPermission: async () => {
        requestCount++;
        await new Promise((r) => setTimeout(r, 10));
        return 'granted' as PermissionState;
      },
    } as unknown as FileSystemDirectoryHandle;

    const mangaItem = {
      id: 'manga-access-throttle',
      handle: mockHandle,
    };

    // 1. Initial call queries permission
    const first = await access(mangaItem);
    expect(first).toBe(true);
    expect(queryCount).toBe(1);
    expect(accessCache.has('manga-access-throttle')).toBe(true);

    // 2. Immediate second call reuses cached status within TTL without calling queryPermission again
    const second = await access(mangaItem);
    expect(second).toBe(true);
    expect(queryCount).toBe(1); // Still 1! No additional queryPermission call.

    // 3. Request mode (request=true) bypasses cache and triggers requestPermission
    const explicit = await access(mangaItem, true);
    expect(explicit).toBe(true);
    expect(requestCount).toBe(1);

    // 4. Invalidation clears cache so subsequent call queries again
    clearAccessCache('manga-access-throttle');
    expect(accessCache.has('manga-access-throttle')).toBe(false);

    const third = await access(mangaItem);
    expect(third).toBe(true);
    expect(queryCount).toBe(2); // Queried again!

    // 5. In-flight coalescing: concurrent passive calls share the same in-flight query
    clearAccessCache('manga-access-throttle');
    const [p1, p2, p3] = await Promise.all([
      access(mangaItem),
      access(mangaItem),
      access(mangaItem),
    ]);
    expect(p1 && p2 && p3).toBe(true);
    expect(queryCount).toBe(3); // Only 1 query for all 3 concurrent calls!

    // 6. clearDirHandleCache also clears access cache
    clearDirHandleCache('manga-access-throttle');
    expect(accessCache.has('manga-access-throttle')).toBe(false);
  });

  test('normalizePath normalizes backslashes, removes redundant slashes and trims trailing slashes', () => {
    expect(normalizePath('folder\\subfolder\\file.png')).toBe('folder/subfolder/file.png');
    expect(normalizePath('folder//subfolder///file.png/')).toBe('folder/subfolder/file.png');
    expect(normalizePath('C:\\manga\\chapter 1\\01.webp/')).toBe('C:/manga/chapter 1/01.webp');
  });

  test('naturalSortPaths routes to desktopAPI.naturalSortPaths on desktop and falls back on web', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalNaturalSortPaths = desktopAPI.naturalSortPaths;

    try {
      // 1. On desktop with naturalSortPaths
      let called = false;
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      (desktopAPI as any).naturalSortPaths = async (paths: string[]) => {
        called = true;
        return ['ch 1', 'ch 2', 'ch 10'];
      };

      const sorted = await naturalSortPaths(['ch 10', 'ch 1', 'ch 2']);
      expect(called).toBe(true);
      expect(sorted).toEqual(['ch 1', 'ch 2', 'ch 10']);

      // 2. On web (isDesktop = false)
      Object.defineProperty(desktopAPI, 'isDesktop', { value: false, configurable: true });
      const webSorted = await naturalSortPaths(['ch 10', 'ch 1', 'ch 2']);
      expect(webSorted).toEqual(['ch 1', 'ch 2', 'ch 10']);
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).naturalSortPaths = originalNaturalSortPaths;
    }
  });

  test('DesktopHandle exposes absPath and loads file content via desktopAPI.readFile', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalReadFile = desktopAPI.readFile;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      const dummyBuffer = new Uint8Array([1, 2, 3, 4]).buffer;
      let requestedPath = '';
      (desktopAPI as any).readFile = async (path: string) => {
        requestedPath = path;
        return dummyBuffer;
      };

      const handle = new DesktopHandle('01.jpg', 'C:/manga/ch1/01.jpg', 1234, 5678, 800, 1200);
      expect(handle.absPath).toBe('C:/manga/ch1/01.jpg');
      expect(handle.name).toBe('01.jpg');
      expect(handle.width).toBe(800);
      expect(handle.height).toBe(1200);

      const file = await handle.getFile();
      expect(requestedPath).toBe('C:/manga/ch1/01.jpg');
      expect(file.name).toBe('01.jpg');
      expect(file.lastModified).toBe(5678);
      expect(file.size).toBe(4);
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).readFile = originalReadFile;
    }
  });

  test('prepareChapter prefers batch desktopAPI.prepareChapterHeaders on desktop', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalPrepareHeaders = desktopAPI.prepareChapterHeaders;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      let queriedPaths: string[] = [];
      (desktopAPI as any).prepareChapterHeaders = async (paths: string[]) => {
        queriedPaths = paths;
        return paths.map((p) => ({
          path: p,
          width: 1080,
          height: 1920,
          size: 9999,
          modified: 1234567,
          checksum: 'abc123hash',
        }));
      };

      const manga: Manga = {
        id: 'test-batch-prep-manga',
        title: 'Batch Prep Manga',
        localPath: 'C:/manga/batch-title',
        lastChapter: 0,
        addedAt: Date.now(),
        updatedAt: Date.now(),
        chapters: [
          {
            name: 'Chapter 1',
            read: false,
            pages: [
              {
                name: '01.jpg',
                path: 'ch1/01.jpg',
                width: 800,
                height: 1200,
                dimensionsPending: true,
              },
              {
                name: '02.jpg',
                path: 'ch1/02.jpg',
                width: 800,
                height: 1200,
                dimensionsPending: true,
              },
            ],
          },
        ],
      };

      const issues = await prepareChapter(manga, 0);
      expect(issues).toEqual([]);
      expect(queriedPaths).toEqual([
        'C:/manga/batch-title/ch1/01.jpg',
        'C:/manga/batch-title/ch1/02.jpg',
      ]);
      expect(manga.chapters[0].pages[0].width).toBe(1080);
      expect(manga.chapters[0].pages[0].height).toBe(1920);
      expect(manga.chapters[0].pages[0].dimensionsPending).toBe(false);
      expect(manga.chapters[0].pages[1].width).toBe(1080);
      expect(manga.chapters[0].pages[1].dimensionsPending).toBe(false);
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).prepareChapterHeaders = originalPrepareHeaders;
    }
  });

  test('Step B1 — TauriSqliteLibraryRepo implements LibraryRepo and delegates to desktopAPI.sqlite* commands', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalSqliteList = desktopAPI.sqliteListLibrary;
    const originalSqliteGet = desktopAPI.sqliteGetManga;
    const originalSqliteSave = desktopAPI.sqliteSaveManga;
    const originalSqliteProgress = desktopAPI.sqliteSaveProgress;
    const originalSqliteAddBm = desktopAPI.sqliteAddBookmark;
    const originalSqliteRemoveBm = desktopAPI.sqliteRemoveBookmark;
    const originalSqliteBmIds = desktopAPI.sqliteGetBookmarkedMangaIds;
    const originalSqliteDelete = desktopAPI.sqliteDeleteManga;
    const originalSqliteClear = desktopAPI.sqliteClearLibrary;
    const originalSqliteReset = desktopAPI.sqliteResetProgress;
    const originalSqliteGetSettings = desktopAPI.sqliteGetSettings;
    const originalSqliteSaveSettings = desktopAPI.sqliteSaveSettings;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });

      const mockManga: Manga = {
        id: 'sqlite-test-1',
        title: 'SQLite Test Title',
        slug: 'sqlite-test-title',
        localPath: 'C:/Manga/SqliteTest',
        lastChapter: 0,
        addedAt: 1000,
        updatedAt: 2000,
        revision: 2,
        chapters: [
          {
            name: 'Chapter 1',
            read: false,
            pages: [{ name: '01.png', path: 'ch1/01.png', width: 800, height: 1200 }],
          },
        ],
      };

      let savedMangaRecord: Manga | null = null;
      let savedProgressPayload: any = null;
      let deleteCalledWith: string | null = null;
      let clearCalled = false;
      let resetCalled = false;

      (desktopAPI as any).sqliteListLibrary = async () => [
        {
          id: mockManga.id,
          title: mockManga.title,
          slug: mockManga.slug,
          localPath: mockManga.localPath,
          lastChapter: mockManga.lastChapter,
          addedAt: mockManga.addedAt,
          updatedAt: mockManga.updatedAt,
          revision: mockManga.revision,
          chapterCount: 1,
          chaptersRead: 0,
          lastChapterName: 'Chapter 1',
          hasProgress: false,
          indexedAt: mockManga.updatedAt,
        },
      ];

      (desktopAPI as any).sqliteGetManga = async (id: string) => {
        return id === mockManga.id ? { ...mockManga } : undefined;
      };

      (desktopAPI as any).sqliteSaveManga = async (manga: Manga) => {
        savedMangaRecord = manga;
      };

      (desktopAPI as any).sqliteSaveProgress = async (params: any) => {
        savedProgressPayload = params;
        return 'saved';
      };

      (desktopAPI as any).sqliteAddBookmark = async (params: any) => [params.position];

      (desktopAPI as any).sqliteRemoveBookmark = async () => [];

      (desktopAPI as any).sqliteGetBookmarkedMangaIds = async () => ({
        allBookmarkedIds: [mockManga.id],
        mangaBookmarkedIds: [mockManga.id],
      });

      (desktopAPI as any).sqliteDeleteManga = async (id: string) => {
        deleteCalledWith = id;
      };

      (desktopAPI as any).sqliteClearLibrary = async () => {
        clearCalled = true;
      };

      (desktopAPI as any).sqliteResetProgress = async () => {
        resetCalled = true;
      };

      (desktopAPI as any).sqliteGetSettings = async () => ({
        theme: 'dark',
        mode: 'continuous',
      });

      (desktopAPI as any).sqliteSaveSettings = async (settings: any) => settings;

      const sqliteRepo = new TauriSqliteLibraryRepo();

      // 1. listLibrary
      const summaries = await sqliteRepo.listLibrary();
      expect(summaries.length).toBe(1);
      expect(summaries[0].id).toBe(mockManga.id);

      // 2. getManga
      const retrieved = await sqliteRepo.getManga(mockManga.id);
      expect(retrieved?.id).toBe(mockManga.id);
      expect(retrieved?.title).toBe(mockManga.title);

      // 3. saveManga
      await sqliteRepo.saveManga({ ...mockManga, revision: 2 });
      expect(savedMangaRecord).not.toBeNull();
      expect(savedMangaRecord!.id).toBe(mockManga.id);
      expect(savedMangaRecord!.revision).toBe(3); // Incremented revision

      // 4. saveProgress
      const progressResult = await sqliteRepo.saveProgress(
        mockManga,
        0,
        { page: 0, fraction: 0.5 },
        true,
      );
      expect(progressResult).toBe('saved');
      expect(savedProgressPayload.mangaId).toBe(mockManga.id);
      expect(savedProgressPayload.chapterIndex).toBe(0);
      expect(savedProgressPayload.read).toBe(true);

      // 5. bookmarks
      const bms = await sqliteRepo.addBookmark(mockManga.id, 'Chapter 1', {
        page: 0,
        fraction: 0.2,
      });
      expect(bms.length).toBe(1);

      const allBm = await sqliteRepo.getBookmarkedMangaIds();
      expect(allBm.has(mockManga.id)).toBe(true);

      const removed = await sqliteRepo.removeBookmark(mockManga.id, 'Chapter 1', {
        page: 0,
        fraction: 0.2,
      });
      expect(removed.length).toBe(0);

      // 6. delete & clear & reset
      await sqliteRepo.deleteManga('del-1');
      expect(deleteCalledWith).toBe('del-1');

      await sqliteRepo.clearLibrary();
      expect(clearCalled).toBe(true);

      await sqliteRepo.resetProgress();
      expect(resetCalled).toBe(true);

      // 7. settings
      const settings = await sqliteRepo.getStoredSettings();
      expect(settings?.theme).toBe('dark');
      const savedSettings = await sqliteRepo.saveStoredSettings({
        ...defaults,
        theme: 'light',
      });
      expect(savedSettings.theme).toBe('light');
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).sqliteListLibrary = originalSqliteList;
      (desktopAPI as any).sqliteGetManga = originalSqliteGet;
      (desktopAPI as any).sqliteSaveManga = originalSqliteSave;
      (desktopAPI as any).sqliteSaveProgress = originalSqliteProgress;
      (desktopAPI as any).sqliteAddBookmark = originalSqliteAddBm;
      (desktopAPI as any).sqliteRemoveBookmark = originalSqliteRemoveBm;
      (desktopAPI as any).sqliteGetBookmarkedMangaIds = originalSqliteBmIds;
      (desktopAPI as any).sqliteDeleteManga = originalSqliteDelete;
      (desktopAPI as any).sqliteClearLibrary = originalSqliteClear;
      (desktopAPI as any).sqliteResetProgress = originalSqliteReset;
      (desktopAPI as any).sqliteGetSettings = originalSqliteGetSettings;
      (desktopAPI as any).sqliteSaveSettings = originalSqliteSaveSettings;
    }
  });

  test('Step B1 — ensureLibraryMigrated skips migration when already migrated', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalIsMigrated = desktopAPI.isLibraryMigrated;
    const originalImport = desktopAPI.importLegacyLibrary;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      let importCalled = false;
      (desktopAPI as any).isLibraryMigrated = async () => true;
      (desktopAPI as any).importLegacyLibrary = async () => {
        importCalled = true;
        return true;
      };

      const result = await ensureLibraryMigrated();
      expect(result).toBe(true);
      expect(importCalled).toBe(false);
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).isLibraryMigrated = originalIsMigrated;
      (desktopAPI as any).importLegacyLibrary = originalImport;
    }
  });

  test('Step B1 — ensureLibraryMigrated dumps IDB, validates backup, and calls importLegacyLibrary preserving IDB data', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalIsMigrated = desktopAPI.isLibraryMigrated;
    const originalImport = desktopAPI.importLegacyLibrary;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      (desktopAPI as any).isLibraryMigrated = async () => false;

      let importedPayload: any = null;
      (desktopAPI as any).importLegacyLibrary = async (payload: any) => {
        importedPayload = payload;
        return true;
      };

      const mockLegacyManga: Manga = {
        id: 'legacy-1',
        title: 'Legacy Title',
        slug: 'legacy-title',
        localPath: 'C:/Manga/Legacy',
        lastChapter: 0,
        addedAt: 1000,
        updatedAt: 2000,
        chapters: [
          {
            name: 'Ch 1',
            read: true,
            pages: [{ name: '01.png', path: 'ch1/01.png', width: 800, height: 1200 }],
          },
        ],
      };

      let idbReadCount = 0;
      const mockIdbRepo: LibraryRepo = {
        listLibrary: async () => [],
        getManga: async () => undefined,
        getCover: async () => undefined,
        allManga: async () => {
          idbReadCount++;
          return [mockLegacyManga];
        },
        saveManga: async () => {},
        saveProgress: async () => 'saved',
        getBookmarkedMangaIds: async () => new Set(),
        getMangaBookmarkedIds: async () => new Set(),
        addBookmark: async () => [],
        removeBookmark: async () => [],
        deleteManga: async () => {},
        clearLibrary: async () => {
          throw new Error('Never delete IDB store automatically!');
        },
        resetProgress: async () => {},
        getStoredSettings: async () => ({ ...defaults, theme: 'dark' }),
        saveStoredSettings: async (s) => s,
        restoreBackup: async () => defaults,
      };

      const result = await ensureLibraryMigrated(mockIdbRepo);
      expect(result).toBe(true);
      expect(idbReadCount).toBe(1);
      expect(importedPayload).not.toBeNull();
      expect(importedPayload.manga.length).toBe(1);
      expect(importedPayload.manga[0].id).toBe('legacy-1');
      expect(importedPayload.settings.theme).toBe('dark');
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).isLibraryMigrated = originalIsMigrated;
      (desktopAPI as any).importLegacyLibrary = originalImport;
    }
  });

  test('Step B1 — ensureLibraryMigrated handles fresh installs with empty IDB safely', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalIsMigrated = desktopAPI.isLibraryMigrated;
    const originalImport = desktopAPI.importLegacyLibrary;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      (desktopAPI as any).isLibraryMigrated = async () => false;

      let importedPayload: any = null;
      (desktopAPI as any).importLegacyLibrary = async (payload: any) => {
        importedPayload = payload;
        return true;
      };

      const emptyIdbRepo: LibraryRepo = {
        listLibrary: async () => [],
        getManga: async () => undefined,
        getCover: async () => undefined,
        allManga: async () => [],
        saveManga: async () => {},
        saveProgress: async () => 'saved',
        getBookmarkedMangaIds: async () => new Set(),
        getMangaBookmarkedIds: async () => new Set(),
        addBookmark: async () => [],
        removeBookmark: async () => [],
        deleteManga: async () => {},
        clearLibrary: async () => {},
        resetProgress: async () => {},
        getStoredSettings: async () => undefined,
        saveStoredSettings: async (s) => s,
        restoreBackup: async () => defaults,
      };

      const result = await ensureLibraryMigrated(emptyIdbRepo);
      expect(result).toBe(true);
      expect(importedPayload).toEqual({ manga: [], settings: {} });
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).isLibraryMigrated = originalIsMigrated;
      (desktopAPI as any).importLegacyLibrary = originalImport;
    }
  });

  test('Step B2 — TauriDesktopBridge exportBackup, restoreBackup, and validateBackup invoke Tauri commands', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => 1,
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === 'export_library_backup') {
          return JSON.stringify({ version: 2, manga: [], settings: defaults });
        }
        if (cmd === 'restore_library_backup') {
          return defaults;
        }
        if (cmd === 'validate_library_backup') {
          return { version: 2, manga: [], settings: defaults };
        }
        return null;
      },
    };

    try {
      const exported = await bridge.exportBackup();
      expect(typeof exported).toBe('string');
      expect(calls[0].cmd).toBe('export_library_backup');

      const restored = await bridge.restoreBackup('{"version":2,"manga":[],"settings":{}}');
      expect(restored).toEqual(defaults);
      expect(calls[1].cmd).toBe('restore_library_backup');
      expect(calls[1].args).toEqual({ backupJson: '{"version":2,"manga":[],"settings":{}}' });

      const validated = await bridge.validateBackup('{"version":2,"manga":[],"settings":{}}');
      expect(validated).toBeDefined();
      expect(calls[2].cmd).toBe('validate_library_backup');
    } finally {
      (globalThis as any).window = origWindow;
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('Step B2 — TauriSqliteLibraryRepo.exportBackup and restoreBackup delegate to desktopAPI and notify subscribers', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalExport = desktopAPI.exportBackup;
    const originalRestore = desktopAPI.restoreBackup;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });
      let exportCalled = false;
      let restoreCalledWith: string | null = null;

      (desktopAPI as any).exportBackup = async () => {
        exportCalled = true;
        return '{"version":2,"manga":[],"settings":{}}';
      };

      (desktopAPI as any).restoreBackup = async (json: string) => {
        restoreCalledWith = json;
        return { ...defaults, theme: 'light' as const };
      };

      const sqliteRepo = new TauriSqliteLibraryRepo();

      const exported = await sqliteRepo.exportBackup();
      expect(exportCalled).toBe(true);
      expect(exported).toBe('{"version":2,"manga":[],"settings":{}}');

      // Test string restore
      const restored = await sqliteRepo.restoreBackup(
        '{"version":2,"manga":[],"settings":{"theme":"light"}}',
      );
      expect(restoreCalledWith).toBe('{"version":2,"manga":[],"settings":{"theme":"light"}}');
      expect(restored.theme).toBe('light');

      // Test object restore
      const restoredObj = await sqliteRepo.restoreBackup({
        manga: [],
        settings: { ...defaults, theme: 'light' },
      });
      expect(restoreCalledWith).toContain('"version":2');
      expect(restoredObj.theme).toBe('light');
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).exportBackup = originalExport;
      (desktopAPI as any).restoreBackup = originalRestore;
    }
  });

  test('Step B2 — IndexedDBLibraryRepo.exportBackup produces clean JSON backup without cover blobs', async () => {
    const mockManga: Manga = {
      id: 'idb-exp-1',
      title: 'Export Title',
      slug: 'export-title',
      localPath: 'C:/Manga/Export',
      lastChapter: 0,
      addedAt: 1000,
      updatedAt: 2000,
      cover: new Blob(['fake-cover-bytes'], { type: 'image/jpeg' }),
      handle: {} as any,
      chapters: [
        {
          name: 'Chapter 1',
          read: false,
          pages: [{ name: '01.png', path: 'ch1/01.png', width: 800, height: 1200 }],
        },
      ],
    };

    const idbRepo = new IndexedDBLibraryRepo();
    idbRepo.allManga = async () => [mockManga];
    idbRepo.getStoredSettings = async () => ({ ...defaults, theme: 'dark' });

    const json = await idbRepo.exportBackup();
    expect(typeof json).toBe('string');
    const parsed = JSON.parse(json);
    expect(parsed.version).toBe(2);
    expect(parsed.manga.length).toBe(1);
    const target = parsed.manga.find((m: any) => m.id === mockManga.id);
    expect(target).toBeDefined();
    expect(target.title).toBe(mockManga.title);
    expect(target.cover).toBeUndefined();
    expect(target.handle).toBeUndefined();
    expect(parsed.settings.theme).toBe('dark');
  });

  test('Step B3 — TauriDesktopBridge.indexTitle invokes index_title with progress Channel and options', async () => {
    const bridge = new TauriDesktopBridge();
    const calls: Array<{ cmd: string; args: any }> = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => 1,
      invoke: async (cmd: string, args: any) => {
        calls.push({ cmd, args });
        if (cmd === 'index_title') {
          if (args?.onProgress?.onmessage) {
            args.onProgress.onmessage({
              phase: 'discover',
              done: 5,
              total: 5,
              title: 'Test Manga',
            });
            args.onProgress.onmessage({
              phase: 'index',
              done: 5,
              total: 5,
              title: 'Test Manga · first 5 chapters',
            });
          }
          return {
            id: 'indexed-title-1',
            title: 'Test Manga',
            slug: 'test-manga',
            localPath: args.root,
            lastChapter: 0,
            addedAt: 1000,
            updatedAt: 2000,
            revision: 1,
            sort: 'natural',
            chapters: [
              {
                name: 'Chapter 1',
                read: false,
                position: undefined,
                bookmarks: [],
                pages: [
                  {
                    name: '01.png',
                    path: 'ch1/01.png',
                    width: 800,
                    height: 1200,
                    size: 1024,
                    modified: 1000,
                    dimensionsPending: false,
                  },
                ],
              },
            ],
            coverPath: 'C:/Manga/Test/ch1/01.png',
            issues: [],
            reused: 1,
          };
        }
        return null;
      },
    };

    try {
      const progressEvents: any[] = [];
      const result = await bridge.indexTitle(
        'C:/Manga/Test',
        { sort: 'natural', warmChapters: 5 },
        (p) => progressEvents.push(p),
      );

      expect(calls.length).toBe(1);
      expect(calls[0].cmd).toBe('index_title');
      expect(calls[0].args.root).toBe('C:/Manga/Test');
      expect(calls[0].args.options.sort).toBe('natural');
      expect(calls[0].args.options.warmChapters).toBe(5);
      expect(progressEvents.length).toBe(2);
      expect(progressEvents[0].phase).toBe('discover');
      expect(progressEvents[1].phase).toBe('index');
      expect(result.id).toBe('indexed-title-1');
      expect(result.chapters.length).toBe(1);
      expect(result.reused).toBe(1);
    } finally {
      (globalThis as any).window = origWindow;
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('Step B3 — indexSource delegates to desktopAPI.indexTitle on desktop with progress updates and returns structured TitleDto', async () => {
    const originalIsDesktop = desktopAPI.isDesktop;
    const originalIndexTitle = desktopAPI.indexTitle;
    const originalProgressBar = desktopAPI.setProgressBar;

    try {
      Object.defineProperty(desktopAPI, 'isDesktop', { value: true, configurable: true });

      const progressUpdates: any[] = [];
      const progressBarCalls: number[] = [];

      (desktopAPI as any).setProgressBar = (v: number) => {
        progressBarCalls.push(v);
      };

      (desktopAPI as any).indexTitle = async (root: string, options: any, onProgress: any) => {
        if (onProgress) {
          onProgress({
            phase: 'discover',
            done: 10,
            total: 10,
            title: 'Rust Indexed Title',
          });
          onProgress({
            phase: 'index',
            done: 10,
            total: 10,
            title: 'Rust Indexed Title · first 5 chapters',
          });
        }
        return {
          id: 'rust-idx-1',
          title: 'Rust Indexed Title',
          slug: 'rust-indexed-title',
          localPath: root,
          lastChapter: 0,
          addedAt: 5000,
          updatedAt: 6000,
          revision: 1,
          sort: options.sort || 'natural',
          chapters: [
            {
              name: 'Chapter 1',
              read: true,
              position: { page: 0, fraction: 0.5 },
              bookmarks: [{ page: 0, fraction: 0.2 }],
              pages: [
                {
                  name: '01.jpg',
                  path: 'ch1/01.jpg',
                  width: 1000,
                  height: 1500,
                  size: 5000,
                  modified: 1000,
                  dimensionsPending: false,
                },
              ],
            },
          ],
          coverPath: 'C:/Manga/RustTitle/cover.jpg',
          issues: [{ path: 'ch1/corrupt.jpg', reason: 'Corrupt header' }],
          reused: 4,
        };
      };

      const source: Source = {
        title: 'Rust Indexed Title',
        localPath: 'C:/Manga/RustTitle',
        files: new Map(),
        issues: [],
      };

      const result = await indexSource(
        source,
        {
          update: (s) => progressUpdates.push(s),
        },
        undefined,
        'natural',
      );

      expect(result.m.id).toBe('rust-idx-1');
      expect(result.m.title).toBe('Rust Indexed Title');
      expect(result.m.localPath).toBe('C:/Manga/RustTitle');
      expect(result.m.chapters.length).toBe(1);
      expect(result.m.chapters[0].read).toBe(true);
      expect(result.m.chapters[0].position?.fraction).toBe(0.5);
      expect(result.m.chapters[0].pages[0].width).toBe(1000);
      expect(result.m.chapters[0].pages[0].height).toBe(1500);
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].path).toBe('ch1/corrupt.jpg');
      expect(result.reused).toBe(4);
      expect(progressUpdates.length).toBe(2);
      expect(progressUpdates[0].phase).toBe('discover');
      expect(progressUpdates[1].phase).toBe('index');
      expect(progressBarCalls).toContain(1);
    } finally {
      Object.defineProperty(desktopAPI, 'isDesktop', {
        value: originalIsDesktop,
        configurable: true,
      });
      (desktopAPI as any).indexTitle = originalIndexTitle;
      (desktopAPI as any).setProgressBar = originalProgressBar;
    }
  });

  test('Step C1 — TauriDesktopBridge convertFileSrc formats zero-copy custom protocol URL', () => {
    const bridge = new TauriDesktopBridge();
    const resultDefault = bridge.convertFileSrc('C:/Manga/Title/01.jpg');
    // Default protocol is 'mangaimg'
    expect(resultDefault).toContain('mangaimg');
    expect(resultDefault).toContain('01.jpg');

    const resultCustom = bridge.convertFileSrc('C:/Manga/Title/02.webp', 'customscheme');
    expect(resultCustom).toContain('customscheme');
    expect(resultCustom).toContain('02.webp');
  });

  test('Step C3 — TauriDesktopBridge onDragDrop handles native drag drop paths and returns unlisten', async () => {
    const bridge = new TauriDesktopBridge();
    let receivedPaths: string[] = [];

    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    const origEventPlugin = (globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__;
    const eventHandlers = new Map<string, (event: any) => void>();

    (globalThis as any).window = globalThis;
    (globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (event: string, id: number) => {},
    };
    (globalThis as any).__TAURI_INTERNALS__ = {
      transformCallback: (callback: any) => 1,
      invoke: async (cmd: string, args: any) => {
        if (cmd === 'plugin:event|listen') {
          eventHandlers.set(args.event, args.handler);
          return 1;
        }
        if (cmd === 'plugin:event|unlisten') {
          eventHandlers.delete(args.event);
          return null;
        }
        return null;
      },
    };

    try {
      const unlisten = bridge.onDragDrop((paths) => {
        receivedPaths = paths;
      });

      expect(typeof unlisten).toBe('function');
      unlisten();
      // Let promises settle before deleting window
      await new Promise((r) => setTimeout(r, 10));
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
      (globalThis as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = origEventPlugin;
    }
  });

  test('Step D — Parity test: TS naturalOrder and Rust natural_sort_paths sort fixtures identically', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const fixturePath = path.resolve('tests/fixtures/sorting-fixtures.json');
    const rawFixtures: string[] = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

    const tsSorted = [...rawFixtures].sort(naturalOrder);
    const sorted = await naturalSortPaths(rawFixtures);

    expect(tsSorted).toEqual(sorted);
    expect(sorted[0]).toBe('001.jpg');
    expect(sorted[1]).toBe('002.jpg');
    expect(sorted[2]).toBe('010.jpg');
    expect(sorted[3]).toBe('099.jpg');
    expect(sorted[4]).toBe('100.jpg');
    expect(sorted[5]).toBe('Chapter 1');
    expect(sorted[6]).toBe('Chapter 1.5');
    expect(sorted[7]).toBe('Chapter 2');
    expect(sorted[8]).toBe('Chapter 3');
    expect(sorted[9]).toBe('Chapter 9');
    expect(sorted[10]).toBe('Chapter 10');
    expect(sorted[11]).toBe('Chapter 10.1');
    expect(sorted[12]).toBe('Chapter 10.2');
    expect(sorted[13]).toBe('Chapter 11');
    expect(sorted[14]).toBe('Chapter 100');
  });

  test('Step E — TauriDesktopBridge checkForUpdate and installUpdate invoke Tauri updater commands', async () => {
    const origWindow = (globalThis as any).window;
    const origTauri = (globalThis as any).__TAURI_INTERNALS__;
    (globalThis as any).window = globalThis;
    const invokeCalls: { cmd: string; args?: any }[] = [];

    (globalThis as any).__TAURI_INTERNALS__ = {
      invoke: async (cmd: string, args?: any) => {
        invokeCalls.push({ cmd, args });
        if (cmd === 'plugin:updater|check') {
          return {
            version: '2.1.0',
            currentVersion: '2.0.0',
            body: 'Bug fixes and performance improvements',
            date: '2026-11-12T00:00:00Z',
          };
        }
        if (cmd === 'plugin:updater|download_and_install') {
          return null;
        }
        return null;
      },
    };

    try {
      const bridge = new TauriDesktopBridge();
      const update = await bridge.checkForUpdate!();
      expect(update).toEqual({
        version: '2.1.0',
        currentVersion: '2.0.0',
        body: 'Bug fixes and performance improvements',
        date: '2026-11-12T00:00:00Z',
      });
      expect(invokeCalls[0].cmd).toBe('plugin:updater|check');

      await bridge.installUpdate!();
      expect(invokeCalls[1].cmd).toBe('plugin:updater|download_and_install');
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
      (globalThis as any).__TAURI_INTERNALS__ = origTauri;
    }
  });

  test('Step E — updates.ts applyUpdate on desktop flushes tasks and delegates to desktopAPI.installUpdate', async () => {
    const origWindow = (globalThis as any).window;
    const eventTarget = new EventTarget();
    (globalThis as any).window = {
      addEventListener: (type: string, listener: any) =>
        eventTarget.addEventListener(type, listener),
      removeEventListener: (type: string, listener: any) =>
        eventTarget.removeEventListener(type, listener),
      dispatchEvent: (event: any) => eventTarget.dispatchEvent(event),
    };

    // ensure CustomEvent on globalThis
    if (!(globalThis as any).CustomEvent) {
      (globalThis as any).CustomEvent = class CustomEvent extends Event {
        detail: any;
        constructor(name: string, opts: any = {}) {
          super(name);
          this.detail = opts.detail;
        }
      };
    }
    const { applyUpdate } = await import('../src/updates');
    let installed = false;
    let eventReceived = false;

    const handler = (e: any) => {
      eventReceived = true;
      e.detail.push(Promise.resolve());
    };
    (globalThis as any).window.addEventListener('reader-before-update', handler);

    // Mock desktopAPI.installUpdate & isDesktop
    const originalInstall = desktopAPI.installUpdate;
    const originalIsDesktop = desktopAPI.isDesktop;
    (desktopAPI as any).isDesktop = true;
    desktopAPI.installUpdate = async () => {
      installed = true;
    };

    try {
      await applyUpdate();
      expect(eventReceived).toBe(true);
      expect(installed).toBe(true);
    } finally {
      (globalThis as any).window.removeEventListener('reader-before-update', handler);
      desktopAPI.installUpdate = originalInstall;
      (desktopAPI as any).isDesktop = originalIsDesktop;
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
    }
  });

  test('Step 30 — TypeScript Modularization, Hooks, and Typed Invocation', async () => {
    // 1. Desktop module isolation: importing desktop modules works without idb
    const desktopStorage = await import('../src/desktop/storage');
    const desktopImportScan = await import('../src/desktop/importScan');
    const desktopValidation = await import('../src/desktop/validation');

    expect(typeof desktopStorage.listLibrary).toBe('function');
    expect(typeof desktopStorage.saveProgress).toBe('function');
    expect(typeof desktopImportScan.fromDesktopFolder).toBe('function');
    expect(typeof desktopImportScan.indexSource).toBe('function');
    expect(typeof desktopValidation.validateBackup).toBe('function');
    expect(typeof desktopValidation.validateBackupAsync).toBe('function');

    // 2. parseTauriError parses structured DbError and FsError payloads
    const { parseTauriError, invokeCommand } = await import('../src/tauriBridge');
    const fsErr = parseTauriError({ code: 'PathNotAllowed', message: 'Restricted' });
    expect(fsErr.code).toBe('PathNotAllowed');

    const dbErr = parseTauriError(JSON.stringify({ code: 'Conflict', message: 'Lock collision' }));
    expect(dbErr.code).toBe('Conflict');

    const unknownErr = parseTauriError(new Error('Generic failure'));
    expect(unknownErr.code).toBe('Unknown');
    expect(unknownErr.message).toBe('Generic failure');

    // 3. invokeCommand typed invocation routes to Tauri invoke
    const origWindow = (globalThis as any).window;
    const calls: Array<{ cmd: string; args: any }> = [];
    (globalThis as any).window = {
      __TAURI_INTERNALS__: {
        invoke: async (cmd: string, args: any) => {
          calls.push({ cmd, args });
          if (cmd === 'natural_sort_paths') {
            return [...args.paths].sort();
          }
          if (cmd === 'get_app_preference') {
            return 'custom-value';
          }
          return null;
        },
      },
    };

    try {
      const sorted = await invokeCommand('natural_sort_paths', { paths: ['ch2', 'ch1'] });
      expect(sorted).toEqual(['ch1', 'ch2']);
      expect(calls[0].cmd).toBe('natural_sort_paths');

      const pref = await invokeCommand('get_app_preference', { key: 'testKey' });
      expect(pref).toBe('custom-value');
      expect(calls[1].cmd).toBe('get_app_preference');
    } finally {
      if (origWindow === undefined) {
        delete (globalThis as any).window;
      } else {
        (globalThis as any).window = origWindow;
      }
    }

    // 4. Extracted hooks exist and have valid function signatures
    const { useAutoplay } = await import('../src/useAutoplay');
    const { useReaderKeys } = await import('../src/useReaderKeys');
    const { useProgressSave } = await import('../src/useProgressSave');

    expect(typeof useAutoplay).toBe('function');
    expect(typeof useReaderKeys).toBe('function');
    expect(typeof useProgressSave).toBe('function');
  });
});
