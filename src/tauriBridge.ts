import { invoke } from '@tauri-apps/api/core';

export interface FolderEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  modified: number;
  width?: number | null;
  height?: number | null;
}

export interface DesktopAPI {
  readonly isDesktop: boolean;
  readonly isTauri: boolean;
  selectFolder(): Promise<string | null>;
  listFolder(folderPath: string): Promise<FolderEntry[]>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
  getImageDimensions?(absolutePath: string): Promise<{ width: number; height: number } | null>;
  setProgressBar(progress: number): void;
  saveThumbnail?(id: string, buffer: ArrayBuffer | Uint8Array): Promise<boolean>;
  getThumbnail?(id: string): Promise<ArrayBuffer | null>;
  deleteThumbnail?(id: string): Promise<void>;
  clearThumbnails?(): Promise<void>;
}

// Detect Tauri runtime presence
export const isTauri =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));

// Backward compatibility with legacy Electron detection while both are supported
export const isLegacyElectron =
  typeof window !== 'undefined' &&
  Boolean(
    (window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron,
  );

export const isDesktop = isTauri || isLegacyElectron;

class TauriDesktopBridge implements DesktopAPI {
  readonly isDesktop = true;
  readonly isTauri = true;

  async selectFolder(): Promise<string | null> {
    try {
      const selected = await invoke<string | null>('select_folder');
      return selected ?? null;
    } catch (err) {
      console.error('Tauri selectFolder failed:', err);
      return null;
    }
  }

  async listFolder(folderPath: string): Promise<FolderEntry[]> {
    try {
      return await invoke<FolderEntry[]>('list_folder', { folderPath });
    } catch (err) {
      console.error('Tauri listFolder failed:', err);
      return [];
    }
  }

  async readFile(absolutePath: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer | number[]>('read_file', {
        absolutePath,
      });
      if (response instanceof ArrayBuffer) {
        return response;
      }
      if (response instanceof Uint8Array) {
        return response.buffer.slice(
          response.byteOffset,
          response.byteOffset + response.byteLength,
        ) as ArrayBuffer;
      }
      if (Array.isArray(response)) {
        return new Uint8Array(response).buffer as ArrayBuffer;
      }
      return null;
    } catch (err) {
      console.error('Tauri readFile failed for', absolutePath, err);
      return null;
    }
  }

  async getImageDimensions(
    absolutePath: string,
  ): Promise<{ width: number; height: number } | null> {
    try {
      const dim = await invoke<[number, number] | null>('get_image_dimensions', {
        absolutePath,
      });
      if (dim && Array.isArray(dim) && dim.length === 2) {
        return { width: dim[0], height: dim[1] };
      }
      return null;
    } catch (err) {
      console.warn('Tauri getImageDimensions failed for', absolutePath, err);
      return null;
    }
  }

  setProgressBar(progress: number): void {
    try {
      void invoke('set_progress_bar', { progress });
    } catch (err) {
      console.warn('Tauri setProgressBar failed:', err);
    }
  }

  async saveThumbnail(id: string, buffer: ArrayBuffer | Uint8Array): Promise<boolean> {
    try {
      const bytes =
        buffer instanceof Uint8Array ? Array.from(buffer) : Array.from(new Uint8Array(buffer));
      await invoke('save_thumbnail', { id, bytes });
      return true;
    } catch (err) {
      console.warn('Tauri saveThumbnail failed for', id, err);
      return false;
    }
  }

  async getThumbnail(id: string): Promise<ArrayBuffer | null> {
    try {
      const response = await invoke<Uint8Array | ArrayBuffer | number[]>('read_thumbnail', { id });
      if (response instanceof ArrayBuffer) {
        return response.byteLength > 0 ? response : null;
      }
      if (response instanceof Uint8Array) {
        return response.byteLength > 0
          ? (response.buffer.slice(
              response.byteOffset,
              response.byteOffset + response.byteLength,
            ) as ArrayBuffer)
          : null;
      }
      if (Array.isArray(response) && response.length > 0) {
        return new Uint8Array(response).buffer as ArrayBuffer;
      }
      return null;
    } catch (err) {
      console.warn('Tauri getThumbnail failed for', id, err);
      return null;
    }
  }

  async deleteThumbnail(id: string): Promise<void> {
    try {
      await invoke('delete_thumbnail', { id });
    } catch (err) {
      console.warn('Tauri deleteThumbnail failed for', id, err);
    }
  }

  async clearThumbnails(): Promise<void> {
    try {
      await invoke('clear_thumbnails');
    } catch (err) {
      console.warn('Tauri clearThumbnails failed:', err);
    }
  }
}

class LegacyElectronDesktopBridge implements DesktopAPI {
  readonly isDesktop = true;
  readonly isTauri = false;

  private get api() {
    return (window as unknown as { electronAPI?: DesktopAPI }).electronAPI;
  }

  async selectFolder(): Promise<string | null> {
    return this.api?.selectFolder() ?? null;
  }

  async listFolder(folderPath: string): Promise<FolderEntry[]> {
    return this.api?.listFolder(folderPath) ?? [];
  }

  async readFile(absolutePath: string): Promise<ArrayBuffer | null> {
    return this.api?.readFile(absolutePath) ?? null;
  }

  async getImageDimensions(): Promise<{ width: number; height: number } | null> {
    return null;
  }

  setProgressBar(progress: number): void {
    this.api?.setProgressBar(progress);
  }

  async saveThumbnail(): Promise<boolean> {
    return false;
  }

  async getThumbnail(): Promise<ArrayBuffer | null> {
    return null;
  }

  async deleteThumbnail(): Promise<void> {}

  async clearThumbnails(): Promise<void> {}
}

class WebDesktopBridge implements DesktopAPI {
  readonly isDesktop = false;
  readonly isTauri = false;

  async selectFolder(): Promise<string | null> {
    return null;
  }

  async listFolder(): Promise<FolderEntry[]> {
    return [];
  }

  async readFile(): Promise<ArrayBuffer | null> {
    return null;
  }

  async getImageDimensions(): Promise<{ width: number; height: number } | null> {
    return null;
  }

  setProgressBar(): void {}

  async saveThumbnail(): Promise<boolean> {
    return false;
  }

  async getThumbnail(): Promise<ArrayBuffer | null> {
    return null;
  }

  async deleteThumbnail(): Promise<void> {}

  async clearThumbnails(): Promise<void> {}
}

export const desktopAPI: DesktopAPI = isTauri
  ? new TauriDesktopBridge()
  : isLegacyElectron
    ? new LegacyElectronDesktopBridge()
    : new WebDesktopBridge();
