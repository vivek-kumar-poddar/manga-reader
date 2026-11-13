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

  get(key: string): string | undefined {
    const entry = this.entries.get(key);
    if (!entry || !entry.inCache) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.url;
  }

  retain(key: string): () => void {
    const entry = this.entries.get(key);
    if (!entry) return () => { };
    entry.refCount++;
    let done = false;
    return () => {
      if (done) return;
      done = true;
      entry.refCount = Math.max(0, entry.refCount - 1);
      if (!entry.inCache && entry.refCount <= 0) {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        try {
          URL.revokeObjectURL(entry.url);
        } catch { }
      }
    };
  }

  release(key: string): void {
    const entry = this.entries.get(key);
    if (!entry) return;
    entry.refCount = Math.max(0, entry.refCount - 1);
    if (!entry.inCache && entry.refCount <= 0) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      try {
        URL.revokeObjectURL(entry.url);
      } catch { }
    }
  }

  set(key: string, url: string): void {
    const existing = this.entries.get(key);
    if (existing) {
      this.entries.delete(key);
      if (existing.url !== url) {
        existing.inCache = false;
        if (existing.refCount <= 0) {
          try {
            URL.revokeObjectURL(existing.url);
          } catch { }
        }
      } else {
        existing.inCache = true;
        this.entries.set(key, existing);
        return;
      }
    } else if (this.size >= this.maxEntries) {
      for (const [oldKey, oldEntry] of this.entries.entries()) {
        if (oldEntry.inCache) {
          oldEntry.inCache = false;
          if (oldEntry.refCount <= 0) {
            this.entries.delete(oldKey);
            try {
              URL.revokeObjectURL(oldEntry.url);
            } catch { }
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

  revoke(key: string): void {
    const entry = this.entries.get(key);
    if (entry) {
      entry.inCache = false;
      if (entry.refCount <= 0) {
        this.entries.delete(key);
        try {
          URL.revokeObjectURL(entry.url);
        } catch { }
      }
    }
  }

  clear(): void {
    for (const [key, entry] of Array.from(this.entries.entries())) {
      entry.inCache = false;
      if (entry.refCount <= 0) {
        this.entries.delete(key);
        try {
          URL.revokeObjectURL(entry.url);
        } catch { }
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