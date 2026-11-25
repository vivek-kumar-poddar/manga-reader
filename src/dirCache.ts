export interface AccessCacheEntry {
  granted: boolean;
  timestamp: number;
  expiresAt: number;
}

export const ACCESS_CACHE_TTL_MS = 7500;
export const dirHandleCache = new Map<string, any>();
export const accessCache = new Map<string, AccessCacheEntry>();
export const accessInFlight = new Map<string, Promise<boolean>>();

export function clearAccessCache(mangaId?: string): void {
  if (mangaId) {
    accessCache.delete(mangaId);
    accessInFlight.delete(mangaId);
  } else {
    accessCache.clear();
    accessInFlight.clear();
  }
}

export function clearDirHandleCache(mangaId?: string): void {
  clearAccessCache(mangaId);
  if (mangaId) {
    const prefix = `${mangaId}:`;
    for (const key of dirHandleCache.keys()) {
      if (key.startsWith(prefix)) {
        dirHandleCache.delete(key);
      }
    }
  } else {
    dirHandleCache.clear();
  }
}
