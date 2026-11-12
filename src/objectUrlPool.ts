/**
 * Bounded LRU Object URL Pool with Consumer Reference Counting / Pinning.
 *
 * Keeps a bounded cache of recent object URLs in memory so rapid scroll-back
 * avoids re-reading blobs across IPC or re-decoding pixels in the browser.
 * Evicts least-recently-used entries and revokes URLs only when both the cache
 * and mounted consumers have released the resource.
 */

interface PoolEntry {
  url: string;
  refCount: number;
  inCache: boolean;
}

export class ObjectUrlPool {
  private entries = new Map<string, PoolEntry>();
  private readonly maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (entry.inCache) count++;
    }
    return count;
  }

  get totalAllocated(): number {
    return this.entries.size;
  }

  /**
   * Retrieves a cached object URL, moving it to the most-recently-used position.
   */
  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || !entry.inCache) return undefined;

    // Refresh LRU order (delete and re-append in insertion-ordered Map)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.url;
  }

  /**
   * Pins/retains a resource so it is not revoked while mounted in a consumer.
   * Returns a release function that must be called when the consumer unmounts.
   */
  retain(key: string): () => void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.refCount++;
    }
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.release(key);
    };
  }

  /**
   * Decrements consumer reference count for a key. If the resource was already evicted
   * from the cache and no consumers remain, revokes the URL immediately.
   */
  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (!entry.inCache && entry.refCount <= 0) {
      this.entries.delete(key);
      try {
        URL.revokeObjectURL(entry.url);
      } catch {
        /* Ignore revocation errors */
      }
    }
  }

  /**
   * Stores an object URL. If key already exists with a different URL, revokes the old URL.
   * If capacity is exceeded, evicts the oldest entry from the cache.
   */
  set(key: string, url: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      if (existing.url !== url) {
        existing.inCache = false;
        if (existing.refCount <= 0) {
          try {
            URL.revokeObjectURL(existing.url);
          } catch {
            /* Ignore revocation errors */
          }
        }
      } else {
        // Re-insert existing entry at MRU position
        existing.inCache = true;
        this.entries.set(key, existing);
        return;
      }
    } else if (this.size >= this.maxEntries) {
      // Find oldest entry in cache
      for (const [oldKey, oldEntry] of this.entries.entries()) {
        if (oldEntry.inCache) {
          oldEntry.inCache = false;
          if (oldEntry.refCount <= 0) {
            this.entries.delete(oldKey);
            try {
              URL.revokeObjectURL(oldEntry.url);
            } catch {
              /* Ignore revocation errors */
            }
          }
          break;
        }
      }
    }

    this.entries.set(key, {
      url,
      refCount: 0,
      inCache: true,
    });
  }

  has(key: string): boolean {
    const entry = this.entries.get(key);
    return Boolean(entry && entry.inCache);
  }

  /**
   * Explicitly evicts and revokes a single cached URL.
   */
  revoke(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.inCache = false;
      if (entry.refCount <= 0) {
        this.entries.delete(key);
        try {
          URL.revokeObjectURL(entry.url);
        } catch {
          /* Ignore revocation errors */
        }
      }
    }
  }

  /**
   * Evicts all entries from cache.
   * Unpinned URLs are revoked immediately. Pinned URLs are revoked once released.
   */
  clear(): void {
    for (const [key, entry] of Array.from(this.entries.entries())) {
      entry.inCache = false;
      if (entry.refCount <= 0) {
        this.entries.delete(key);
        try {
          URL.revokeObjectURL(entry.url);
        } catch {
          /* Ignore revocation errors */
        }
      }
    }
  }
}

export function getAdaptivePoolSize(): number {
  if (typeof navigator === 'undefined') return 32;
  const nav = navigator as Navigator & { deviceMemory?: number; hardwareConcurrency?: number };
  const mem = nav.deviceMemory ?? 4;
  const cores = nav.hardwareConcurrency ?? 4;
  if (mem <= 2 || cores <= 2) return 12;
  if (mem <= 4 || cores <= 4) return 24;
  if (mem >= 8 && cores >= 8) return 64;
  return 40;
}

export const defaultObjectUrlPool = new ObjectUrlPool(getAdaptivePoolSize());

export function getObjectUrl(key: string): string | undefined {
  return defaultObjectUrlPool.get(key);
}

export function storeObjectUrl(key: string, url: string): void {
  defaultObjectUrlPool.set(key, url);
}

export function retainObjectUrl(key: string): () => void {
  return defaultObjectUrlPool.retain(key);
}

export function releaseObjectUrl(key: string): void {
  defaultObjectUrlPool.release(key);
}

export function clearObjectUrlPool(): void {
  defaultObjectUrlPool.clear();
}
