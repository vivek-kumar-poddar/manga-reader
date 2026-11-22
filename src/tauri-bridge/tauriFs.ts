import { listen } from '@tauri-apps/api/event';
import { convertFileSrc as tauriConvertFileSrc } from '@tauri-apps/api/core';
import { invokeCommand, isTauri } from './runtime';
import { parseFsError } from './errors';
import type { FolderEntry, ListFolderOptions, LibraryDiscovery, ScanProgress } from './types';

export async function selectFolder(): Promise<string | null> {
  try {
    const selected = await invokeCommand('select_folder');
    return selected ?? null;
  } catch (err) {
    console.error('Tauri selectFolder failed:', parseFsError(err) ?? err);
    return null;
  }
}

export async function listFolder(
  folderPath: string,
  options?: ListFolderOptions,
): Promise<FolderEntry[]> {
  let unlisten: (() => void) | undefined;
  const scanId =
    options?.scanId ??
    (options?.signal || options?.onProgress
      ? `scan-${Math.random().toString(36).slice(2)}`
      : undefined);

  let abortHandler: (() => void) | undefined;
  if (options?.signal && scanId) {
    if (options.signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    abortHandler = () => {
      void cancelScan(scanId);
    };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    if (options?.onProgress && isTauri) {
      try {
        unlisten = await listen<ScanProgress>('scan-progress', (event) => {
          if (!scanId || event.payload.scanId === scanId) {
            options.onProgress?.(event.payload);
          }
        });
      } catch (err) {
        console.warn('Tauri scan-progress listen failed:', err);
      }
    }

    return await invokeCommand('list_folder', { folderPath, scanId });
  } catch (err) {
    const fsErr = parseFsError(err);
    if (fsErr?.code === 'Cancelled') {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    console.error('Tauri listFolder failed:', fsErr ?? err);
    return [];
  } finally {
    if (abortHandler && options?.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
    unlisten?.();
  }
}

export async function discoverLibrary(
  folderPath: string,
  options?: ListFolderOptions,
): Promise<LibraryDiscovery | null> {
  let unlisten: (() => void) | undefined;
  const scanId =
    options?.scanId ??
    (options?.signal || options?.onProgress
      ? `scan-${Math.random().toString(36).slice(2)}`
      : undefined);

  let abortHandler: (() => void) | undefined;
  if (options?.signal && scanId) {
    if (options.signal.aborted) {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    abortHandler = () => {
      void cancelScan(scanId);
    };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  }

  try {
    if (options?.onProgress && isTauri) {
      try {
        unlisten = await listen<ScanProgress>('scan-progress', (event) => {
          if (!scanId || event.payload.scanId === scanId) {
            options.onProgress?.(event.payload);
          }
        });
      } catch (err) {
        console.warn('Tauri scan-progress listen failed:', err);
      }
    }

    return await invokeCommand('discover_library', { folderPath, scanId });
  } catch (err) {
    const fsErr = parseFsError(err);
    if (fsErr?.code === 'Cancelled') {
      throw new DOMException('The operation was aborted', 'AbortError');
    }
    console.error('Tauri discoverLibrary failed:', fsErr ?? err);
    return null;
  } finally {
    if (abortHandler && options?.signal) {
      options.signal.removeEventListener('abort', abortHandler);
    }
    unlisten?.();
  }
}

export async function naturalSortPaths(paths: string[]): Promise<string[]> {
  try {
    return await invokeCommand('natural_sort_paths', { paths });
  } catch (err) {
    console.warn('Tauri naturalSortPaths failed:', parseFsError(err) ?? err);
    return paths;
  }
}

export async function resolvePath(
  mangaId?: string,
  relativePath = '',
  localPath?: string,
): Promise<string> {
  return await invokeCommand('resolve_manga_path', { mangaId, relativePath, localPath });
}

export async function checkAccess(mangaId?: string, localPath?: string): Promise<boolean> {
  try {
    return await invokeCommand('check_access', { mangaId, localPath });
  } catch (err) {
    console.warn('Tauri checkAccess failed:', parseFsError(err) ?? err);
    return false;
  }
}

export async function revokeRoot(rootPath: string): Promise<boolean> {
  try {
    return await invokeCommand('revoke_root', { rootPath });
  } catch (err) {
    console.warn('Tauri revokeRoot failed:', parseFsError(err) ?? err);
    return false;
  }
}

export async function getAuthorizedRoots(): Promise<string[]> {
  try {
    return await invokeCommand('get_authorized_roots');
  } catch (err) {
    console.warn('Tauri getAuthorizedRoots failed:', parseFsError(err) ?? err);
    return [];
  }
}

export async function cancelScan(scanId: string): Promise<boolean> {
  try {
    return await invokeCommand('cancel_scan', { scanId });
  } catch (err) {
    console.warn('Tauri cancelScan failed for', scanId, err);
    return false;
  }
}

export async function readFile(absolutePath: string): Promise<ArrayBuffer | null> {
  try {
    const response = await invokeCommand('read_file', {
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
    return null;
  } catch (err) {
    console.error('Tauri readFile failed for', absolutePath, parseFsError(err) ?? err);
    return null;
  }
}

export async function isSamePath(pathA: string, pathB: string): Promise<boolean> {
  try {
    return await invokeCommand('is_same_path', { pathA, pathB });
  } catch {
    return (
      pathA.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
      pathB.trim().replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    );
  }
}

export function convertFileSrc(filePath: string, protocol = 'mangaimg'): string {
  if (typeof tauriConvertFileSrc === 'function' && isTauri) {
    try {
      return tauriConvertFileSrc(filePath, protocol);
    } catch {
      // fallback below
    }
  }
  const normalized = filePath.replace(/\\/g, '/');
  const isWindowsDrive = /^([a-zA-Z]):/.test(normalized);
  const drivePrefix = isWindowsDrive ? normalized.slice(0, 1) + '%3A' : '';
  const rest = isWindowsDrive
    ? normalized.slice(2).replace(/^\/+/, '')
    : normalized.replace(/^\/+/, '');
  const segments = rest.split('/').filter(Boolean);
  const encoded = segments.map((s) => encodeURIComponent(s)).join('/');
  const cleanPath = drivePrefix ? drivePrefix + '/' + encoded : encoded;
  return `http://${protocol}.localhost/${cleanPath}`;
}
