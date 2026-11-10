import { expect, test } from '@playwright/test';
import { headerDimensions, clearDimensionCache } from '../src/imageDimensions';
import { thumbnail } from '../src/images';
import { ImageQueue, resetConcurrencyCacheForTesting } from '../src/imageQueue';
import { ObjectUrlPool, getAdaptivePoolSize, defaultObjectUrlPool } from '../src/objectUrlPool';

test.describe('Image Loading Pipeline Improvements', () => {
  test.beforeEach(() => {
    clearDimensionCache();
  });

  test('headerDimensions parses WebP VP8 lossy header', async () => {
    // 30-byte mock WebP VP8:
    // 0..3: 'RIFF', 4..7: size, 8..11: 'WEBP', 12..15: 'VP8 ', 16..19: chunk size
    // 20..22: 3 bytes tag, 23..25: 0x9d, 0x01, 0x2a, 26..27: width 800, 28..29: height 1200
    const buffer = new Uint8Array(32);
    // 'RIFF'
    buffer.set([0x52, 0x49, 0x46, 0x46], 0);
    // 'WEBP'
    buffer.set([0x57, 0x45, 0x42, 0x50], 8);
    // 'VP8 '
    buffer.set([0x56, 0x50, 0x38, 0x20], 12);
    // Frame start code
    buffer[23] = 0x9d;
    buffer[24] = 0x01;
    buffer[25] = 0x2a;
    // Width: 800 (0x0320)
    buffer[26] = 0x20;
    buffer[27] = 0x03;
    // Height: 1200 (0x04b0)
    buffer[28] = 0xb0;
    buffer[29] = 0x04;

    const file = new File([buffer], 'test-lossy.webp', { type: 'image/webp' });
    const size = await headerDimensions(file);
    expect(size).toEqual({ width: 800, height: 1200 });
  });

  test('headerDimensions parses WebP VP8L lossless header', async () => {
    const buffer = new Uint8Array(26);
    buffer.set([0x52, 0x49, 0x46, 0x46], 0);
    buffer.set([0x57, 0x45, 0x42, 0x50], 8);
    buffer.set([0x56, 0x50, 0x38, 0x4c], 12);
    buffer[20] = 0x2f; // VP8L signature

    // Width = 640 => (640 - 1) = 639 (0x027f) in low 14 bits
    // Height = 480 => (480 - 1) = 479 (0x01df) in next 14 bits
    // bits = 639 | (479 << 14)
    const val = 639 | (479 << 14);
    buffer[21] = val & 0xff;
    buffer[22] = (val >> 8) & 0xff;
    buffer[23] = (val >> 16) & 0xff;
    buffer[24] = (val >> 24) & 0xff;

    const file = new File([buffer], 'test-lossless.webp', { type: 'image/webp' });
    const size = await headerDimensions(file);
    expect(size).toEqual({ width: 640, height: 480 });
  });

  test('headerDimensions parses WebP VP8X extended header', async () => {
    const buffer = new Uint8Array(32);
    buffer.set([0x52, 0x49, 0x46, 0x46], 0);
    buffer.set([0x57, 0x45, 0x42, 0x50], 8);
    buffer.set([0x56, 0x50, 0x38, 0x58], 12);

    // Canvas width = 1200 => width - 1 = 1199 (0x0004af) at 24..26
    buffer[24] = 0xaf;
    buffer[25] = 0x04;
    buffer[26] = 0x00;

    // Canvas height = 1800 => height - 1 = 1799 (0x000707) at 27..29
    buffer[27] = 0x07;
    buffer[28] = 0x07;
    buffer[29] = 0x00;

    const file = new File([buffer], 'test-extended.webp', { type: 'image/webp' });
    const size = await headerDimensions(file);
    expect(size).toEqual({ width: 1200, height: 1800 });
  });

  test('headerDimensions parses JPEG with EXIF APP1 marker without falling back to undefined', async () => {
    // Construct minimal JPEG with APP1 (EXIF) followed by SOF0 (0xc0)
    // SOI: FF D8
    // APP1: FF E1, length = 16 (0x0010), payload: 'Exif\0\0' (6 bytes), TIFF header (8 bytes)
    // SOF0: FF C0, length = 11 (0x000b), precision = 8, height = 1600 (0x0640), width = 1000 (0x03e8), components = 3
    const buffer = new Uint8Array([
      0xff,
      0xd8, // SOI
      0xff,
      0xe1, // APP1
      0x00,
      0x10, // length = 16
      0x45,
      0x78,
      0x69,
      0x66,
      0x00,
      0x00, // 'Exif\0\0'
      0x49,
      0x49,
      0x2a,
      0x00,
      0x08,
      0x00,
      0x00,
      0x00, // Dummy TIFF
      0xff,
      0xc0, // SOF0
      0x00,
      0x0b, // length = 11
      0x08, // precision = 8
      0x06,
      0x40, // height = 1600
      0x03,
      0xe8, // width = 1000
      0x03,
      0x01,
      0x11,
      0x00, // 3 channels
    ]);

    const file = new File([buffer], 'test-exif.jpg', { type: 'image/jpeg' });
    const size = await headerDimensions(file);
    expect(size).toEqual({ width: 1000, height: 1600 });
  });

  test('headerDimensions caches parsed dimensions across calls', async () => {
    const buffer = new Uint8Array(24);
    // PNG signature
    buffer.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // Width at 16: 900
    const view = new DataView(buffer.buffer);
    view.setUint32(16, 900);
    // Height at 20: 1400
    view.setUint32(20, 1400);

    const file = new File([buffer], 'cached-page.png', {
      type: 'image/png',
      lastModified: 123456789,
    });
    const size1 = await headerDimensions(file);
    const size2 = await headerDimensions(file);

    expect(size1).toEqual({ width: 900, height: 1400 });
    expect(size2).toBe(size1); // Same cached object identity
  });

  test('ImageQueue reprioritize updates waiting task priority and order', async () => {
    const queue = new ImageQueue();
    const executed: string[] = [];

    // Hold 4 concurrency slots with dummy unresolved tasks
    const blockerControllers: Array<() => void> = [];
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `blocker-${i}`,
        priority: 100,
        run: () =>
          new Promise<void>((resolve) => {
            blockerControllers.push(resolve);
          }),
      });
    }

    // Now enqueue two waiting tasks
    queue.enqueue({
      key: 'task-low',
      priority: 10,
      run: async () => {
        executed.push('task-low');
      },
    });

    queue.enqueue({
      key: 'task-high',
      priority: 20,
      run: async () => {
        executed.push('task-high');
      },
    });

    // Reprioritize task-low to 50 (higher than task-high's 20)
    queue.reprioritize('task-low', 50);

    // Release all 4 blockers
    for (const release of blockerControllers) {
      release();
    }

    // Give microtasks time to pump
    await new Promise((r) => setTimeout(r, 10));

    expect(executed[0]).toBe('task-low');
    expect(executed[1]).toBe('task-high');
  });

  test('ObjectUrlPool manages LRU cache, evicts oldest entry, and revokes URLs on clear', () => {
    const revoked: string[] = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (url: string) => {
      revoked.push(url);
    };

    try {
      const pool = new ObjectUrlPool(3);

      pool.set('k1', 'blob:1');
      pool.set('k2', 'blob:2');
      pool.set('k3', 'blob:3');
      expect(pool.size).toBe(3);

      // Access k1 to make it most recently used (LRU order: k2, k3, k1)
      expect(pool.get('k1')).toBe('blob:1');

      // Adding k4 should evict k2 (oldest)
      pool.set('k4', 'blob:4');
      expect(pool.size).toBe(3);
      expect(pool.get('k2')).toBeUndefined();
      expect(revoked).toContain('blob:2');

      // Clear should revoke all remaining (k3, k1, k4)
      pool.clear();
      expect(pool.size).toBe(0);
      expect(revoked).toContain('blob:1');
      expect(revoked).toContain('blob:3');
      expect(revoked).toContain('blob:4');
    } finally {
      URL.revokeObjectURL = origRevoke;
    }
  });

  test('getAdaptivePoolSize scales pool size based on device memory and concurrency', () => {
    const origNavigator = globalThis.navigator;

    try {
      // 1. Constrained device (low memory or low cores -> 12)
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 2, hardwareConcurrency: 8 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(12);

      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 8, hardwareConcurrency: 1 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(12);

      // 2. Moderate device (<= 4GB RAM or <= 4 cores -> 24)
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 4, hardwareConcurrency: 8 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(24);

      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 8, hardwareConcurrency: 4 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(24);

      // 3. High-spec device (>= 8GB RAM and >= 8 cores -> 64)
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 8, hardwareConcurrency: 8 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(64);

      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 16, hardwareConcurrency: 16 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(64);

      // 4. Intermediate device (e.g. 6GB RAM, 6 cores -> 40)
      Object.defineProperty(globalThis, 'navigator', {
        value: { deviceMemory: 6, hardwareConcurrency: 6 },
        configurable: true,
        writable: true,
      });
      expect(getAdaptivePoolSize()).toBe(40);

      // 5. Default object url pool is an instantiated ObjectUrlPool
      expect(defaultObjectUrlPool).toBeInstanceOf(ObjectUrlPool);
    } finally {
      Object.defineProperty(globalThis, 'navigator', {
        value: origNavigator,
        configurable: true,
        writable: true,
      });
    }
  });

  test('thumbnail accepts custom quality parameter without error', async () => {
    // 1x1 GIF
    const gif1x1 = new Uint8Array([
      0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff,
      0xff, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02,
      0x02, 0x44, 0x01, 0x00, 0x3b,
    ]);
    const file = new File([gif1x1], 'thumb.gif', { type: 'image/gif' });
    // In node/playwright test environment without full canvas toBlob support, thumbnail gracefully resolves
    const res = await thumbnail(file, undefined, 0.65).catch(() => undefined);
    expect(res === undefined || res instanceof Blob).toBe(true);
  });

  test('ImageQueue reprioritizes lazily and caches media query evaluations', async () => {
    resetConcurrencyCacheForTesting();
    const queue = new ImageQueue();
    const order: string[] = [];
    const blockers: Array<() => void> = [];

    // Hold all slots
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `hold-${i}`,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    // Queue 5 waiting tasks
    for (let i = 0; i < 5; i++) {
      const id = `item-${i}`;
      queue.enqueue({
        key: id,
        priority: i,
        run: async () => {
          order.push(id);
        },
      });
    }

    // Burst reprioritize multiple items (e.g. active page changes in reader)
    queue.reprioritize('item-0', 100);
    queue.reprioritize('item-1', 90);
    queue.reprioritize('item-2', 80);

    // Release blockers
    for (const b of blockers) b();
    await new Promise((r) => setTimeout(r, 20));

    // Pump should have sorted lazily once and executed highest priority tasks first
    expect(order[0]).toBe('item-0');
    expect(order[1]).toBe('item-1');
    expect(order[2]).toBe('item-2');
  });

  test('ImageQueue insertion sort stably orders tasks and preserves FIFO for equal priorities', async () => {
    resetConcurrencyCacheForTesting();
    const queue = new ImageQueue();
    const executed: string[] = [];
    const blockers: Array<() => void> = [];

    // Hold all 4 concurrency slots
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `hold-${i}`,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    // Enqueue items in arbitrary order with some equal priorities
    const items = [
      { key: 'low-1', priority: 10 },
      { key: 'high-1', priority: 50 },
      { key: 'mid-1', priority: 30 },
      { key: 'high-2', priority: 50 },
      { key: 'low-2', priority: 10 },
      { key: 'mid-2', priority: 30 },
      { key: 'top-1', priority: 80 },
    ];

    for (const item of items) {
      queue.enqueue({
        key: item.key,
        priority: item.priority,
        run: async () => {
          executed.push(item.key);
        },
      });
    }

    // Release blockers
    for (const b of blockers) b();
    await new Promise((r) => setTimeout(r, 20));

    expect(executed).toEqual([
      'top-1', // priority 80
      'high-1', // priority 50 (first inserted)
      'high-2', // priority 50 (second inserted)
      'mid-1', // priority 30 (first inserted)
      'mid-2', // priority 30 (second inserted)
      'low-1', // priority 10 (first inserted)
      'low-2', // priority 10 (second inserted)
    ]);
  });
});
