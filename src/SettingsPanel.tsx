import Dropdown from './Dropdown';
import { useState, useEffect, useRef } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Download, Upload, RefreshCw } from 'lucide-react';
import { useApp } from './App';
import { APP_VERSION } from './updates';
import { limits, assertAtMost, withinTime } from './limits';
import { getDiagnostics } from './diagnostics';
import { desktopAPI } from './tauriBridge';
import {
  allManga,
  defaults,
  exportBackup,
  restoreBackup,
  resetProgress,
  clearLibrary,
  getManga,
  sessionFiles,
  validateBackup,
  type Manga,
  type Settings,
} from './data';
const tabs = ['Reading', 'Appearance', 'Storage', 'About'] as const;
const bytes = (n: number) =>
  n < 1048576
    ? (n / 1024).toFixed(0) + ' KB'
    : n < 1073741824
      ? (n / 1048576).toFixed(1) + ' MB'
      : (n / 1073741824).toFixed(1) + ' GB';
export default function SettingsPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { settings: s, setSettings, notify, refresh, library } = useApp();
  const [tab, setTab] = useState<(typeof tabs)[number]>('Reading');
  const [usage, setUsage] = useState<StorageEstimate | null>(null);
  const [storageError, setStorageError] = useState('');
  const [confirmAction, setConfirmAction] = useState<'progress' | 'all' | null>(null);
  const [clearing, setClearing] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  async function updateStorage() {
    setStorageError('');
    try {
      const estimate = await navigator.storage?.estimate?.();
      setUsage(estimate || null);
    } catch {
      setStorageError('Could not retrieve storage details.');
    }
  }
  useEffect(() => {
    if (open) {
      setConfirmAction(null);
      void updateStorage();
    }
  }, [open, library]);
  const change = <K extends keyof Settings>(key: K, value: Settings[K]) =>
    setSettings({ ...s, [key]: value });
  async function exportData() {
    let jsonStr: string;
    if (desktopAPI.isDesktop && desktopAPI.exportBackup) {
      jsonStr = await desktopAPI.exportBackup();
    } else {
      jsonStr = await exportBackup();
    }
    const url = URL.createObjectURL(new Blob([jsonStr], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga-reader-backup.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importData(file?: File) {
    if (!file) return;
    try {
      assertAtMost(file.size, limits.backupBytes, 'Backup size (bytes)');
      const text = await withinTime(file.text(), limits.ioTimeoutMs, 'Reading backup');
      let appliedSettings: Settings;
      if (desktopAPI.isDesktop && desktopAPI.restoreBackup) {
        appliedSettings = await desktopAPI.restoreBackup(text);
      } else {
        const value = validateBackup(JSON.parse(text));
        appliedSettings = await restoreBackup(value);
      }
      setSettings(appliedSettings);
      await refresh();
      notify('Backup imported. Re-link folders when requested.');
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Could not import backup.');
    }
  }
  async function clear() {
    if (!confirmAction) return;
    setClearing(true);
    try {
      if (confirmAction === 'progress') {
        await resetProgress();
      } else {
        await clearLibrary();
      }
      await refresh();
      notify(confirmAction === 'progress' ? 'Reading progress cleared.' : 'Manga data cleared.');
      setConfirmAction(null);
    } catch {
      notify('Could not clear data. Please try again.');
    } finally {
      setClearing(false);
    }
  }
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="settings-panel tabbed-modal">
          <div className="modal-heading">
            <div className="dialog-heading">
              <Dialog.Title>Settings</Dialog.Title>
              <Dialog.Close asChild>
                <button className="close-btn" aria-label="Close settings">
                  <X size={20} />
                </button>
              </Dialog.Close>
            </div>
            <Dialog.Description>
              Make yourself comfortable. Changes save automatically.
            </Dialog.Description>
          </div>
          <div className="settings-tabs" role="tablist" aria-label="Settings categories">
            {tabs.map((name, i) => (
              <button
                key={name}
                type="button"
                role="tab"
                id={'settings-tab-' + name}
                aria-controls={'settings-panel-' + name}
                aria-selected={tab === name}
                tabIndex={tab === name ? 0 : -1}
                onClick={() => setTab(name)}
                onKeyDown={(e) => {
                  let next = i;
                  if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
                  else if (e.key === 'ArrowLeft') next = (i + tabs.length - 1) % tabs.length;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = tabs.length - 1;
                  else return;
                  e.preventDefault();
                  setTab(tabs[next]);
                  document.getElementById('settings-tab-' + tabs[next])?.focus();
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div
            className="settings-tab-body"
            role="tabpanel"
            id={'settings-panel-' + tab}
            aria-labelledby={'settings-tab-' + tab}
            tabIndex={0}
          >
            {tab === 'Reading' && (
              <>
                <section>
                  <h3>Pages & layout</h3>
                  <label>
                    Reading mode
                    <Dropdown
                      aria-label="Reading mode"
                      value={s.mode}
                      onChange={(e) => change('mode', e.target.value as Settings['mode'])}
                    >
                      <option value="continuous">Continuous scroll</option>
                      <option value="single">Single page</option>
                    </Dropdown>
                  </label>
                  <label>
                    Page fitting
                    <Dropdown
                      aria-label="Page fitting"
                      value={s.layout}
                      onChange={(e) => change('layout', e.target.value as Settings['layout'])}
                    >
                      <option value="max">Max-width</option>
                      <option value="width">Respect width</option>
                      <option value="height">Respect height</option>
                      <option value="auto">Auto</option>
                    </Dropdown>
                  </label>
                  <label>
                    Maximum width
                    <Dropdown
                      aria-label="Maximum width"
                      value={s.maxWidth}
                      onChange={(e) => change('maxWidth', Number(e.target.value))}
                    >
                      {[920, 1024, 1280, 0].map((n) => (
                        <option key={n} value={n}>
                          {n ? n + ' px' : 'Full width'}
                        </option>
                      ))}
                    </Dropdown>
                  </label>
                  <label>
                    Page-turn direction
                    <Dropdown
                      aria-label="Page-turn direction"
                      value={s.direction}
                      onChange={(e) => change('direction', e.target.value as Settings['direction'])}
                    >
                      <option value="ltr">Left to right</option>
                      <option value="rtl">Right to left</option>
                    </Dropdown>
                  </label>
                  <label>
                    Two-page spreads on wide screens
                    <input
                      type="checkbox"
                      checked={s.spread}
                      onChange={(e) => change('spread', e.target.checked)}
                    />
                  </label>
                  <label>
                    Show the first page alone
                    <input
                      type="checkbox"
                      checked={s.singleCover}
                      onChange={(e) => change('singleCover', e.target.checked)}
                    />
                  </label>
                  <p className="subtle">
                    Spreads apply in single-page mode at widths of 700 pixels or more. Landscape
                    pages stay separate. Pinch zoom keeps native touch panning; swipes do not turn
                    pages while zoomed.
                  </p>
                  <p className="subtle">
                    Width presets apply to Max-width mode. Pages remain gap-free and keep their
                    original proportions.
                  </p>
                </section>
                <section>
                  <h3>Auto-scroll</h3>
                  <label>
                    {s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'}
                    <Dropdown
                      aria-label={
                        s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'
                      }
                      value={s.customSeconds ? 'custom' : s.seconds}
                      onChange={(e) =>
                        setSettings({
                          ...s,
                          customSeconds: e.target.value === 'custom',
                          ...(e.target.value !== 'custom'
                            ? { seconds: Number(e.target.value) }
                            : {}),
                        })
                      }
                    >
                      {[2, 3, 4, 5].map((n) => (
                        <option value={n} key={n}>
                          {n} seconds
                        </option>
                      ))}
                      <option value="custom">Custom</option>
                    </Dropdown>
                  </label>
                  {s.customSeconds && (
                    <label>
                      Custom seconds
                      <input
                        aria-label={
                          s.mode === 'continuous'
                            ? 'Custom seconds per screen'
                            : 'Custom seconds per page'
                        }
                        type="number"
                        min="0.5"
                        max="120"
                        step="0.5"
                        value={s.seconds}
                        onChange={(e) =>
                          change(
                            'seconds',
                            Math.min(120, Math.max(0.5, Number(e.target.value) || 3)),
                          )
                        }
                      />
                    </label>
                  )}
                  <p className="subtle">
                    {s.mode === 'continuous'
                      ? 'Scrolls one screen height in this time, regardless of page length. More seconds means slower scrolling.'
                      : 'Turns to the next page or spread after this time.'}
                  </p>
                  <label>
                    At the end of playback
                    <Dropdown
                      aria-label="At the end of playback"
                      value={s.endAction}
                      onChange={(e) =>
                        setSettings({
                          ...s,
                          endAction: e.target.value as Settings['endAction'],
                          advance: e.target.value === 'next',
                        })
                      }
                    >
                      <option value="next">Next chapter</option>
                      <option value="stop">Stop</option>
                      <option value="replay">Replay chapter</option>
                    </Dropdown>
                  </label>
                  <label>
                    Resume after interaction
                    <Dropdown
                      aria-label="Resume after interaction"
                      value={s.resumeDelay}
                      onChange={(e) => change('resumeDelay', Number(e.target.value))}
                    >
                      {[1, 1.8, 3, 5, 10].map((n) => (
                        <option key={n} value={n}>
                          {n} seconds
                        </option>
                      ))}
                    </Dropdown>
                  </label>
                  <p className="subtle">
                    Scrolling pauses when you use the mouse, touch, or keyboard, then resumes after
                    this idle time. Opening a popup pauses it until the popup closes.
                  </p>
                </section>
                <section>
                  <h3>Accidental delete control</h3>
                  <label>
                    Confirm before deleting
                    <input
                      type="checkbox"
                      checked={Boolean(s.confirmDelete)}
                      onChange={(e) => change('confirmDelete', e.target.checked)}
                    />
                  </label>
                  <p className="subtle">
                    When enabled, clicking a delete button opens a confirmation popup modal to
                    confirm the deletion or cancel the action.
                  </p>
                </section>
              </>
            )}
            {tab === 'Appearance' && (
              <>
                <section>
                  <h3>Appearance</h3>
                  <label>
                    Theme
                    <Dropdown
                      aria-label="Theme"
                      value={s.theme}
                      onChange={(e) => change('theme', e.target.value as Settings['theme'])}
                    >
                      <option value="system">System</option>
                      <option value="light">Light</option>
                      <option value="dark">Dark</option>
                    </Dropdown>
                  </label>
                  <label>
                    Headings & titles font size
                    <Dropdown
                      aria-label="Headings and titles font size"
                      value={s.fontSizeTitle}
                      onChange={(e) => change('fontSizeTitle', Number(e.target.value))}
                    >
                      {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
                        <option key={size} value={size}>
                          {size}px{size === 15 ? ' (Default)' : ''}
                        </option>
                      ))}
                      {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeTitle) && (
                        <option value={s.fontSizeTitle}>{s.fontSizeTitle}px</option>
                      )}
                    </Dropdown>
                  </label>
                  <label>
                    UI font size
                    <Dropdown
                      aria-label="UI font size"
                      value={s.fontSizeUi}
                      onChange={(e) => change('fontSizeUi', Number(e.target.value))}
                    >
                      {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
                        <option key={size} value={size}>
                          {size}px{size === 15 ? ' (Default)' : ''}
                        </option>
                      ))}
                      {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeUi) && (
                        <option value={s.fontSizeUi}>{s.fontSizeUi}px</option>
                      )}
                    </Dropdown>
                  </label>
                  <label>
                    Button font size
                    <Dropdown
                      aria-label="Button font size"
                      value={s.fontSizeButton}
                      onChange={(e) => change('fontSizeButton', Number(e.target.value))}
                    >
                      {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
                        <option key={size} value={size}>
                          {size}px{size === 15 ? ' (Default)' : ''}
                        </option>
                      ))}
                      {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeButton) && (
                        <option value={s.fontSizeButton}>{s.fontSizeButton}px</option>
                      )}
                    </Dropdown>
                  </label>
                  <label>
                    Auto-hide reader bars
                    <input
                      type="checkbox"
                      checked={s.autoHideBars}
                      onChange={(e) => change('autoHideBars', e.target.checked)}
                    />
                  </label>
                  <p className="subtle">
                    Turn off to keep reader controls visible. When enabled, move or tap near the top
                    or bottom edge to reveal them.
                  </p>
                  <label>
                    Reduce interface motion
                    <input
                      type="checkbox"
                      checked={s.reduced}
                      onChange={(e) => change('reduced', e.target.checked)}
                    />
                  </label>
                  <p className="subtle">
                    Your system’s reduced-motion preference is also respected. Auto-scroll remains
                    available when you explicitly start it.
                  </p>
                </section>
                <section>
                  <h3>Image performance</h3>
                  <label>
                    Lower image resolution on mobile
                    <input
                      type="checkbox"
                      checked={s.lowQuality}
                      onChange={(e) => change('lowQuality', e.target.checked)}
                    />
                  </label>
                  <p className="subtle">
                    When supported, large pages are displayed at up to 1,000 pixels wide on narrow
                    screens. Original files are never changed. Nearby pages load as you read;
                    distant images are released from memory.
                  </p>
                </section>
                <section>
                  <h3>Start fresh</h3>
                  <button
                    className="secondary"
                    onClick={() => {
                      setSettings(defaults);
                      notify(
                        'Default preferences restored. Your library and progress are unchanged.',
                      );
                    }}
                  >
                    <RefreshCw size={16} /> Restore default preferences
                  </button>
                  <p className="subtle">Resets appearance and reading preferences only.</p>
                </section>
              </>
            )}
            {tab === 'Storage' && (
              <>
                <section>
                  <h3>On this device</h3>
                  <dl className="storage-stats">
                    <div>
                      <dt>Storage used</dt>
                      <dd>{usage?.usage !== undefined ? bytes(usage.usage) : 'Unavailable'}</dd>
                    </div>
                    <div>
                      <dt>Estimated quota</dt>
                      <dd>{usage?.quota !== undefined ? bytes(usage.quota) : 'Unavailable'}</dd>
                    </div>
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
                    These estimates cover the application database and cached thumbnails, not the
                    size of your manga folders. Quota is an estimate, not reserved disk space.
                  </p>
                  <div className="button-row">
                    <button className="secondary" onClick={() => void updateStorage()}>
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
                      className="secondary"
                      onClick={() =>
                        void exportData().catch(() => notify('Could not export backup.'))
                      }
                    >
                      <Download size={16} /> Export metadata
                    </button>
                    <button className="secondary" onClick={() => input.current?.click()}>
                      <Upload size={16} /> Import backup
                    </button>
                    <input
                      hidden
                      ref={input}
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
                          : 'Remove every title, cover preview, and reading position from this browser?'}{' '}
                        Original files stay untouched.
                      </p>
                      <div className="button-row">
                        <button
                          className="secondary danger-text"
                          disabled={clearing}
                          onClick={() => void clear()}
                        >
                          {clearing ? 'Clearing…' : 'Confirm clear'}
                        </button>
                        <button
                          className="secondary"
                          disabled={clearing}
                          onClick={() => setConfirmAction(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="button-row">
                      <button className="secondary" onClick={() => setConfirmAction('progress')}>
                        Clear reading progress
                      </button>
                      <button
                        className="secondary danger-text"
                        onClick={() => setConfirmAction('all')}
                      >
                        Clear all manga data
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
                      className="secondary"
                      onClick={() => {
                        const logs = getDiagnostics();
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
            )}
            {tab === 'About' && (
              <>
                <section>
                  <h3>
                    Reader <span className="subtle">{APP_VERSION}</span>
                  </h3>
                  <p>
                    A private reader for the manga folders already on your device. No account or
                    external service is needed for reading your local pages.
                  </p>
                </section>
                <section>
                  <h3>Organize your folders</h3>
                  <p>
                    Choose a title folder, a parent collection, or several dropped folders. Review
                    the detected grouping before importing. Images directly in the root become one
                    chapter; nested folder paths become chapter labels.
                  </p>
                  <p>
                    Natural sorting handles numbered chapters and decimals. You can choose filename
                    or reverse order in the import preview. Hidden/system files and non-image files
                    are ignored; inaccessible folders and unreadable images encountered during
                    initial preparation are listed in the import report. Empty folders contain no
                    pages and are omitted.
                  </p>
                  <p>
                    Add a file named thumbnail.png, thumbnail.jpg, or another supported image format
                    in the root for a cover. Otherwise, Reader uses the first readable page.
                  </p>
                </section>
                <section>
                  <h3>Faster, staged indexing</h3>
                  <p>
                    Reader discovers folders and prepares image sizes together in one scan. The
                    first five chapters are prepared before you confirm import. These measurements
                    stay temporary until you add the title; cancelling discards them. Changing
                    grouping or sorting updates the preparation before the Import button becomes
                    available.
                  </p>
                  <p>
                    Page dimensions keep scrolling, page fitting, two-page spreads, and saved
                    reading positions stable. Common image sizes are read from small file headers
                    instead of decoding the entire image. Other formats use the browser decoder,
                    with at most three checks running together.
                  </p>
                  <p>
                    After a title is saved, remaining chapters continue preparing quietly in the
                    background. Opening an unfinished chapter gives it priority. Completed
                    dimensions are cached locally; pending work resumes on a later visit when folder
                    access is available. Removing a title stops its background work. Unreadable
                    pages remain available for retry and show an error when opened.
                  </p>
                </section>
                <section>
                  <h3>Folder access & reading</h3>
                  <p>
                    In the browser’s folder permission prompt, choose “Allow on every visit”, if
                    offered, to avoid granting access each session. “Allow this time” is temporary.
                    The browser controls these choices; Reader cannot force permanent access or make
                    all options appear again.
                  </p>
                  <p>
                    To change a previous choice, open the browser’s address-bar site controls and
                    review its file or folder permissions. Then return to Reader and open a title to
                    request access again. Available options depend on your browser and previous
                    choices. Keep this site’s stored data to preserve your library and progress.
                  </p>
                  <p>
                    Where supported, direct folder selection can retain access with your permission.
                    Embedded views and other browsers use standard folder selection and need
                    re-linking after a reload. Saved indexing and progress remain.
                  </p>
                  <p>
                    When folders move or permission expires, use Re-link / re-index on the title.
                    Reader reuses unchanged dimensions and restores progress by page path. Renamed
                    chapters with uniquely matching page metadata can keep progress. A mismatched
                    selection requires explicit confirmation in the import preview.
                  </p>
                </section>
                <section>
                  <h3>Reader controls</h3>
                  <p>
                    The information icon beside the theme button lists keyboard shortcuts. In
                    single-page mode, swipe left or right to turn a page. With auto-hide enabled,
                    tap near a screen edge to bring controls back.
                  </p>
                </section>
              </>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
