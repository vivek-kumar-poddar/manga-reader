import { expect, test } from '@playwright/test';
import { deflateSync } from 'node:zlib';

test('failed discovery reads are not cached across a user retry', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/data.ts';
    const { warmSources, indexSource } = await import(path);
    let reads = 0;
    const entry = {
      getFile: async () => {
        if (++reads === 1) throw new DOMException('Temporarily unreadable', 'NotReadableError');
        return new File(
          ['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40000"/>'],
          'panel.svg',
          { type: 'image/svg+xml' },
        );
      },
    };
    const source = { title: 'Retry scan', files: new Map([['panel.svg', entry]]), issues: [] };
    await warmSources([source]);
    const indexed = await indexSource(source);
    return { issues: indexed.issues, height: indexed.m.chapters[0].pages[0].height, reads };
  });
  expect(result.issues).toEqual([]);
  expect(result.height).toBe(40000);
  expect(result.reads).toBeGreaterThan(1);
});

test('mobile low-quality mode displays a large original without canvas resizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.evaluate(
    async (base64) => {
      const dataPath = '/src/data.ts';
      const componentPath = '/src/PageImage.tsx';
      const reactPath = '/node_modules/.vite/deps/react.js';
      const domPath = '/node_modules/.vite/deps/react-dom_client.js';
      const { sessionFiles } = await import(dataPath);
      const { default: PageImage } = await import(componentPath);
      const { createElement } = (await import(reactPath)).default;
      const { createRoot } = (await import(domPath)).default;
      document.documentElement.dataset.bitmapCalls = '0';
      window.createImageBitmap = () => {
        document.documentElement.dataset.bitmapCalls = '1';
        throw new Error('Unexpected optional bitmap allocation');
      };
      const file = new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], 'long.png', {
        type: 'image/png',
      });
      sessionFiles.set('mobile', new Map([[file.name, file]]));
      const host = document.createElement('div');
      document.body.prepend(host);
      createRoot(host).render(
        createElement(PageImage, {
          m: { id: 'mobile' },
          page: { name: file.name, path: file.name, width: 1200, height: 15000 },
          index: 0,
          lowQuality: true,
          report: () => {},
          retryPreparation: () => {},
        }),
      );
    },
    png(1200, 15000),
  );
  await expect(page.locator('.reader-page img')).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-bitmap-calls', '0');
  await expect
    .poll(() =>
      page.locator('.reader-page img').evaluate((im: HTMLImageElement) => im.naturalHeight),
    )
    .toBe(15000);
});

// Real, compressed raster fixtures: exercise browser decoding, not only SVG geometry.
function png(width: number, height: number) {
  function chunk(type: string, data: Buffer) {
    const body = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const byte of body) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const checksum = Buffer.alloc(4);
    checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, body, checksum]);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.alloc((width * 3 + 1) * height))),
    chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
}

test('tall and high-area PNG pages prepare, persist and decode', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(
    async (fixtures) => {
      const path = '/src/data.ts';
      const { sessionFiles, prepareChapter, saveManga, db, indexSource } = await import(path);
      const files = fixtures.map(
        (base64, i) =>
          new File([Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))], `${i}.png`, {
            type: 'image/png',
          }),
      );
      const manga = {
        id: 'long',
        title: 'Long panels',
        addedAt: 1,
        updatedAt: 1,
        lastChapter: 0,
        chapters: [
          {
            name: 'Chapter',
            read: false,
            position: { page: 0, fraction: 0.3 },
            bookmarks: [{ page: 1, fraction: 0.4 }],
            pages: files.map((f) => ({
              name: f.name,
              path: f.name,
              width: 800,
              height: 1200,
              dimensionsPending: true,
            })),
          },
        ],
      };
      const source = {
        title: 'Raster import',
        files: new Map(files.map((f) => [f.name, f])),
        issues: [],
      };
      const imported = await indexSource(source);
      const relinked = await indexSource(source, {}, imported.m);
      await saveManga(manga);
      sessionFiles.set(manga.id, new Map(files.map((f) => [f.name, f])));
      const issues = await prepareChapter(manga, 0);
      const decoded = [];
      for (const file of files) {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.src = url;
        await im.decode();
        decoded.push([im.naturalWidth, im.naturalHeight]);
        im.src = '';
        URL.revokeObjectURL(url);
      }
      return {
        issues,
        importIssues: imported.issues,
        relinkIssues: relinked.issues,
        decoded,
        chapter: manga.chapters[0],
        stored: await (await db).get('manga', manga.id),
      };
    },
    [png(64, 40000), png(800, 21000)],
  );
  expect(result.issues).toEqual([]);
  expect(result.importIssues).toEqual([]);
  expect(result.relinkIssues).toEqual([]);
  expect(result.decoded).toEqual([
    [64, 40000],
    [800, 21000],
  ]);
  expect(
    result.stored.chapters[0].pages.every(
      (p: { dimensionsPending: boolean }) => !p.dimensionsPending,
    ),
  ).toBe(true);
  expect(result.chapter.position.fraction).toBe(0.3);
  expect(result.chapter.bookmarks).toEqual([{ page: 1, fraction: 0.4 }]);
});

