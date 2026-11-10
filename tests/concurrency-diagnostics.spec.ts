import { expect, test } from '@playwright/test';
import { summary } from '../src/storage';
import {
  recordDiagnostic,
  getDiagnostics,
  clearDiagnostics,
  sanitizeIdentifier,
} from '../src/diagnostics';
import { limits } from '../src/limits';
import type { Manga, Position } from '../src/model';

test.describe('Step 10 — Concurrency Ownership Across Tabs & Jobs', () => {
  test('summary() reflects revision counter', () => {
    const manga: Manga = {
      id: 'rev-manga',
      title: 'Revision Manga',
      chapters: [{ name: 'Ch 1', pages: [], read: false }],
      lastChapter: 0,
      addedAt: 1000,
      updatedAt: 2000,
      revision: 4,
    };

    const s = summary(manga);
    expect(s.revision).toBe(4);
    expect(s.indexedAt).toBe(2000);
  });

  test('summary() defaults revision to 1 when absent on legacy record', () => {
    const legacyManga: Manga = {
      id: 'legacy-manga',
      title: 'Legacy Manga',
      chapters: [],
      lastChapter: 0,
      addedAt: 1000,
      updatedAt: 2000,
    };

    const s = summary(legacyManga);
    expect(s.revision).toBe(1);
  });
});

test.describe('Step 15 — Bounded Diagnostics (diagnostics.ts)', () => {
  test.beforeEach(() => {
    clearDiagnostics();
  });

  test('records events and bounds storage to MAX_DIAGNOSTICS (50)', () => {
    for (let i = 0; i < 60; i++) {
      recordDiagnostic({
        operation: 'import',
        level: 'warn',
        message: `Warning entry ${i}`,
      });
    }

    const entries = getDiagnostics();
    expect(entries.length).toBe(50);
    // Oldest entries 0-9 were shifted out; entry 10 is the first retained
    expect(entries[0].message).toBe('Warning entry 10');
    expect(entries[entries.length - 1].message).toBe('Warning entry 59');
  });

  test('deduplicates rapid repeat diagnostics with identical properties', () => {
    const d1 = recordDiagnostic({
      operation: 'cover',
      level: 'error',
      message: 'Failed to decode thumbnail',
    });

    const d2 = recordDiagnostic({
      operation: 'cover',
      level: 'error',
      message: 'Failed to decode thumbnail',
    });

    // Should return the identical recent entry and not add a second entry
    expect(d1).toBe(d2);
    expect(getDiagnostics().length).toBe(1);
  });

  test('ignores expected user cancellations and AbortErrors', () => {
    const d1 = recordDiagnostic({
      operation: 'import',
      level: 'info',
      code: 'AbortError',
      message: 'User aborted scan',
    });

    const d2 = recordDiagnostic({
      operation: 'import',
      level: 'warn',
      message: 'Import cancelled by user',
    });

    expect(d1).toBeNull();
    expect(d2).toBeNull();
    expect(getDiagnostics().length).toBe(0);
  });

  test('sanitizes identifiers to leaf path segments', () => {
    expect(sanitizeIdentifier('C:\\Users\\User\\Documents\\Manga\\One Piece\\Ch1')).toBe(
      'One Piece/Ch1',
    );
    expect(sanitizeIdentifier('/home/user/manga/Naruto/ch01')).toBe('Naruto/ch01');
    expect(sanitizeIdentifier('Solo Leveling')).toBe('Solo Leveling');
    expect(sanitizeIdentifier('')).toBeUndefined();
  });
});
