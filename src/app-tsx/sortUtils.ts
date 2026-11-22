import type { Summary, Settings } from '../data';

export const shelfCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortLibraryEntries(
  library: readonly Summary[],
  shelfSort: Settings['shelfSort'] = 'recent',
): Summary[] {
  return [...library].sort((a, b) => {
    const byTitle = shelfCollator.compare(a.title, b.title);
    return (
      (shelfSort === 'title'
        ? byTitle
        : shelfSort === 'added'
          ? b.addedAt - a.addedAt
          : shelfSort === 'progress'
            ? b.chaptersRead / Math.max(1, b.chapterCount) -
              a.chaptersRead / Math.max(1, a.chapterCount)
            : b.updatedAt - a.updatedAt) ||
      byTitle ||
      shelfCollator.compare(a.id, b.id)
    );
  });
}
