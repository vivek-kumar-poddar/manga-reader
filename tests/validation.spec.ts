import { test, expect } from '@playwright/test';
import {
  validateBackup,
  validateRelativePath,
  parsePosition,
  parseSettings,
  parseManga,
  parseSummary,
  ValidationError,
} from '../src/validation';
import { normalizePath, normalizeRelativePath } from '../src/paths';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { shelfCollator, sortLibraryEntries } from '../src/App';
import { bookmarkCollator } from '../src/Bookmarks';

const baselineBackup = JSON.parse(
  readFileSync(resolve('docs/baseline/after-format/backup.json'), 'utf8'),
);

test.describe('Step 04 — Input and Backup Validation', () => {
  test('valid baseline backup parses successfully', () => {
    const result = validateBackup(baselineBackup);
    expect(result.manga.length).toBe(1);
    expect(result.manga[0].title).toBe('Baseline');
    expect(result.settings.theme).toBe('system');
  });

  test('null or primitive backup root throws ValidationError', () => {
    expect(() => validateBackup(null)).toThrow(ValidationError);
    expect(() => validateBackup('invalid string')).toThrow(ValidationError);
    expect(() => validateBackup(123)).toThrow(ValidationError);
    expect(() => validateBackup(undefined)).toThrow(ValidationError);
  });

  test('unsupported backup version throws ValidationError', () => {
    expect(() => validateBackup({ ...baselineBackup, version: 0 })).toThrow(ValidationError);
    expect(() => validateBackup({ ...baselineBackup, version: 3 })).toThrow(ValidationError);
    expect(() => validateBackup({ ...baselineBackup, version: '2' })).toThrow(ValidationError);
  });

  test('non-array manga list throws ValidationError', () => {
    expect(() => validateBackup({ ...baselineBackup, manga: null })).toThrow(ValidationError);
    expect(() => validateBackup({ ...baselineBackup, manga: {} })).toThrow(ValidationError);
  });

  test('duplicate manga IDs in backup throws ValidationError', () => {
    const duplicate = JSON.parse(JSON.stringify(baselineBackup));
    duplicate.manga.push(duplicate.manga[0]);
    expect(() => validateBackup(duplicate)).toThrow(ValidationError);
    expect(() => validateBackup(duplicate)).toThrow(/Duplicate manga ID/);
  });

  test('null manga entries throw ValidationError', () => {
    const corrupted = JSON.parse(JSON.stringify(baselineBackup));
    corrupted.manga.push(null);
    expect(() => validateBackup(corrupted)).toThrow(ValidationError);
  });

  test('traversal paths throw ValidationError', () => {
    expect(() => validateRelativePath('../escaped.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('chapter/../escaped.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('/absolute/path.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('chapter/./current.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('chapter\\windows\\path.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('chapter//double-slash.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('')).toThrow(ValidationError);
  });

  test('validateRelativePath allows legitimate double-dot filenames and rejects Windows drive/DOS prefixes', () => {
    // Legitimate double-dot filenames must be accepted
    expect(validateRelativePath('ch1/chapter..jpg')).toBe('ch1/chapter..jpg');
    expect(validateRelativePath('chapter..01.png')).toBe('chapter..01.png');
    expect(validateRelativePath('sub/folder/page..clean.webp')).toBe('sub/folder/page..clean.webp');

    // Windows drive prefixes, rooted paths, and colons must be rejected
    expect(() => validateRelativePath('C:/escaped.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('D:/manga/ch1.png')).toThrow(ValidationError);
    expect(() => validateRelativePath('ch1/01.jpg:stream')).toThrow(ValidationError);

    // UNC prefixes must be rejected
    expect(() => validateRelativePath('//server/share/01.jpg')).toThrow(ValidationError);

    // Reserved DOS device names must be rejected
    expect(() => validateRelativePath('nul.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('con.png')).toThrow(ValidationError);
    expect(() => validateRelativePath('aux')).toThrow(ValidationError);
    expect(() => validateRelativePath('ch1/prn.jpg')).toThrow(ValidationError);
    expect(() => validateRelativePath('com1.png')).toThrow(ValidationError);

    // Trailing dots and spaces must be rejected
    expect(() => validateRelativePath('ch1/01.jpg.')).toThrow(ValidationError);
    expect(() => validateRelativePath('ch1/01.jpg ')).toThrow(ValidationError);
  });

  test('normalizePath preserves UNC leading slashes and normalizeRelativePath strips boundary slashes', () => {
    expect(normalizePath('C:\\Manga\\Ch1')).toBe('C:/Manga/Ch1');
    expect(normalizePath('folder///sub///file.jpg')).toBe('folder/sub/file.jpg');
    expect(normalizePath('\\\\server\\share\\manga')).toBe('//server/share/manga');
    expect(normalizePath('//server/share/manga')).toBe('//server/share/manga');
    expect(normalizePath('//server///share//manga/')).toBe('//server/share/manga');

    expect(normalizeRelativePath('/ch1//01.jpg/')).toBe('ch1/01.jpg');
    expect(normalizeRelativePath('ch1\\01.jpg')).toBe('ch1/01.jpg');
    expect(normalizeRelativePath('ch1/01.jpg')).toBe('ch1/01.jpg');
  });

  test('fractional position page index throws ValidationError', () => {
    const samplePages = [{ name: '001.png', path: 'ch1/001.png', width: 800, height: 1200 }];
    expect(() => parsePosition({ page: 1.5, fraction: 0 }, samplePages)).toThrow(ValidationError);
    expect(() => parsePosition({ page: NaN, fraction: 0 }, samplePages)).toThrow(ValidationError);
    expect(() => parsePosition({ page: -1, fraction: 0 }, samplePages)).toThrow(ValidationError);
  });

  test('NaN or invalid position fraction throws ValidationError', () => {
    const samplePages = [{ name: '001.png', path: 'ch1/001.png', width: 800, height: 1200 }];
    expect(() => parsePosition({ page: 0, fraction: NaN }, samplePages)).toThrow(ValidationError);
    expect(() => parsePosition({ page: 0, fraction: Infinity }, samplePages)).toThrow(
      ValidationError,
    );
  });

  test('Position mangaBookmark flag is parsed or rejected when invalid', () => {
    const samplePages = [{ name: '001.png', path: 'ch1/001.png', width: 800, height: 1200 }];
    const parsed = parsePosition({ page: 0, fraction: 0, mangaBookmark: true }, samplePages);
    expect(parsed?.mangaBookmark).toBe(true);

    const normal = parsePosition({ page: 0, fraction: 0 }, samplePages);
    expect(normal?.mangaBookmark).toBeUndefined();

    expect(() =>
      parsePosition({ page: 0, fraction: 0, mangaBookmark: 'yes' }, samplePages),
    ).toThrow(ValidationError);
  });

  test('Position timestamp is parsed or rejected when invalid', () => {
    const samplePages = [{ name: '001.png', path: 'ch1/001.png', width: 800, height: 1200 }];
    const parsed = parsePosition(
      { page: 0, fraction: 0, mangaBookmark: true, timestamp: 1731234567890 },
      samplePages,
    );
    expect(parsed?.timestamp).toBe(1731234567890);

    expect(() =>
      parsePosition({ page: 0, fraction: 0, timestamp: 'invalid-time' }, samplePages),
    ).toThrow(ValidationError);
  });

  test('malformed bookmarks in chapter throw ValidationError', () => {
    const corrupted = JSON.parse(JSON.stringify(baselineBackup));
    corrupted.manga[0].chapters[0].bookmarks = 'not-an-array';
    expect(() => validateBackup(corrupted)).toThrow(ValidationError);

    const malformedEntry = JSON.parse(JSON.stringify(baselineBackup));
    malformedEntry.manga[0].chapters[0].bookmarks = [{ page: 2.7, fraction: 'bad' }];
    expect(() => validateBackup(malformedEntry)).toThrow(ValidationError);
  });

  test('duplicate page paths within a chapter throw ValidationError', () => {
    const corrupted = JSON.parse(JSON.stringify(baselineBackup));
    const ch = corrupted.manga[0].chapters[0];
    ch.pages.push({ ...ch.pages[0] });
    expect(() => validateBackup(corrupted)).toThrow(ValidationError);
    expect(() => validateBackup(corrupted)).toThrow(/Duplicate page path/);
  });

  test('NaN or invalid page dimensions throw ValidationError', () => {
    const corrupted = JSON.parse(JSON.stringify(baselineBackup));
    corrupted.manga[0].chapters[0].pages[0].width = NaN;
    expect(() => validateBackup(corrupted)).toThrow(ValidationError);

    const nonInteger = JSON.parse(JSON.stringify(baselineBackup));
    nonInteger.manga[0].chapters[0].pages[0].height = 100.5;
    expect(() => validateBackup(nonInteger)).toThrow(ValidationError);

    const negative = JSON.parse(JSON.stringify(baselineBackup));
    negative.manga[0].chapters[0].pages[0].width = -500;
    expect(() => validateBackup(negative)).toThrow(ValidationError);
  });

  test('parseSettings constructs allowlisted record and sanitizes bad values', () => {
    const clean = parseSettings({
      theme: 'invalid-theme',
      mode: 'single',
      seconds: -99,
      maxWidth: 9999,
      advance: false,
      extraProperty: 'should be stripped',
    });

    expect(clean.theme).toBe('system');
    expect(clean.mode).toBe('single');
    expect(clean.seconds).toBe(0.5); // Clamped to lower bound
    expect(clean.maxWidth).toBe(920); // Fallback to valid preset
    expect(clean.advance).toBe(false);
    expect(clean.fontSizeTitle).toBe(15); // Default headings/titles font size
    expect(clean.fontSizeUi).toBe(15); // Default Inter UI font size
    expect(clean.fontSizeButton).toBe(15); // Default button font size
    expect(clean.confirmDelete).toBe(false);
    expect((clean as Record<string, unknown>).extraProperty).toBeUndefined();

    const clamped = parseSettings({
      fontSizeTitle: -50,
      fontSizeUi: 999,
      fontSizeButton: -10,
    });
    expect(clamped.fontSizeTitle).toBe(10);
    expect(clamped.fontSizeUi).toBe(36);
    expect(clamped.fontSizeButton).toBe(10);

    const customSizes = parseSettings({
      fontSizeTitle: 18,
      fontSizeUi: 14,
      fontSizeButton: 16,
    });
    expect(customSizes.fontSizeTitle).toBe(18);
    expect(customSizes.fontSizeUi).toBe(14);
    expect(customSizes.fontSizeButton).toBe(16);

    const confirmDeleteTrue = parseSettings({ confirmDelete: true });
    expect(confirmDeleteTrue.confirmDelete).toBe(true);

    const confirmDeleteFalse = parseSettings({ confirmDelete: false });
    expect(confirmDeleteFalse.confirmDelete).toBe(false);

    const confirmDeleteInvalid = parseSettings({ confirmDelete: 'yes' });
    expect(confirmDeleteInvalid.confirmDelete).toBe(false);
  });

  test('parseSettings migrates legacy values and preserves shelfSort', () => {
    const legacy = parseSettings({
      advance: false,
      shelfSort: 'title',
      seconds: 5,
    });
    expect(legacy.endAction).toBe('stop');
    expect(legacy.shelfSort).toBe('title');
    expect(legacy.customSeconds).toBe(false);

    const nonStandardSeconds = parseSettings({ seconds: 7 });
    expect(nonStandardSeconds.customSeconds).toBe(true);
  });

  test('parseSummary validates summary records and rejects malformed entries', () => {
    const valid = parseSummary({
      id: 'manga-123',
      title: 'Valid Manga',
      chapterCount: 10,
      chaptersRead: 5,
      lastChapter: 4,
      lastChapterName: 'Chapter 5',
      hasProgress: true,
      indexedAt: 1234567890,
      addedAt: 1234567800,
      updatedAt: 1234567890,
    });
    expect(valid).toBeDefined();
    expect(valid?.id).toBe('manga-123');
    expect(valid?.slug).toBe('valid-manga');
    expect(valid?.chaptersRead).toBe(5);

    // Missing required identifiers return undefined
    expect(parseSummary(null)).toBeUndefined();
    expect(parseSummary({})).toBeUndefined();
    expect(parseSummary({ id: '', title: 'Missing ID' })).toBeUndefined();
    expect(parseSummary({ id: 'valid-id', title: '' })).toBeUndefined();

    // Corrupted counts are safely normalized
    const sanitized = parseSummary({
      id: 'm-2',
      title: 'Sanitized',
      chapterCount: -5,
      chaptersRead: 999,
      lastChapter: 999,
    });
    expect(sanitized?.chapterCount).toBe(0);
    expect(sanitized?.chaptersRead).toBe(0);
    expect(sanitized?.lastChapter).toBe(0);
  });

  test('parseManga preserves localPath for native desktop reads', () => {
    const manga = parseManga({
      id: 'desktop-manga',
      title: 'Desktop Manga',
      localPath: 'C:\\Manga\\DesktopTitle',
      sort: 'natural',
      revision: 3,
      chapters: [
        {
          name: 'Chapter 1',
          pages: [{ name: '01.jpg', path: 'ch1/01.jpg', width: 800, height: 1200 }],
        },
      ],
    });
    expect(manga.localPath).toBe('C:\\Manga\\DesktopTitle');
    expect(manga.sort).toBe('natural');
    expect(manga.revision).toBe(3);
  });

  test('parseSummary preserves revision and handle when preserveHardwarePointers is true', () => {
    const fakeHandle = { kind: 'directory', name: 'MangaFolder' };
    const stripped = parseSummary({
      id: 'manga-handle',
      title: 'Manga Handle',
      handle: fakeHandle,
      revision: 8,
    });
    expect(stripped?.handle).toBeUndefined();
    expect(stripped?.revision).toBe(8);

    const preserved = parseSummary(
      {
        id: 'manga-handle',
        title: 'Manga Handle',
        handle: fakeHandle,
        revision: 8,
      },
      { preserveHardwarePointers: true },
    );
    expect(preserved?.handle).toBe(fakeHandle);
    expect(preserved?.revision).toBe(8);
  });

  test('sortLibraryEntries and shelfCollator naturally sort titles with numeric collation', () => {
    const list = [
      {
        id: '1',
        title: 'Chapter 10',
        addedAt: 100,
        updatedAt: 100,
        chapterCount: 1,
        chaptersRead: 0,
      },
      {
        id: '2',
        title: 'Chapter 2',
        addedAt: 200,
        updatedAt: 200,
        chapterCount: 1,
        chaptersRead: 0,
      },
      {
        id: '3',
        title: 'chapter 1',
        addedAt: 300,
        updatedAt: 300,
        chapterCount: 1,
        chaptersRead: 0,
      },
    ];
    // Shelf sort 'title' sorts natural numeric order (chapter 1, Chapter 2, Chapter 10)
    const sorted = sortLibraryEntries(list, 'title');
    expect(sorted.map((m) => m.title)).toEqual(['chapter 1', 'Chapter 2', 'Chapter 10']);

    // Module-level collator provides base sensitivity natural comparison
    expect(shelfCollator.compare('Chapter 2', 'Chapter 10')).toBeLessThan(0);
    expect(shelfCollator.compare('Chapter 10', 'Chapter 2')).toBeGreaterThan(0);
    expect(shelfCollator.compare('naruto', 'Naruto')).toBe(0);

    // Shelf sort 'recent' (default) sorts by updatedAt desc with title fallback
    const byRecent = sortLibraryEntries(list, 'recent');
    expect(byRecent.map((m) => m.id)).toEqual(['3', '2', '1']);
  });

  test('bookmarkCollator provides base sensitivity natural comparison', () => {
    expect(bookmarkCollator.compare('Vol 2', 'Vol 10')).toBeLessThan(0);
    expect(bookmarkCollator.compare('Bleach', 'bleach')).toBe(0);
  });
});
