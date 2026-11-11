/// <reference types="vite/client" />

import type { DesktopAPI } from './tauriBridge';

declare global {
  const __DESKTOP_BUILD__: boolean | undefined;

  interface Window {
    __TAURI_INTERNALS__?: unknown;
    desktopAPI?: DesktopAPI;
  }
}
