/**
 * Bounded LRU Object URL Pool.
 *
 * Keeps a small bounded cache of recent object URLs in memory so rapid scroll-back
 * avoids re-reading blobs across IPC or re-decoding pixels in the browser.
 * Evicts least-recently-used entries and revokes their URLs to prevent memory leaks.
 */

export class ObjectUrlPool {
  private cache = new Map<string, string>();
  private readonly maxEntries: number;

  constructor(maxEntries = 32) {
    this.maxEntries = Math.max(1, maxEntries);
  }

  get size(): number {
    return this.cache.size;
  }

  /**
   * Retrieves a cached object URL, moving it to the most-recently-used position.
   */
  get(key: string): string | undefined {
    const url = this.cache.get(key);
    if (!url) return undefined;

    // Refresh LRU order (delete and re-append)
    this.cache.delete(key);
    this.cache.set(key, url);
    return url;
  }

  /**
   * Stores an object URL. If capacity is exceeded, revokes and evicts the oldest entry.
   */
  set(key: string, url: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    } else if (this.cache.size >= this.maxEntries) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        const oldestUrl = this.cache.get(oldestKey);
        this.cache.delete(oldestKey);
        if (oldestUrl) {
          try {
            URL.revokeObjectURL(oldestUrl);
          } catch {
            /* Ignore revocation errors */
          }
        }
      }
    }
    this.cache.set(key, url);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  /**
   * Explicitly revokes and removes a single cached URL.
   */
  revoke(key: string): void {
    const url = this.cache.get(key);
    if (url) {
      this.cache.delete(key);
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* Ignore revocation errors */
      }
    }
  }

  /**
   * Revokes all cached object URLs and empties the pool.
   * Call on chapter changes, title switches, or unmount.
   */
  clear(): void {
    for (const url of this.cache.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* Ignore revocation errors */
      }
    }
    this.cache.clear();
  }
}

export const defaultObjectUrlPool = new ObjectUrlPool(32);

export function getObjectUrl(key: string): string | undefined {
  return defaultObjectUrlPool.get(key);
}

export function storeObjectUrl(key: string, url: string): void {
  defaultObjectUrlPool.set(key, url);
}

export function clearObjectUrlPool(): void {
  defaultObjectUrlPool.clear();
}
