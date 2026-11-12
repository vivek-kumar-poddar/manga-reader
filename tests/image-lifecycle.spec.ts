import { expect, test } from '@playwright/test';
import { ImageQueue, enqueueImage, clearImageQueue } from '../src/imageQueue';
import { dimensions, thumbnail, downscaleImage } from '../src/images';
import { limits } from '../src/limits';
import { ObjectUrlPool } from '../src/objectUrlPool';

test.describe('Step 12 — Removable Page-Image Task Lifecycle (imageQueue.ts)', () => {
  test('enqueue runs task and releases concurrency slot upon completion', async () => {
    const queue = new ImageQueue();
    let executed = false;

    const cancel = queue.enqueue({
      key: 'task-1',
      priority: 1,
      run: async () => {
        executed = true;
      },
    });

    expect(cancel).toBeDefined();
    // Allow pump microtask loop to complete
    await new Promise((r) => setTimeout(r, 20));

    expect(executed).toBe(true);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  test('cancel() removes a waiting task from the queue before it starts', async () => {
    const queue = new ImageQueue();
    const executed: string[] = [];

    // Enqueue 4 long-running tasks to fill desktop concurrency (4)
    const blockers: (() => void)[] = [];
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `blocker-${i}`,
        priority: 5,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    expect(queue.runningCount).toBe(4);

    // Enqueue a 5th task that will be queued
    const cancel5 = queue.enqueue({
      key: 'queued-task-5',
      priority: 1,
      run: async () => {
        executed.push('task-5');
      },
    });

    expect(queue.pendingCount).toBe(1);

    // Cancel task-5 before blockers release
    expect(cancel5).toBeDefined();
    cancel5!();

    expect(queue.pendingCount).toBe(0);

    // Release blockers
    blockers.forEach((unblock) => unblock());
    await new Promise((r) => setTimeout(r, 20));

    expect(executed).not.toContain('task-5');
    expect(queue.runningCount).toBe(0);
  });

  test('cancel() aborts an active in-flight task via AbortSignal', async () => {
    const queue = new ImageQueue();
    let aborted = false;

    const cancel = queue.enqueue({
      key: 'active-task',
      priority: 10,
      run: async (signal) => {
        await new Promise<void>((resolve) => {
          signal.addEventListener(
            'abort',
            () => {
              aborted = true;
              resolve();
            },
            { once: true },
          );
        });
      },
    });

    expect(queue.runningCount).toBe(1);
    expect(cancel).toBeDefined();

    cancel!();
    await new Promise((r) => setTimeout(r, 20));

    expect(aborted).toBe(true);
    expect(queue.runningCount).toBe(0);
  });

  test('priority scheduling executes higher-priority tasks ahead of lower-priority tasks', async () => {
    const queue = new ImageQueue();
    const order: string[] = [];
    const blockers: (() => void)[] = [];

    // Fill concurrency slots
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `fill-${i}`,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    // Add low priority task first, then high priority task second
    queue.enqueue({
      key: 'low-priority',
      priority: 1,
      run: async () => {
        order.push('low');
      },
    });

    queue.enqueue({
      key: 'high-priority',
      priority: 10,
      run: async () => {
        order.push('high');
      },
    });

    expect(queue.pendingCount).toBe(2);

    // Release one blocker slot
    blockers[0]();
    await new Promise((r) => setTimeout(r, 20));

    // High priority task should have been popped first!
    expect(order[0]).toBe('high');

    // Release remaining blockers
    blockers.slice(1).forEach((b) => b());
    await new Promise((r) => setTimeout(r, 20));

    expect(order).toEqual(['high', 'low']);
  });

  test('deduplication updates priority without creating redundant work', async () => {
    const queue = new ImageQueue();
    const runCount: Record<string, number> = { 'page-1': 0 };
    const blockers: (() => void)[] = [];

    // Fill concurrency
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `b-${i}`,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    // Enqueue with low priority
    queue.enqueue({
      key: 'page-1',
      priority: 1,
      run: async () => {
        runCount['page-1']++;
      },
    });

    // Enqueue identical key with higher priority (e.g. user scrolled it into viewport)
    queue.enqueue({
      key: 'page-1',
      priority: 15,
      run: async () => {
        runCount['page-1']++;
      },
    });

    // Still only 1 pending item in queue!
    expect(queue.pendingCount).toBe(1);

    blockers.forEach((b) => b());
    await new Promise((r) => setTimeout(r, 20));

    // Ran exactly once
    expect(runCount['page-1']).toBe(1);
  });

  test('worker rejection never stalls the queue or leaks slots', async () => {
    const queue = new ImageQueue();
    let secondTaskRan = false;

    // First task throws
    queue.enqueue({
      key: 'failing-task',
      priority: 10,
      run: async () => {
        throw new Error('Disk read fault');
      },
    });

    // Second task should still run cleanly
    queue.enqueue({
      key: 'healthy-task',
      priority: 5,
      run: async () => {
        secondTaskRan = true;
      },
    });

    await new Promise((r) => setTimeout(r, 30));

    expect(secondTaskRan).toBe(true);
    expect(queue.runningCount).toBe(0);
    expect(queue.pendingCount).toBe(0);
  });

  test('capacity bounding rejects new tasks when limits.queuedJobs is exceeded', async () => {
    const queue = new ImageQueue();
    const blockers: (() => void)[] = [];

    // Fill concurrency slots
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `slot-${i}`,
        run: () =>
          new Promise<void>((resolve) => {
            blockers.push(resolve);
          }),
      });
    }

    // Fill waiting queue up to limits.queuedJobs (64)
    for (let i = 0; i < limits.queuedJobs; i++) {
      const handle = queue.enqueue({
        key: `job-${i}`,
        run: async () => {},
      });
      expect(handle).not.toBeNull();
    }

    expect(queue.pendingCount).toBe(limits.queuedJobs);

    // 65th queued task should be rejected with null
    const overflowHandle = queue.enqueue({
      key: 'overflow-job',
      run: async () => {},
    });

    expect(overflowHandle).toBeNull();

    // Cleanup
    queue.clear();
    blockers.forEach((b) => b());
  });

  test('clear() purges all pending and in-flight tasks', async () => {
    const queue = new ImageQueue();
    let abortedCount = 0;

    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `active-${i}`,
        run: async (signal) => {
          await new Promise<void>((resolve) => {
            signal.addEventListener('abort', () => {
              abortedCount++;
              resolve();
            });
          });
        },
      });
    }

    queue.enqueue({
      key: 'waiting-1',
      run: async () => {},
    });

    expect(queue.runningCount).toBe(4);
    expect(queue.pendingCount).toBe(1);

    queue.clear();

    expect(queue.pendingCount).toBe(0);
    await new Promise((r) => setTimeout(r, 20));

    expect(abortedCount).toBe(4);
    expect(queue.runningCount).toBe(0);
  });
});

