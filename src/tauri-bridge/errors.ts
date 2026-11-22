import type { FsErrorPayload, DbErrorPayload, TauriErrorPayload } from './types';

export function parseFsError(err: unknown): FsErrorPayload | null {
  if (err && typeof err === 'object') {
    if ('code' in err && typeof (err as any).code === 'string') {
      return err as FsErrorPayload;
    }
  }
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        return parsed as FsErrorPayload;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

export function parseTauriError(err: unknown): TauriErrorPayload {
  const fsErr = parseFsError(err);
  if (fsErr) return fsErr;
  if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'string') {
    return err as DbErrorPayload;
  }
  if (typeof err === 'string') {
    try {
      const parsed = JSON.parse(err);
      if (parsed && typeof parsed === 'object' && 'code' in parsed) {
        return parsed as DbErrorPayload;
      }
    } catch {
      // not JSON
    }
    return { code: 'Unknown', message: err };
  }
  if (err instanceof Error) {
    return { code: 'Unknown', message: err.message };
  }
  return { code: 'Unknown', message: String(err) };
}
