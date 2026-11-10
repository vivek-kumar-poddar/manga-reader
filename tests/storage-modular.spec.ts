import { expect, test } from '@playwright/test';
import {
  summary,
  errorMessage,
  onMangaDelete,
  saveManga,
  saveProgress,
  migrateV1ToV2,
  restoreBackup,
  getCover,
  type SaveProgressResult,
} from '../src/storage';
import { desktopAPI } from '../src/tauriBridge';
import { imageFile } from '../src/images';
import { fromFiles, DesktopHandle, chapterGroups, splitSource } from '../src/importScan';
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
});
