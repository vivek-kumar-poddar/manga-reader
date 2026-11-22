import type { PageImageResourceOptions } from './types';

export function getPageImageUrl(options: PageImageResourceOptions): string {
  const { mangaId, pagePath, version = 1, transform = 'full', localPath } = options;
  const encodedMangaId = encodeURIComponent(mangaId);
  const encodedVersion = encodeURIComponent(String(version));
  const encodedTransform = encodeURIComponent(transform);
  const normalizedPath = pagePath.replace(/\\/g, '/').replace(/^\/+/, '');
  const segments = normalizedPath.split('/').filter(Boolean).map(encodeURIComponent);
  const encodedPagePath = segments.join('/');

  let url = `http://mangaimg.localhost/page/${encodedMangaId}/${encodedVersion}/${encodedTransform}/${encodedPagePath}`;
  if (localPath) {
    url += `?root=${encodeURIComponent(localPath)}`;
  }
  return url;
}

export function getCoverImageUrl(
  mangaId: string,
  version?: string | number,
  size?: number,
): string {
  const encodedMangaId = encodeURIComponent(mangaId);
  const ver =
    version !== undefined && version !== null ? `/${encodeURIComponent(String(version))}` : '';
  const query = size ? `?size=${size}` : '';
  return `http://mangaimg.localhost/cover/${encodedMangaId}${ver}${query}`;
}
