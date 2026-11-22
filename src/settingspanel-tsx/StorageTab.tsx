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
              {library.length} titles · {library.reduce((n, m) => n + m.chapterCount, 0)}{' '}
              chapters
            </dd>
          </div>
        </dl>
        {storageError && <p role="status">{storageError}</p>}
        <p className="subtle">
          {nativeStats
            ? 'These statistics reflect your local SQLite database and cached thumbnails on disk. Manga files remain in their original folders.'
            : 'These estimates cover the application database and cached thumbnails, not the size of your manga folders. Quota is an estimate, not reserved disk space.'}
        </p>
        <div className="button-row">
          <button className="btn secondary" onClick={() => void updateStorage()}>
            <RefreshCw size={16} /> Refresh details
          </button>
        </div>
      </section>
      <section>
        <h3>What is saved?</h3>
        <ul className="storage-notes">
          <li>
            <strong>In the database:</strong> titles, chapter and page lists, image
            dimensions, small cover previews, preferences, and supported folder handles.
            Reading progress and bookmarks are saved separately in small updates.
          </li>
          <li>
            <strong>In the thumbnail cache:</strong> cover art and generated previews
            stored on disk. Original manga pages are not copied into this cache.
          </li>
          <li>
            <strong>In temporary memory:</strong> selected files and nearby page previews.
            Standard folder selection needs re-linking after a reload.
          </li>
        </ul>
        <p className="subtle">
          Data belongs to this device installation. It does not sync across devices. Manga
          files remain in their original folders.
        </p>
      </section>
      <section>
        <h3>Backup & restore</h3>
        <div className="button-row">
          <button
            className="btn secondary"
            onClick={() =>
              void exportData().catch(() => notify('Could not export backup.'))
            }
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
        <p className="subtle">
          JSON backups include library metadata, progress, and preferences and
          bookmarks—not manga images, covers, or folder permissions. Import adds missing
          titles and replaces matching titles’ metadata. Re-link the original folders on
          another device.
        </p>
      </section>
      <section>
        <h3>Clear saved data</h3>
        {confirmAction ? (
          <div className="inline-confirm" role="group" aria-label="Confirm data removal">
            <p>
              {confirmAction === 'progress'
                ? 'Reset every saved reading position and read marker?'
                : desktopAPI.isDesktop
                  ? 'Remove every title, cover preview, and reading position from this application?'
                  : 'Remove every title, cover preview, and reading position from this browser?'}{' '}
              Original files stay untouched.
            </p>
            <div className="button-row">
              <button
                className="btn delete"
                disabled={clearing}
                onClick={() => void clear()}
              >
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
        ) : (
          <div className="button-row">
            <button className="btn delete" onClick={() => setConfirmAction('progress')}>
              Clear reading progress
            </button>
            <button className="btn delete" onClick={() => setConfirmAction('all')}>
              Clear all manga data
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
          </div>
        )}
        <p className="subtle">
          These actions leave your settings and thumbnail cache in place.
        </p>
      </section>
      <section>
        <h3>Diagnostics</h3>
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
        <p className="subtle">
          Keeps a bounded log of the last 50 operation events for troubleshooting without
          retaining private files.
        </p>
      </section>
    </>
  );
}
