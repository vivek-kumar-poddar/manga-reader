import { expect, test } from '@playwright/test';
import {
  calculatePageDimensions,
  computeOffsets,
  getWindowRange,
  type GeometryOptions,
} from '../src/readerGeometry';
import { createPageStore } from '../src/Reader';
import type { Page } from '../src/model';

function makePages(count: number, width = 800, height = 1200): Page[] {
  return Array.from({ length: count }, (_, i) => ({
    name: `page-${i + 1}.png`,
    path: `ch1/page-${i + 1}.png`,
    width,
    height,
  }));
}

const defaultOptions: GeometryOptions = {
  containerWidth: 1000,
  viewportHeight: 900,
  layout: 'max',
  maxWidth: 920,
  zoom: 1,
};

test.describe('Step 17 — Reader Geometry and DOM Virtualization', () => {
  test('calculatePageDimensions respects layout modes and aspect ratio', () => {
    const page = { width: 800, height: 1200 };

    // Max layout with maxWidth 920 on 1000px container
    const dimMax = calculatePageDimensions(page, defaultOptions);
    expect(dimMax.width).toBe(800);
    expect(dimMax.height).toBe(1200);

    // Width layout: expands up to container width
    const dimWidth = calculatePageDimensions(page, {
      ...defaultOptions,
      layout: 'width',
      containerWidth: 600,
    });
    expect(dimWidth.width).toBe(600);
    expect(dimWidth.height).toBe(900); // 600 * 1.5

    // Height layout: constrained by viewport height
    const dimHeight = calculatePageDimensions(page, {
      ...defaultOptions,
      layout: 'height',
      viewportHeight: 600,
    });
    // aspect is 800/1200 = 0.6666...; 600 * (2/3) = 400
    expect(dimHeight.width).toBe(400);
    expect(dimHeight.height).toBe(600);

    // Zoom scaling
    const dimZoom = calculatePageDimensions(page, {
      ...defaultOptions,
      zoom: 1.5,
      containerWidth: 2000,
      maxWidth: 2000,
    });
    expect(dimZoom.width).toBe(1200);
    expect(dimZoom.height).toBe(1800);
  });

  test('computeOffsets correctly calculates cumulative prefix tops and bottoms', () => {
    const pages = makePages(5, 800, 1000);
    const offsets = computeOffsets(pages, defaultOptions);

    expect(offsets).toHaveLength(5);
    expect(offsets[0].top).toBe(0);
    expect(offsets[0].height).toBe(1000);
    expect(offsets[0].bottom).toBe(1000);

    expect(offsets[1].top).toBe(1000);
    expect(offsets[1].height).toBe(1000);
    expect(offsets[1].bottom).toBe(2000);

    expect(offsets[4].bottom).toBe(5000);
  });

  test('computeOffsets incorporates measured DOM heights when available', () => {
    const pages = makePages(3, 800, 1000);
    const measured = new Map<number, number>([
      [0, 1050],
      [1, 950],
    ]);
    const offsets = computeOffsets(pages, defaultOptions, measured);

    expect(offsets[0].height).toBe(1050);
    expect(offsets[0].bottom).toBe(1050);

    expect(offsets[1].top).toBe(1050);
    expect(offsets[1].height).toBe(950);
    expect(offsets[1].bottom).toBe(2000);

    // Page 2 was not measured; uses default calculated height
    expect(offsets[2].top).toBe(2000);
    expect(offsets[2].height).toBe(1000);
    expect(offsets[2].bottom).toBe(3000);
  });

  test('getWindowRange does not window small chapters (<= 8 pages)', () => {
    const pages = makePages(7, 800, 1000);
    const offsets = computeOffsets(pages, defaultOptions);

    const range = getWindowRange(offsets, 5000, 900, 3);
    expect(range.startIndex).toBe(0);
    expect(range.endIndex).toBe(6);
    expect(range.topSpacer).toBe(0);
    expect(range.bottomSpacer).toBe(0);
  });

  test('getWindowRange windows chapters larger than threshold (> 8 pages)', () => {
    const pages = makePages(12, 800, 1000);
    const offsets = computeOffsets(pages, defaultOptions);

    // Scroll down to 10,000px with small buffer
    const range = getWindowRange(offsets, 10000, 900, 1);
    expect(range.startIndex).toBeGreaterThan(0);
    expect(range.topSpacer).toBeGreaterThan(0);
  });

  test('getWindowRange windows long chapters with correct buffers and spacers', () => {
    // 100 pages, each 1,000px high => total height = 100,000px
    const pages = makePages(100, 800, 1000);
    const offsets = computeOffsets(pages, defaultOptions);
    const viewportHeight = 1000;
    const totalHeight = 100_000;

    // 1. Top of chapter (scrollY = 0)
    // Buffer = 3 * 1000 = 3000px. Visible range = [0, 4000px] => pages 0 to 4
    const atTop = getWindowRange(offsets, 0, viewportHeight, 3);
    expect(atTop.startIndex).toBe(0);
    expect(atTop.topSpacer).toBe(0);
    expect(atTop.endIndex).toBeGreaterThanOrEqual(3);
    expect(atTop.endIndex).toBeLessThanOrEqual(6);
    expect(atTop.bottomSpacer).toBe(totalHeight - offsets[atTop.endIndex].bottom);
    // Invariant check
    expect(
      atTop.topSpacer +
        (offsets[atTop.endIndex].bottom - offsets[atTop.startIndex].top) +
        atTop.bottomSpacer,
    ).toBe(totalHeight);

    // 2. Middle of chapter (scrollY = 50,000)
    // Buffer = 3000px. Window covers [47,000, 54,000] => pages 47 to 54
    const inMiddle = getWindowRange(offsets, 50_000, viewportHeight, 3);
    expect(inMiddle.startIndex).toBeGreaterThan(0);
    expect(inMiddle.startIndex).toBeLessThanOrEqual(47);
    expect(inMiddle.endIndex).toBeGreaterThanOrEqual(54);
    expect(inMiddle.endIndex).toBeLessThan(99);
    expect(inMiddle.topSpacer).toBe(offsets[inMiddle.startIndex].top);
    expect(inMiddle.bottomSpacer).toBe(totalHeight - offsets[inMiddle.endIndex].bottom);
    // Invariant check
    expect(
      inMiddle.topSpacer +
        (offsets[inMiddle.endIndex].bottom - offsets[inMiddle.startIndex].top) +
        inMiddle.bottomSpacer,
    ).toBe(totalHeight);

    // 3. Bottom of chapter (scrollY = 99,000)
    const atBottom = getWindowRange(offsets, 99_000, viewportHeight, 3);
    expect(atBottom.endIndex).toBe(99);
    expect(atBottom.bottomSpacer).toBe(0);
    expect(atBottom.startIndex).toBeGreaterThan(0);
    expect(atBottom.topSpacer).toBe(offsets[atBottom.startIndex].top);
    // Invariant check
    expect(
      atBottom.topSpacer +
        (offsets[atBottom.endIndex].bottom - offsets[atBottom.startIndex].top) +
        atBottom.bottomSpacer,
    ).toBe(totalHeight);

    // 4. Negative scroll (overscroll at top)
    const overscroll = getWindowRange(offsets, -500, viewportHeight, 3);
    expect(overscroll.startIndex).toBe(0);
    expect(overscroll.topSpacer).toBe(0);
  });

  test('createPageStore isolates page changes and notifies subscribers without duplicate dispatches', () => {
    const store = createPageStore(0);
    expect(store.getPage()).toBe(0);

    let notifyCount = 0;
    const unsubscribe = store.subscribe(() => {
      notifyCount++;
    });

    // Setting new page triggers listener
    store.setPage(5);
    expect(store.getPage()).toBe(5);
    expect(notifyCount).toBe(1);

    // Setting identical page is a no-op
    store.setPage(5);
    expect(notifyCount).toBe(1);

    // Setting another page triggers listener
    store.setPage(12);
    expect(store.getPage()).toBe(12);
    expect(notifyCount).toBe(2);

    // Unsubscribe disconnects listener
    unsubscribe();
    store.setPage(15);
    expect(store.getPage()).toBe(15);
    expect(notifyCount).toBe(2);
  });
});
