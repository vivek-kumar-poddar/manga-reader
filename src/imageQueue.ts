import { limits } from './limits';

export interface ImageTaskOptions {
  key: string;
  priority?: number;
  run: (signal: AbortSignal) => Promise<void>;
}

export type CancelHandle = () => void;

interface QueuedItem {
  key: string;
  priority: number;
  run: (signal: AbortSignal) => Promise<void>;
  controller: AbortController;
  canceled: boolean;
}

let mobileQuery: MediaQueryList | null = null;
let cachedIsMobile: boolean | null = null;

function getIsMobile(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  if (!mobileQuery) {
    try {
      mobileQuery = window.matchMedia('(max-width:700px)');
      cachedIsMobile = mobileQuery.matches;
      const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
        cachedIsMobile = e.matches;
      };
      if (typeof mobileQuery.addEventListener === 'function') {
        mobileQuery.addEventListener('change', onChange);
      } else if (typeof (mobileQuery as any).addListener === 'function') {
        (mobileQuery as any).addListener(onChange);
      }
    } catch {
      return false;
    }
  }
  return cachedIsMobile ?? false;
}

let cachedHardwareConcurrencyLimit: number | null = null;

function getHardwareConcurrencyLimit(): number {
  if (cachedHardwareConcurrencyLimit !== null) {
    return cachedHardwareConcurrencyLimit;
  }
  if (typeof navigator !== 'undefined') {
    const nav = navigator as unknown as {
      hardwareConcurrency?: number;
      deviceMemory?: number;
    };
    const cores = nav.hardwareConcurrency;
    const mem = nav.deviceMemory;

    // Constrained devices (<= 2 cores or <= 2 GB RAM) -> concurrency 1
    if ((cores && cores <= 2) || (mem && mem <= 2)) {
      cachedHardwareConcurrencyLimit = 1;
      return 1;
    }
    // Modest devices (<= 4 cores or <= 4 GB RAM) -> concurrency 2
    if ((cores && cores <= 4) || (mem && mem <= 4)) {
      cachedHardwareConcurrencyLimit = Math.min(2, limits.desktopPageConcurrency);
      return cachedHardwareConcurrencyLimit;
    }
  }

  cachedHardwareConcurrencyLimit = limits.desktopPageConcurrency;
  return cachedHardwareConcurrencyLimit;
}

export function resetConcurrencyCacheForTesting(): void {
  mobileQuery = null;
  cachedIsMobile = null;
  cachedHardwareConcurrencyLimit = null;
}

export class ImageQueue {
  private queue: QueuedItem[] = [];
  private waiting = new Map<string, QueuedItem>();
  private activeCount = 0;
  private inFlight = new Map<string, QueuedItem>();
  private queueDirty = false;

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.activeCount;
  }

  private getMaxConcurrency(): number {
    if (getIsMobile()) {
      return limits.mobilePageConcurrency;
    }
    return getHardwareConcurrencyLimit();
  }

  /**
   * Updates priority of an existing waiting task and lazily marks queue dirty.
   */
  reprioritize(key: string, priority: number): void {
    const item = this.waiting.get(key);
    if (item && item.priority !== priority) {
      item.priority = priority;
      this.queueDirty = true;
    }
  }

  /**
   * Enqueues an image load task.
   * Returns a cancellation handle, or null if the queue is full.
   */
  enqueue(options: ImageTaskOptions): CancelHandle | null {
    const { key, priority = 0, run } = options;

    // Check if task with identical key is already queued; boost priority if higher
    const existing = this.waiting.get(key);
    if (existing) {
      if (priority > existing.priority) {
        existing.priority = priority;
        this.queueDirty = true;
      }
      return () => this.cancel(key);
    }

    // Check if task is already running in-flight
    if (this.inFlight.has(key)) {
      return () => this.cancel(key);
    }

    // Capacity limit
    if (this.queue.length >= limits.queuedJobs) {
      return null;
    }

    const item: QueuedItem = {
      key,
      priority,
      run,
      controller: new AbortController(),
      canceled: false,
    };

    this.queue.push(item);
    this.waiting.set(key, item);
    this.queueDirty = true;
    this.pump();

    return () => this.cancel(key);
  }

  /**
   * Cancels a queued or running task by key.
   */
  cancel(key: string): void {
    // 1. Remove from waiting queue if not yet started
    const waitingItem = this.waiting.get(key);
    if (waitingItem) {
      this.waiting.delete(key);
      waitingItem.canceled = true;
      waitingItem.controller.abort();
      const index = this.queue.indexOf(waitingItem);
      if (index >= 0) {
        this.queue.splice(index, 1);
      }
      return;
    }

    // 2. Abort if currently in-flight
    const running = this.inFlight.get(key);
    if (running) {
      running.canceled = true;
      running.controller.abort();
    }
  }

  /**
   * Clears all waiting tasks and aborts in-flight tasks.
   */
  clear(): void {
    for (const item of this.queue) {
      item.canceled = true;
      item.controller.abort();
    }
    this.queue.length = 0;
    this.waiting.clear();
    this.queueDirty = false;

    for (const running of this.inFlight.values()) {
      running.canceled = true;
      running.controller.abort();
    }
    this.inFlight.clear();
  }

  private ensureSorted(): void {
    if (this.queueDirty) {
      this.queue.sort((a, b) => b.priority - a.priority);
      this.queueDirty = false;
    }
  }

  private pump(): void {
    const maxConcurrency = this.getMaxConcurrency();

    this.ensureSorted();

    while (this.activeCount < maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.waiting.delete(item.key);

      if (item.canceled) {
        continue;
      }

      this.activeCount++;
      this.inFlight.set(item.key, item);

      void (async () => {
        try {
          if (!item.canceled && !item.controller.signal.aborted) {
            await item.run(item.controller.signal);
          }
        } catch (err) {
          if (!item.controller.signal.aborted) {
            console.warn(`[imageQueue] Task ${item.key} failed:`, err);
          }
        } finally {
          this.activeCount = Math.max(0, this.activeCount - 1);
          this.inFlight.delete(item.key);
          this.pump();
        }
      })();
    }
  }
}

export const defaultImageQueue = new ImageQueue();

export function enqueueImage(options: ImageTaskOptions): CancelHandle | null {
  return defaultImageQueue.enqueue(options);
}

export function clearImageQueue(): void {
  defaultImageQueue.clear();
}

export function reprioritizeImage(key: string, priority: number): void {
  defaultImageQueue.reprioritize(key, priority);
}
