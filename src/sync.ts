export type MangaDeleteListener = (id?: string) => void;

var _deleteListeners: MangaDeleteListener[] | undefined;
function getDeleteListeners(): MangaDeleteListener[] {
  return (_deleteListeners ??= []);
}

export function onMangaDelete(listener: MangaDeleteListener): () => void {
  const listeners = getDeleteListeners();
  listeners.push(listener);
  return () => {
    const list = getDeleteListeners();
    const idx = list.indexOf(listener);
    if (idx >= 0) list.splice(idx, 1);
  };
}

export function notifyDelete(id?: string): void {
  for (const listener of getDeleteListeners()) {
    try {
      listener(id);
    } catch {
      // Ignore listener errors during cleanup
    }
  }
}

export interface StorageSyncMessage {
  type: 'library' | 'progress';
  id?: string;
}

export const syncChannel =
  typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('manga-reader:sync') : null;

var _localSyncListeners: Set<(msg: StorageSyncMessage) => void> | undefined;
function getLocalSyncListeners(): Set<(msg: StorageSyncMessage) => void> {
  return (_localSyncListeners ??= new Set());
}

export function onStorageSync(listener: (msg: StorageSyncMessage) => void): () => void {
  const listeners = getLocalSyncListeners();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function broadcastSync(msg: StorageSyncMessage): void {
  for (const listener of getLocalSyncListeners()) {
    try {
      listener(msg);
    } catch (e) {
      console.warn('Error in local storage sync listener:', e);
    }
  }

  if (syncChannel && typeof MessageEvent !== 'undefined') {
    try {
      syncChannel.dispatchEvent(new MessageEvent('message', { data: msg }));
    } catch {
      // Ignore dispatch failure
    }
  }

  try {
    syncChannel?.postMessage(msg);
  } catch {
    // Ignore postMessage failure
  }
}

export type SaveProgressResult = 'saved' | 'stale' | 'missing';
