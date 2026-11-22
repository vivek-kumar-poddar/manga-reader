import { invoke } from '@tauri-apps/api/core';
import type { TauriCommands } from './types';
import { parseTauriError } from './errors';

// Detect Tauri runtime presence
export const isTauri =
  typeof window !== 'undefined' &&
  (Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) ||
    Boolean((window as unknown as { __TAURI__?: unknown }).__TAURI__));

export const isDesktop =
  (typeof __DESKTOP_BUILD__ !== 'undefined' && __DESKTOP_BUILD__) ||
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_TARGET === 'desktop') ||
  isTauri;

export async function invokeCommand<K extends keyof TauriCommands>(
  cmd: K,
  args?: TauriCommands[K]['args'],
  options?: any,
): Promise<TauriCommands[K]['return']> {
  try {
    return await invoke<TauriCommands[K]['return']>(cmd, args as any, options);
  } catch (err) {
    const parsed = parseTauriError(err);
    console.error(`[invokeCommand] ${cmd} failed:`, parsed);
    throw parsed;
  }
}
