/** Normalizes path separators to forward slashes and removes redundant slashes. */
export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '');
}

/** Keep native-script letters while removing emoji, unsafe punctuation and Latin accents. */
export function folderSlug(name: string) {
  return (
    name
      .normalize('NFKD')
      .replace(/[0-9#*]\uFE0F?\u20E3/g, '')
      .replace(
        /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D\u{E0020}-\u{E007F}]/gu,
        '',
      )
      .replace(/([A-Za-z])\p{M}+/gu, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 100)
      .replace(/-+$/, '')
      .normalize('NFC') || 'manga'
  );
}
export function uniqueSlug(name: string, used: Set<string>) {
  const base = folderSlug(name);
  const reserved = ['read', 'assets', 'api'];
  // At most used.size + reserved.length candidates can collide.
  for (let attempt = 0; attempt <= used.size + reserved.length; attempt++) {
    const slug = attempt === 0 ? base : base + '-' + (attempt + 1);
    if (!used.has(slug) && !reserved.includes(slug)) return slug;
  }
  throw new Error('Could not allocate a unique title URL.');
}
export function mangaPath(
  m: { slug?: string; title: string; lastChapter: number },
  index = m.lastChapter,
) {
  return '/' + encodeURIComponent(m.slug || folderSlug(m.title)) + '/ch' + (index + 1);
}
export function chapterIndex(segment: string | undefined, count: number, fallback: number) {
  const match = segment?.match(/^ch([1-9]\d*)$/);
  const n = match ? Number(match[1]) - 1 : fallback;
  return Math.max(0, Math.min(count - 1, Number.isFinite(n) ? Math.floor(n) : 0));
}

export function mangaDetailsPath(m: { slug?: string; title: string }) {
  return '/' + encodeURIComponent(m.slug || folderSlug(m.title)) + '/';
}
