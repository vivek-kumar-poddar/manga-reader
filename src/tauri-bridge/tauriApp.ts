import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { invokeCommand } from './runtime';
import type {
  AppConfig,
  WindowPreferences,
  DesktopUpdateInfo,
  StorageStats,
  DiagnosticInputPayload,
  DiagnosticRecordPayload,
  SortableSummary,
} from './types';
import type { Page, GeometryOptions, PageOffset, WindowRange, Settings } from '../model';

export function setProgressBar(progress: number): void {
  try {
    void invokeCommand('set_progress_bar', { progress }).catch((err) => {
      console.warn('Tauri setProgressBar failed:', err);
    });
  } catch (err) {
    console.warn('Tauri setProgressBar failed:', err);
  }
}

export async function showMainWindow(): Promise<boolean> {
  try {
    await invokeCommand('show_main_window');
    return true;
  } catch (err) {
    console.warn('Tauri showMainWindow failed:', err);
    return false;
  }
}

export async function getAppConfig(): Promise<AppConfig | null> {
  try {
    return await invokeCommand('get_app_config');
  } catch (err) {
    console.warn('Tauri getAppConfig failed:', err);
    return null;
  }
}

export async function saveAppConfig(config: AppConfig): Promise<boolean> {
  try {
    await invokeCommand('save_app_config', { config });
    return true;
  } catch (err) {
    console.warn('Tauri saveAppConfig failed:', err);
    return false;
  }
}

export async function setWindowPreferences(preferences: WindowPreferences): Promise<boolean> {
  try {
    await invokeCommand('set_window_preferences', { preferences });
    return true;
  } catch (err) {
    console.warn('Tauri setWindowPreferences failed:', err);
    return false;
  }
}

export async function setAppPreference(key: string, value: unknown): Promise<boolean> {
  try {
    await invokeCommand('set_app_preference', { key, value });
    return true;
  } catch (err) {
    console.warn('Tauri setAppPreference failed:', key, err);
    return false;
  }
}

export async function getAppPreference(key: string): Promise<unknown> {
  try {
    return await invokeCommand('get_app_preference', { key });
  } catch (err) {
    console.warn('Tauri getAppPreference failed:', key, err);
    return null;
  }
}

export async function recordOpenedRoot(rootPath: string): Promise<string[]> {
  try {
    return await invokeCommand('record_opened_root', { rootPath });
  } catch (err) {
    console.warn('Tauri recordOpenedRoot failed for', rootPath, err);
    return [];
  }
}

export async function getLastOpenedRoots(): Promise<string[]> {
  try {
    return await invokeCommand('get_last_opened_roots');
  } catch (err) {
    console.warn('Tauri getLastOpenedRoots failed:', err);
    return [];
  }
}

export function onDragDrop(callback: (paths: string[]) => void): () => void {
  if (typeof window === 'undefined') {
    return () => { };
  }
  let unlistenNative: (() => void) | undefined;
  let unlistenTauri: (() => void) | undefined;
  let active = true;

  if (typeof (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ !== 'object') {
    (window as any).__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: () => { },
    };
  }

  void listen<string[]>('native-drag-drop', (event) => {
    if (!active) return;
    const paths = event.payload;
    if (Array.isArray(paths) && paths.length > 0) {
      callback(paths);
    }
  })
    .then((un) => {
      if (!active) {
        try {
          void un();
        } catch { }
      } else {
        unlistenNative = un;
      }
    })
    .catch(() => { });

  void listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
    if (!active) return;
    const paths = event.payload?.paths;
    if (Array.isArray(paths) && paths.length > 0) {
      callback(paths);
    }
  })
    .then((un) => {
      if (!active) {
        try {
          void un();
        } catch { }
      } else {
        unlistenTauri = un;
      }
    })
    .catch(() => { });

  return () => {
    active = false;
    try {
      unlistenNative?.();
    } catch { }
    try {
      unlistenTauri?.();
    } catch { }
  };
}

export async function checkForUpdate(): Promise<DesktopUpdateInfo | null> {
  try {
    return await invoke<DesktopUpdateInfo | null>('plugin:updater|check');
  } catch (err) {
    console.warn('Tauri updater check failed:', err);
    throw err;
  }
}

export async function installUpdate(): Promise<void> {
  try {
    await invoke('plugin:updater|download_and_install');
  } catch (err) {
    console.error('Failed to install desktop update:', err);
    throw err;
  }
}

export async function getStorageStats(): Promise<StorageStats> {
  return invokeCommand('get_storage_stats', {});
}

export async function saveFileDialog(defaultName: string, content: string): Promise<boolean> {
  return invokeCommand('save_file_dialog', { defaultName, content });
}

export async function recordDiagnostic(
  entry: DiagnosticInputPayload,
): Promise<DiagnosticRecordPayload | null> {
  try {
    return await invokeCommand('record_diagnostic', { entry });
  } catch {
    return null;
  }
}

export async function getDiagnostics(): Promise<DiagnosticRecordPayload[]> {
  try {
    return await invokeCommand('get_diagnostics');
  } catch {
    return [];
  }
}

export async function clearDiagnostics(): Promise<void> {
  try {
    await invokeCommand('clear_diagnostics');
  } catch { }
}

export async function sanitizeDiagnosticIdentifier(raw?: string): Promise<string | undefined> {
  try {
    const res = await invokeCommand('sanitize_diagnostic_identifier', { raw });
    return res ?? undefined;
  } catch {
    return undefined;
  }
}

export async function computeOffsets(
  pages: Array<Pick<Page, 'width' | 'height'>>,
  options: GeometryOptions,
  measuredHeights?: Record<number, number>,
): Promise<PageOffset[]> {
  return invokeCommand('compute_offsets', {
    pages: pages.map((p) => ({ width: p.width, height: p.height })),
    options,
    measuredHeights,
  });
}

export async function getWindowRange(
  offsets: PageOffset[],
  scrollY: number,
  viewportHeight: number,
  bufferScreenCount?: number,
  threshold?: number,
): Promise<WindowRange> {
  return invokeCommand('get_window_range', {
    offsets,
    scrollY,
    viewportHeight,
    bufferScreenCount,
    threshold,
  });
}

export async function sortLibraryEntries(
  entries: SortableSummary[],
  shelfSort?: Settings['shelfSort'],
): Promise<string[]> {
  try {
    const res = await invokeCommand('sort_library_entries', {
      entries,
      shelfSort,
    });
    return Array.isArray(res) ? res : entries.map((e) => e.id);
  } catch (err) {
    console.warn('Tauri sortLibraryEntries failed, falling back to identity order:', err);
    return entries.map((e) => e.id);
  }
}
