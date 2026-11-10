export type DiagnosticLevel = 'info' | 'warn' | 'error';

export interface DiagnosticRecord {
  id: string;
  timestamp: number;
  operation: 'import' | 'cover' | 'background' | 'storage' | 'update' | 'reader';
  level: DiagnosticLevel;
  message: string;
  code?: string;
  safeIdentifier?: string;
  retryable?: boolean;
  durationMs?: number;
}

const MAX_DIAGNOSTICS = 50;
const ringBuffer: DiagnosticRecord[] = [];
const subscribers = new Set<() => void>();

let nextId = 1;

/**
 * Strips potentially sensitive or overly verbose paths, keeping only leaf names.
 */
export function sanitizeIdentifier(raw?: string): string | undefined {
  if (!raw) return undefined;
  const normalized = raw.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.slice(-2).join('/');
}

export function recordDiagnostic(
  entry: Omit<DiagnosticRecord, 'id' | 'timestamp'>,
): DiagnosticRecord | null {
  // Silent on expected user cancellation or aborts
  if (
    entry.code === 'AbortError' ||
    entry.message.includes('Import cancelled') ||
    entry.message.includes('aborted')
  ) {
    return null;
  }

  const now = Date.now();

  // Deduplicate rapid repeat diagnostics (within 2000ms) with identical op, level, and message
  const recent = ringBuffer[ringBuffer.length - 1];
  if (
    recent &&
    recent.operation === entry.operation &&
    recent.level === entry.level &&
    recent.message === entry.message &&
    now - recent.timestamp < 2000
  ) {
    return recent;
  }

  const record: DiagnosticRecord = {
    id: `diag-${nextId++}`,
    timestamp: now,
    ...entry,
    safeIdentifier: sanitizeIdentifier(entry.safeIdentifier),
  };

  ringBuffer.push(record);
  if (ringBuffer.length > MAX_DIAGNOSTICS) {
    ringBuffer.shift();
  }

  for (const listener of subscribers) {
    try {
      listener();
    } catch {
      // Ignore listener error
    }
  }

  return record;
}

export function getDiagnostics(): DiagnosticRecord[] {
  return [...ringBuffer];
}

export function clearDiagnostics(): void {
  ringBuffer.length = 0;
  for (const listener of subscribers) {
    try {
      listener();
    } catch {}
  }
}

export function subscribeDiagnostics(listener: () => void): () => void {
  subscribers.add(listener);
  return () => {
    subscribers.delete(listener);
  };
}