test('empty, corrupt, missing and denied files retain actionable reasons and recover', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const path = '/src/data.ts';
    const { sessionFiles, prepareChapter, saveManga } = await import(path);
    const names = ['empty.svg', 'corrupt.svg', 'missing.svg', 'denied.svg'];
    const manga = {
      id: 'errors',
      title: 'Errors',
      addedAt: 1,
      updatedAt: 1,
      lastChapter: 0,
      chapters: [
        {
          name: 'Chapter',
          read: false,
          pages: names.map((name) => ({
            name,
            path: name,
            width: 800,
            height: 1200,
            dimensionsPending: true,
          })),
        },
      ],
    };
    await saveManga(manga);
    const files = new Map<string, unknown>([
      [names[0], new File([], names[0])],
      [names[1], new File(['not an image'], names[1])],
      [
        names[3],
        {
          getFile: async () => {
            throw new DOMException('Denied', 'NotAllowedError');
          },
        },
      ],
    ]);
    sessionFiles.set(manga.id, files);
    const issues = await prepareChapter(manga, 0);
    for (const name of names)
      files.set(
        name,
        new File(['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40000"/>'], name, {
          type: 'image/svg+xml',
        }),
      );
    const retry = await prepareChapter(manga, 0);
    return { issues, retry, pages: manga.chapters[0].pages };
  });
  expect(result.issues).toHaveLength(4);
  expect(result.issues.map((i: { reason: string }) => i.reason).join(' ')).toMatch(/Empty file/);
  expect(result.issues.map((i: { reason: string }) => i.reason).join(' ')).toMatch(/Corrupt image/);
  expect(result.issues.map((i: { reason: string }) => i.reason).join(' ')).toMatch(/Folder access/);
  expect(result.issues.map((i: { reason: string }) => i.reason).join(' ')).toMatch(
    /permission was denied/,
  );
  expect(result.retry).toEqual([]);
  expect(
    result.pages.every(
      (p: { height: number; dimensionsPending: boolean }) =>
        p.height === 40000 && !p.dimensionsPending,
    ),
  ).toBe(true);
});

test('reader retries preparation without re-linking and updates page geometry', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const path = '/src/data.ts';
    const { saveManga } = await import(path);
    await saveManga({
      id: 'retry',
      slug: 'retry',
      title: 'Retry fixture',
      addedAt: 1,
      updatedAt: 1,
      lastChapter: 0,
      chapters: [
        {
          name: 'Chapter',
          read: false,
          pages: [
            {
              name: 'panel.svg',
              path: 'panel.svg',
              width: 800,
              height: 1200,
              dimensionsPending: true,
            },
          ],
        },
      ],
    });
  });
  await page.reload();
  await page.evaluate(async () => {
    const path = '/src/data.ts';
    const { sessionFiles } = await import(path);
    sessionFiles.set('retry', new Map([['panel.svg', new File([], 'panel.svg')]]));
  });
  await page
    .getByRole('button', { name: /Start reading/ })
    .first()
    .click();
  await expect(page.getByRole('alert')).toContainText('Empty file.');
  await page.evaluate(async () => {
    const path = '/src/data.ts';
    const { sessionFiles } = await import(path);
    sessionFiles
      .get('retry')
      .set(
        'panel.svg',
        new File(
          ['<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40000"/>'],
          'panel.svg',
          { type: 'image/svg+xml' },
        ),
      );
  });
  await page.getByRole('button', { name: 'Retry preparation', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.reader-page')).toHaveCSS('aspect-ratio', '80 / 40000');
  await expect(page.locator('.reader-page img')).toBeVisible();
});
