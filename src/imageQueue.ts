import { limits } from './limits';

export interface ImageTaskOptions {
  key: string;
  priority?: number;
  run: (signal: AbortSignal) => Promise<void>;
  onComplete?: () => void;
  onError?: (err: unknown) => void;
}

export type CancelHandle = () => void;

interface Subscriber {
  onComplete?: () => void;
  onError?: (err: unknown) => void;
}

interface QueuedItem {
  key: string;
  priority: number;
  primaryRun: (signal: AbortSignal) => Promise<void>;
  subscribers: Map<number, Subscriber>;
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
  private nextSubscriberId = 0;

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
   * If a task with the identical key is already queued or in-flight, registers the caller
   * as a subscriber so every component receives its own completion.
   * Returns a cancellation handle that unregisters only this subscriber.
   */
  enqueue(options: ImageTaskOptions): CancelHandle | null {
    const { key, priority = 0, run, onComplete, onError } = options;
    const subId = ++this.nextSubscriberId;
    const sub: Subscriber = { onComplete, onError };

    // 1. Task is waiting in queue: register subscriber and boost priority if needed
    const existingWaiting = this.waiting.get(key);
    if (existingWaiting) {
      existingWaiting.subscribers.set(subId, sub);
      if (priority > existingWaiting.priority) {
        existingWaiting.priority = priority;
        this.queueDirty = true;
      }
      return () => this.cancelSubscriber(key, subId);
    }

    // 2. Task is already in-flight: register subscriber so it executes with completion
    const existingInFlight = this.inFlight.get(key);
    if (existingInFlight && !existingInFlight.canceled) {
      existingInFlight.subscribers.set(subId, sub);
      return () => this.cancelSubscriber(key, subId);
    }

    // 3. Queue capacity limit
    if (this.queue.length >= limits.queuedJobs) {
      return null;
    }

    const item: QueuedItem = {
      key,
      priority,
      primaryRun: run,
      subscribers: new Map([[subId, sub]]),
      controller: new AbortController(),
      canceled: false,
    };

    this.queue.push(item);
    this.waiting.set(key, item);
    this.queueDirty = true;
    this.pump();

    return () => this.cancelSubscriber(key, subId);
  }

  /**
   * Cancels an individual subscriber's handle.
   * The underlying operation is only aborted when all subscribers for that key have unsubscribed.
   */
  private cancelSubscriber(key: string, subId: number): void {
    // 1. Check waiting queue
    const waitingItem = this.waiting.get(key);
    if (waitingItem) {
      waitingItem.subscribers.delete(subId);
      if (waitingItem.subscribers.size === 0) {
        this.waiting.delete(key);
        waitingItem.canceled = true;
        waitingItem.controller.abort();
        const index = this.queue.indexOf(waitingItem);
        if (index >= 0) {
          this.queue.splice(index, 1);
        }
      }
      return;
    }

    // 2. Check in-flight tasks
    const running = this.inFlight.get(key);
    if (running) {
      running.subscribers.delete(subId);
      if (running.subscribers.size === 0) {
        running.canceled = true;
        running.controller.abort();
      }
    }
  }

  /**
   * Cancels a queued or running task by key unconditionally (all subscribers).
   */
  cancel(key: string): void {
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

    const running = this.inFlight.get(key);
    if (running) {
      running.canceled = true;
      running.controller.abort();
    }
  }

  /**
   * Clears all waiting tasks and aborts in-flight tasks.
   * In-flight tasks settle and clean themselves up via identity check.
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
  }

  private ensureSorted(): void {
    if (!this.queueDirty) return;
    // Insertion sort is faster than Array.sort for nearly-sorted priority queues of size <= 64
    for (let i = 1; i < this.queue.length; i++) {
      const item = this.queue[i];
      let j = i - 1;
      while (j >= 0 && this.queue[j].priority < item.priority) {
        this.queue[j + 1] = this.queue[j];
        j--;
      }
      this.queue[j + 1] = item;
    }
    this.queueDirty = false;
  }

  private pump(): void {
    const maxConcurrency = this.getMaxConcurrency();

    this.ensureSorted();

    while (this.activeCount < maxConcurrency && this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;

      this.waiting.delete(item.key);

      if (item.canceled || item.subscribers.size === 0) {
        continue;
      }

      this.activeCount++;
      this.inFlight.set(item.key, item);

      void (async () => {
        try {
          if (!item.canceled && !item.controller.signal.aborted) {
            await item.primaryRun(item.controller.signal);

            if (!item.canceled && !item.controller.signal.aborted) {
              for (const sub of Array.from(item.subscribers.values())) {
                try {
                  sub.onComplete?.();
                } catch (e) {
                  console.error(`[imageQueue] Task ${item.key} onComplete error:`, e);
                }
              }
            }
          }
        } catch (err) {
          if (!item.controller.signal.aborted) {
            console.warn(`[imageQueue] Task ${item.key} failed:`, err);
            for (const sub of Array.from(item.subscribers.values())) {
              try {
                sub.onError?.(err);
              } catch (e) {
                console.error(`[imageQueue] Task ${item.key} onError error:`, e);
              }
            }
          }
        } finally {
          this.activeCount = Math.max(0, this.activeCount - 1);
          // Strict identity check prevents an old task from deleting a newer task with the same key
          if (this.inFlight.get(item.key) === item) {
            this.inFlight.delete(item.key);
          }
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
