import type { Page, Settings } from './model';

export interface PageOffset {
  page: number;
  top: number;
  height: number;
  bottom: number;
}

export interface GeometryOptions {
  containerWidth: number;
  viewportHeight: number;
  layout: Settings['layout'];
  maxWidth: number;
  zoom: number;
}

export interface WindowRange {
  startIndex: number;
  endIndex: number;
  topSpacer: number;
  bottomSpacer: number;
}

export function calculatePageDimensions(
  page: Pick<Page, 'width' | 'height'>,
  options: GeometryOptions,
): { width: number; height: number } {
  const { containerWidth, viewportHeight, layout, maxWidth, zoom } = options;
  const safeZoom = Math.max(0.1, zoom || 1);
  const nativeWidth = Math.max(1, page.width) * safeZoom;
  const pageAspect = Math.max(1, page.width) / Math.max(1, page.height);

  let targetWidth: number;
  switch (layout) {
    case 'width':
      targetWidth = Math.min(containerWidth, nativeWidth);
      break;
    case 'height': {
      const byHeight = Math.max(1, viewportHeight) * pageAspect * safeZoom;
      targetWidth = Math.min(containerWidth, byHeight, nativeWidth);
      break;
    }
    case 'auto':
      targetWidth = Math.min(containerWidth, 920 * safeZoom, nativeWidth);
      break;
    case 'max':
    default: {
      const readingWidth = maxWidth > 0 ? maxWidth * safeZoom : containerWidth;
      targetWidth = Math.min(containerWidth, readingWidth, nativeWidth);
      break;
    }
  }

  targetWidth = Math.max(1, Math.round(targetWidth));
  const targetHeight = Math.max(1, Math.round(targetWidth / pageAspect));
  return { width: targetWidth, height: targetHeight };
}

export function computeOffsets(
  pages: Page[],
  options: GeometryOptions,
  measuredHeights?: Map<number, number>,
): PageOffset[] {
  const offsets: PageOffset[] = [];
  let currentTop = 0;

  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    let height = measuredHeights?.get(i);
    if (height === undefined || height <= 0 || !Number.isFinite(height)) {
      height = calculatePageDimensions(page, options).height;
    }
    const bottom = currentTop + height;
    offsets.push({
      page: i,
      top: currentTop,
      height,
      bottom,
    });
    currentTop = bottom;
  }

  return offsets;
}

export const VIRTUALIZATION_THRESHOLD = 8;

export function getWindowRange(
  offsets: PageOffset[],
  scrollY: number,
  viewportHeight: number,
  bufferScreenCount: number = 3,
  threshold: number = VIRTUALIZATION_THRESHOLD,
): WindowRange {
  const count = offsets.length;
  if (count <= threshold) {
    return {
      startIndex: 0,
      endIndex: Math.max(0, count - 1),
      topSpacer: 0,
      bottomSpacer: 0,
    };
  }

  const safeViewportHeight = Math.max(1, viewportHeight || 800);
  const buffer = safeViewportHeight * Math.max(1, bufferScreenCount);
  const minY = Math.max(0, scrollY - buffer);
  const maxY = scrollY + safeViewportHeight + buffer;

  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (offsets[mid].bottom >= minY) {
      hi = mid;
    } else {
      lo = mid + 1;
    }
  }
  const startIndex = Math.max(0, lo);

  lo = startIndex;
  hi = count - 1;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (offsets[mid].top <= maxY) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const endIndex = Math.min(count - 1, Math.max(startIndex, lo));

  const topSpacer = offsets[startIndex].top;
  const bottomSpacer = offsets[count - 1].bottom - offsets[endIndex].bottom;

  return {
    startIndex,
    endIndex,
    topSpacer: Math.max(0, topSpacer),
    bottomSpacer: Math.max(0, bottomSpacer),
  };
}