/// <reference types="vite/client" />

import type { DesktopAPI } from './tauriBridge';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    desktopAPI?: DesktopAPI;
    electronAPI?: {
      isElectron: boolean;
      selectFolder(): Promise<string | null>;
      listFolder(
        folderPath: string,
      ): Promise<{ relativePath: string; absolutePath: string; size: number; modified: number }[]>;
      readFile(absolutePath: string): Promise<ArrayBuffer | null>;
      setProgressBar(progress: number): void;
    };
  }
}
