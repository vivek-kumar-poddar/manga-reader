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

export class ImageQueue {
  private queue: QueuedItem[] = [];
  private activeCount = 0;
  private inFlight = new Map<string, QueuedItem>();

  get pendingCount(): number {
    return this.queue.length;
  }

  get runningCount(): number {
    return this.activeCount;
  }

  private getMaxConcurrency(): number {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      const isMobile = window.matchMedia('(max-width:700px)').matches;
      if (isMobile) {
        return limits.mobilePageConcurrency;
      }
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
        return 1;
      }
      // Modest devices (<= 4 cores or <= 4 GB RAM) -> concurrency 2
      if ((cores && cores <= 4) || (mem && mem <= 4)) {
        return Math.min(2, limits.desktopPageConcurrency);
      }
    }

    return limits.desktopPageConcurrency;
  }

  /**
   * Updates priority of an existing waiting task and re-sorts the queue.
   */
  reprioritize(key: string, priority: number): void {
    const item = this.queue.find((q) => q.key === key);
    if (item && item.priority !== priority) {
      item.priority = priority;
      this.sortQueue();
    }
  }

  /**
   * Enqueues an image load task.
   * Returns a cancellation handle, or null if the queue is full.
   */
  enqueue(options: ImageTaskOptions): CancelHandle | null {
    const { key, priority = 0, run } = options;

    // Check if task with identical key is already queued; boost priority if higher
    const existingIndex = this.queue.findIndex((item) => item.key === key);
    if (existingIndex >= 0) {
      const existing = this.queue[existingIndex];
      if (priority > existing.priority) {
        existing.priority = priority;
        this.sortQueue();
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
    this.sortQueue();
    this.pump();

    return () => this.cancel(key);
  }

  /**
   * Cancels a queued or running task by key.
   */
  cancel(key: string): void {
    // 1. Remove from waiting queue if not yet started
    const index = this.queue.findIndex((item) => item.key === key);
    if (index >= 0) {
      const item = this.queue.splice(index, 1)[0];
      item.canceled = true;
      item.controller.abort();
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

    for (const running of this.inFlight.values()) {
      running.canceled = true;
      running.controller.abort();
    }
    this.inFlight.clear();
  }

  private sortQueue(): void {
    this.queue.sort((a, b) => b.priority - a.priority);
  }

  private pump(): void {
    const maxConcurrency = this.getMaxConcurrency();

    while (this.activeCount < maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

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
