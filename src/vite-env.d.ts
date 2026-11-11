/// <reference types="vite/client" />

import type { DesktopAPI } from './tauriBridge';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
    desktopAPI?: DesktopAPI;
  }
}