test.describe('Step 13 — Safe Image Decoding & Resource Cleanup (images.ts)', () => {
  test('downscaleImage gracefully returns original blob in non-browser or non-bitmap environments', async () => {
    const dummyBlob = new Blob(['sample-image-data'], { type: 'image/jpeg' });
    const result = await downscaleImage(dummyBlob, 800, 600);
    expect(result).toBe(dummyBlob);
  });

  test('downscaleImage throws AbortError when signal is already aborted', async () => {
    const dummyBlob = new Blob(['sample-image-data'], { type: 'image/jpeg' });
    const controller = new AbortController();
    controller.abort();

    await expect(downscaleImage(dummyBlob, 800, 600, controller.signal)).rejects.toThrow();
  });

  test('dimensions throws when signal is already aborted', async () => {
    const file = new File(['mock'], 'page.jpg', { type: 'image/jpeg' });
    const controller = new AbortController();
    controller.abort();

    await expect(dimensions(file, controller.signal)).rejects.toThrow();
  });

  test('thumbnail throws when signal is already aborted', async () => {
    const file = new File(['mock'], 'cover.jpg', { type: 'image/jpeg' });
    const controller = new AbortController();
    controller.abort();

    await expect(thumbnail(file, controller.signal)).rejects.toThrow();
  });
});

