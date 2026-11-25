import type { RefObject } from 'react';
import { Download, Upload, RefreshCw } from 'lucide-react';
import { desktopAPI, type StorageStats } from '../tauriBridge';
import type { Summary } from '../model';
import { formatBytes } from './types';

interface StorageTabProps {
  nativeStats: StorageStats | null;
  usage: StorageEstimate | null;
  library: Summary[];
  storageError: string;
  updateStorage: () => Promise<void>;
  exportData: () => Promise<void>;
  importData: (file?: File) => Promise<void>;
  clear: () => Promise<void>;
  confirmAction: 'progress' | 'all' | null;
  setConfirmAction: (action: 'progress' | 'all' | null) => void;
  clearing: boolean;
  notify: (msg: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export default function StorageTab({
  nativeStats,
  usage,
  library,
  storageError,
  updateStorage,
  exportData,
  importData,
  clear,
  confirmAction,
  setConfirmAction,
  clearing,
  notify,
  inputRef,
}: StorageTabProps) {
  return (
    <>
      <section>
        <h3>On this device</h3>
        <dl className="storage-stats">
          {nativeStats ? (
            <>
              <div>
                <dt>Total storage used</dt>
                <dd>{formatBytes(nativeStats.total_bytes)}</dd>
              </div>
              <div>
                <dt>Database size</dt>
                <dd>{formatBytes(nativeStats.db_bytes)}</dd>
              </div>
              <div>
                <dt>Thumbnail & variant cache</dt>
                <dd>{formatBytes(nativeStats.cache_bytes)}</dd>
              </div>
            </>
          ) : (
            <>
              <div>
                <dt>Storage used</dt>
                <dd>{usage?.usage !== undefined ? formatBytes(usage.usage) : 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Estimated quota</dt>
                <dd>{usage?.quota !== undefined ? formatBytes(usage.quota) : 'Unavailable'}</dd>
              </div>
            </>
          )}
          <div>
            <dt>Library</dt>
            <dd>
              {library.length} titles · {library.reduce((n, m) => n + m.chapterCount, 0)} chapters
            </dd>
          </div>
        </dl>
        {storageError && <p role="status">{storageError}</p>}
        <div className="setting-row setting-row-actions">
          <div className="setting-info">
            <p className="subtle setting-desc">
              {nativeStats
                ? 'Reflects the local database and cached thumbnails. Manga folders remain untouched.'
                : 'Estimates database and cache usage only; manga folders stay in their original locations.'}
            </p>
          </div>
          <div className="setting-control">
            <div className="button-row">
              <button className="btn secondary" onClick={() => void updateStorage()}>
                <RefreshCw size={16} /> Refresh details
              </button>
            </div>
          </div>
        </div>
      </section>
      <section>
        <h3>What is saved?</h3>
        <ul className="storage-notes">
          <li>
            <strong>Database:</strong> titles, chapter lists, page dimensions, cover previews,
            preferences, progress, and bookmarks.
          </li>
          <li>
            <strong>Disk cache:</strong> generated cover and page previews. Original manga files are
            never copied or modified.
          </li>
          <li>
            <strong>Session memory:</strong> active folder handles and nearby page buffers.
          </li>
        </ul>
        <p className="subtle">Stored locally on this device only (no cloud sync).</p>
      </section>
      <section>
        <h3>Backup &amp; restore</h3>
        <div className="setting-row setting-row-actions">
          <div className="setting-info">
            <p className="subtle setting-desc">
              Saves library metadata, progress, bookmarks, and preferences (no images). Re-link
              folders after restoring on another device.
            </p>
          </div>
          <div className="setting-control">
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={() => void exportData().catch(() => notify('Could not export backup.'))}
              >
                <Download size={16} /> Export metadata
              </button>
              <button className="btn blue" onClick={() => inputRef.current?.click()}>
                <Upload size={16} /> Import backup
              </button>
              <input
                hidden
                ref={inputRef}
                type="file"
                accept="application/json,.json"
                onChange={(e) => {
                  void importData(e.target.files?.[0]);
                  e.target.value = '';
                }}
              />
            </div>
          </div>
        </div>
      </section>
      <section>
        <h3>Clear saved data</h3>
        {confirmAction ? (
          <div
            className="inline-confirm setting-row setting-row-actions"
            role="group"
            aria-label="Confirm data removal"
          >
            <div className="setting-info">
              <p>
                {confirmAction === 'progress'
                  ? 'Reset every saved reading position and read marker?'
                  : desktopAPI.isDesktop
                    ? 'Remove every title, cover preview, and reading position from this application?'
                    : 'Remove every title, cover preview, and reading position from this browser?'}{' '}
                Original files stay untouched.
              </p>
            </div>
            <div className="setting-control">
              <div className="button-row">
                <button className="btn delete" disabled={clearing} onClick={() => void clear()}>
                  {clearing ? 'Clearing…' : 'Confirm clear'}
                </button>
                <button
                  className="btn secondary"
                  disabled={clearing}
                  onClick={() => setConfirmAction(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="setting-row setting-row-actions">
            <div className="setting-info">
              <p className="subtle setting-desc">
                Original manga files are never modified. Your preferences stay intact.
              </p>
            </div>
            <div className="setting-control">
              <div className="button-row">
                <button className="btn delete" onClick={() => setConfirmAction('progress')}>
                  Clear reading progress
                </button>
                <button
                  className="btn delete"
                  onClick={async () => {
                    if (desktopAPI.isDesktop && desktopAPI.clearThumbnails) {
                      await desktopAPI.clearThumbnails();
                      await updateStorage();
                      notify('Thumbnail cache cleared.');
                    } else {
                      notify('Thumbnail cache is managed by your browser storage.');
                    }
                  }}
                >
                  Clear thumbnail cache
                </button>
                <button className="btn delete" onClick={() => setConfirmAction('all')}>
                  Clear all manga data
                </button>
              </div>
            </div>
          </div>
        )}
      </section>
      <section>
        <h3>Diagnostics</h3>
        <div className="setting-row setting-row-actions">
          <div className="setting-info">
            <p className="subtle setting-desc">
              Saves up to 50 recent diagnostic events for troubleshooting without private file data.
            </p>
          </div>
          <div className="setting-control">
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={async () => {
                  const logs = (await desktopAPI.getDiagnostics?.()) ?? [];
                  if (!logs.length) {
                    notify('No diagnostic entries recorded.');
                    return;
                  }
                  const text = logs
                    .map(
                      (d) =>
                        `[${new Date(d.timestamp).toISOString()}] [${d.level.toUpperCase()}] [${d.operation}] ${d.code ? `(${d.code}) ` : ''}${d.safeIdentifier ? `[${d.safeIdentifier}] ` : ''}${d.message}${d.durationMs ? ` (${d.durationMs}ms)` : ''}`,
                    )
                    .join('\n');
                  if (desktopAPI.isDesktop && desktopAPI.saveFileDialog) {
                    const saved = await desktopAPI.saveFileDialog(
                      'manga-reader-diagnostics.txt',
                      text,
                    );
                    if (saved) {
                      notify('Diagnostic log saved.');
                    }
                    return;
                  }
                  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'manga-reader-diagnostics.txt';
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Download size={16} /> Export diagnostic log
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
