import { invoke } from '@tauri-apps/api/core';

export interface FolderEntry {
  relativePath: string;
  absolutePath: string;
  size: number;
  modified: number;
}

export interface DesktopAPI {
  readonly isDesktop: boolean;
  readonly isTauri: boolean;
  selectFolder(): Promise<string | null>;
  listFolder(folderPath: string): Promise<FolderEntry[]>;
  readFile(absolutePath: string): Promise<ArrayBuffer | null>;
  setProgressBar(progress: number): void;
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

  setProgressBar(progress: number): void {
    try {
      void invoke('set_progress_bar', { progress });
    } catch (err) {
      console.warn('Tauri setProgressBar failed:', err);
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

  setProgressBar(progress: number): void {
    this.api?.setProgressBar(progress);
  }
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

  setProgressBar(): void {}
}

export const desktopAPI: DesktopAPI = isTauri
  ? new TauriDesktopBridge()
  : isLegacyElectron
    ? new LegacyElectronDesktopBridge()
    : new WebDesktopBridge();