test.describe('Step 40 — 1.9 Queue and Object-URL Lifecycle (imageQueue.ts & objectUrlPool.ts)', () => {
  test('duplicate keys notify all subscribers upon completion without duplicate worker runs', async () => {
    const queue = new ImageQueue();
    let runs = 0;
    let sub1Done = false;
    let sub2Done = false;

    queue.enqueue({
      key: 'shared-page-key',
      priority: 1,
      run: async () => {
        runs++;
      },
      onComplete: () => {
        sub1Done = true;
      },
    });

    queue.enqueue({
      key: 'shared-page-key',
      priority: 2,
      run: async () => {
        runs++;
      },
      onComplete: () => {
        sub2Done = true;
      },
    });

    await new Promise((r) => setTimeout(r, 30));

    expect(runs).toBe(1);
    expect(sub1Done).toBe(true);
    expect(sub2Done).toBe(true);
  });

  test('individual cancellation unregisters subscriber; task continues until all cancel', async () => {
    const queue = new ImageQueue();
    let runs = 0;
    let sub2Done = false;
    const blockers: (() => void)[] = [];

    // Fill concurrency
    for (let i = 0; i < 4; i++) {
      queue.enqueue({
        key: `b-${i}`,
        run: () => new Promise<void>((res) => blockers.push(res)),
      });
    }

    const cancel1 = queue.enqueue({
      key: 'contested-task',
      priority: 1,
      run: async () => {
        runs++;
      },
    });

    const cancel2 = queue.enqueue({
      key: 'contested-task',
      priority: 5,
      run: async () => {
        runs++;
      },
      onComplete: () => {
        sub2Done = true;
      },
    });

    // Caller 1 cancels its handle
    expect(cancel1).not.toBeNull();
    cancel1!();

    // The task should still be pending because subscriber 2 remains
    expect(queue.pendingCount).toBe(1);

    // Release blockers so contested-task can run
    blockers.forEach((b) => b());
    await new Promise((r) => setTimeout(r, 30));

    expect(runs).toBe(1);
    expect(sub2Done).toBe(true);
  });

  test('ObjectUrlPool revokes replaced URL when key is overwritten with different URL', () => {
    const revoked: string[] = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => revoked.push(u);

    try {
      const pool = new ObjectUrlPool(5);
      pool.set('page:1', 'blob:http://localhost/first');
      expect(pool.get('page:1')).toBe('blob:http://localhost/first');

      // Overwrite with a different URL
      pool.set('page:1', 'blob:http://localhost/second');
      expect(pool.get('page:1')).toBe('blob:http://localhost/second');
      expect(revoked).toContain('blob:http://localhost/first');
    } finally {
      URL.revokeObjectURL = origRevoke;
    }
  });

  test('ObjectUrlPool pins consumers: retained URL is not revoked on LRU eviction until released', () => {
    const revoked: string[] = [];
    const origRevoke = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => revoked.push(u);

    try {
      const pool = new ObjectUrlPool(2);
      pool.set('img:1', 'blob:http://localhost/1');
      pool.set('img:2', 'blob:http://localhost/2');

      // Consumer retains img:1
      const release1 = pool.retain('img:1');

      // Adding img:3 causes LRU eviction of img:1 from cache
      pool.set('img:3', 'blob:http://localhost/3');
      expect(pool.get('img:1')).toBeUndefined(); // evicted from cache

      // But img:1 was retained by consumer, so it MUST NOT be revoked yet!
      expect(revoked).not.toContain('blob:http://localhost/1');

      // When consumer unmounts and releases:
      release1();
      // Now it must be revoked!
      expect(revoked).toContain('blob:http://localhost/1');
    } finally {
      URL.revokeObjectURL = origRevoke;
    }
  });
});
