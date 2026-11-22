import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { Route, Routes } from 'react-router-dom';
import { LoaderCircle, X } from 'lucide-react';
import BookmarksPage from './Bookmarks';
import useInterfaceMotion from './useInterfaceMotion';
import { useImport } from './useImport';
import { ImportDialog } from './ImportDialogs';
import { applyUpdate, hasUpdate } from './updates';
import { desktopAPI } from './tauriBridge';
import {
  resumeBackground,
  listLibrary,
  getStoredSettings,
  saveStoredSettings,
  ensureLibraryMigrated,
  syncChannel,
  defaults,
  parseSettings,
  fromHandle,
  fromFiles,
  fromDesktopFolder,
  droppedSources,
  errorMessage,
  type Manga,
  type Summary,
  type Settings,
  type Directory,
} from './data';
import { AppContext } from './app-tsx/AppContext';
import { Library } from './app-tsx/Library';

// Re-export modular components and utilities for seamless backwards compatibility
export { AppContext, useApp, type Context } from './app-tsx/AppContext';
export { IconButton } from './app-tsx/IconButton';
export { ThemeButton } from './app-tsx/ThemeButton';
export {
  Cover,
  clearCoverUrlPool,
  observeCoverVisibility,
  MAX_COVER_URLS,
  coverUrlPool,
} from './app-tsx/Cover';
export { CardMenu } from './app-tsx/CardMenu';
export { CalendarIcon, UploadIcon, AddMangaIcon } from './app-tsx/Icons';
export { DateTooltip, formatAddedDate, formatWholeDate } from './app-tsx/DateTooltip';
export { shelfCollator, sortLibraryEntries } from './app-tsx/sortUtils';
export { Library } from './app-tsx/Library';

const Reader = lazy(() => import('./Reader'));
const MangaDetails = lazy(() => import('./MangaDetails'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
const ImportComplete = lazy(() => import('./ImportComplete'));

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(defaults);
  const [library, setLibrary] = useState<Summary[]>([]);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, notify] = useState('');
  const [updateReady, setUpdateReady] = useState(hasUpdate());
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pending = useRef<Summary | Manga | undefined>(undefined);
  const standardOnly = useRef(false);
  useInterfaceMotion(settings.reduced);
  const refresh = async () => setLibrary(await listLibrary());

  const {
    state: importState,
    isBusy: busy,
    scanState: scan,
    discover,
    runImport,
    cancel,
    dismiss: dismissImport,
  } = useImport({
    onRefresh: refresh,
    onNotify: notify,
  });

  useEffect(() => {
    const blocked = () =>
      notify(
        'Close other Reader tabs to finish upgrading local storage. Your data will be preserved.',
      );
    window.addEventListener('reader-storage-blocked', blocked);
    const onSync = () => {
      void refresh();
    };
    syncChannel?.addEventListener('message', onSync);

    const init = async () => {
      try {
        if (desktopAPI.isDesktop) {
          await ensureLibraryMigrated();
        }
        await Promise.all([
          refresh(),
          getStoredSettings().then((s) => {
            if (s) {
              setSettingsState(s);
            }
          }),
        ]);
        void resumeBackground().catch(() => {});
      } catch (e) {
        notify(errorMessage(e));
      } finally {
        setReady(true);
      }
    };
    void init();

    return () => {
      window.removeEventListener('reader-storage-blocked', blocked);
      syncChannel?.removeEventListener('message', onSync);
    };
  }, []);

  useEffect(() => {
    const update = () => setUpdateReady(hasUpdate());
    window.addEventListener('reader-update-ready', update);
    update();
    return () => window.removeEventListener('reader-update-ready', update);
  }, []);

  function setSettings(s: Settings) {
    const validated = parseSettings(s);
    setSettingsState(validated);
    void saveStoredSettings(validated).catch((e) => notify(errorMessage(e)));
  }

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      document.documentElement.classList.toggle(
        'dark',
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches),
      );
      document.documentElement.classList.toggle('reduced', settings.reduced);
      document.documentElement.style.setProperty(
        '--font-size-ui',
        `${settings.fontSizeUi ?? 15}px`,
      );
      document.documentElement.style.setProperty(
        '--font-size-title',
        `${settings.fontSizeTitle ?? 15}px`,
      );
      document.documentElement.style.setProperty(
        '--font-size-button',
        `${settings.fontSizeButton ?? 15}px`,
      );
    };
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [settings]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => notify(''), 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  async function pick(m?: Summary | Manga) {
    if (busy) return;
    pending.current = m;
    if (desktopAPI.isDesktop) {
      let folderPath: string | null = null;
      try {
        folderPath = await desktopAPI.selectFolder();
      } catch {
        // dialog error
      }
      if (!folderPath) return;
      await discover(async (opts) => [await fromDesktopFolder(folderPath!, opts)], m);
      return;
    }
    const picker = (window as unknown as { showDirectoryPicker?: () => Promise<Directory> })
      .showDirectoryPicker;
    const standard = () => {
      if (fileInput.current && 'webkitdirectory' in fileInput.current) fileInput.current.click();
      else imageInput.current?.click();
    };
    if (!picker || window.self !== window.top || standardOnly.current) {
      standard();
      return;
    }
    try {
      const handle = await picker.call(window);
      await discover(async (options) => [await fromHandle(handle, options)], m);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return;
      standardOnly.current = true;
      if (navigator.userActivation?.isActive) standard();
      else notify('Direct folder selection is unavailable. Click again to use standard selection.');
    }
  }

  const drop = (items: DataTransferItem[]) => {
    if (busy) return;
    void discover(async (options) => {
      const read = droppedSources(items, options);
      return await read();
    });
  };

  useEffect(() => {
    if (!desktopAPI.isDesktop || !desktopAPI.onDragDrop) return;
    return desktopAPI.onDragDrop((paths) => {
      if (busy || !paths.length) return;
      void discover(async (options) => {
        const sources = [];
        for (const p of paths) {
          try {
            sources.push(await fromDesktopFolder(p, options));
          } catch (e) {
            console.warn('Failed to import dropped folder:', p, e);
          }
        }
        return sources;
      });
    });
  }, [busy, discover]);

  useEffect(() => {
    const context = (
      document as unknown as {
        modelContext?: { registerTool: (tool: unknown, options: unknown) => Promise<void> };
      }
    ).modelContext;
    if (!context) return;
    const lifecycle = new AbortController();
    void Promise.resolve(
      context.registerTool(
        {
          name: 'list_local_manga',
          description: 'Read local library titles and chapter progress.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
          annotations: { readOnlyHint: true, untrustedContentHint: true },
          execute: async (input: unknown) => {
            if (!input || typeof input !== 'object' || Object.keys(input).length)
              throw new Error('Expected an empty object.');
            return (await listLibrary()).map((m) => ({
              id: m.id,
              title: m.title,
              chapters: m.chapterCount,
              read: m.chaptersRead,
            }));
          },
        },
        { signal: lifecycle.signal },
      ),
    ).catch(() => {});
    return () => lifecycle.abort();
  }, []);

  function exportReport() {
    if (importState.status !== 'complete') return;
    const url = URL.createObjectURL(
      new Blob([importState.report.issues.map((i) => `${i.path}: ${i.reason}`).join('\n')], {
        type: 'text/plain',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga-report.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <AppContext.Provider
      value={{
        settings,
        setSettings,
        library,
        refresh,
        notify,
        pick,
        openSettings: () => setSettingsOpen(true),
      }}
    >
      <input
        hidden
        ref={fileInput}
        type="file"
        multiple
        {...{ webkitdirectory: '' }}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) void discover(async () => fromFiles(files), pending.current);
          e.target.value = '';
        }}
      />
      <input
        hidden
        ref={imageInput}
        type="file"
        multiple
        accept="image/*,.heic,.heif,.tif,.tiff"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) void discover(async () => fromFiles(files), pending.current);
          e.target.value = '';
        }}
      />
      {ready ? (
        <Suspense
          fallback={
            <div className="loading-screen">
              <LoaderCircle className="spin" /> Opening…
            </div>
          }
        >
          <Routes>
            <Route path="/bookmarks" element={<BookmarksPage />} />
            <Route
              path="/"
              element={<Library busy={busy} scan={scan} drop={drop} cancel={cancel} />}
            />
            <Route
              path="/index.html"
              element={<Library busy={busy} scan={scan} drop={drop} cancel={cancel} />}
            />
            <Route
              path="/read/:mangaId"
              element={
                <Reader
                  indexing={busy}
                  indexingProgress={[scan.done, scan.total]}
                  cancelImport={cancel}
                />
              }
            />
            <Route path="/:slug" element={<MangaDetails />} />
            <Route
              path="/:slug/:chapterSegment"
              element={
                <Reader
                  indexing={busy}
                  indexingProgress={[scan.done, scan.total]}
                  cancelImport={cancel}
                />
              }
            />
            <Route
              path="*"
              element={<Library busy={busy} scan={scan} drop={drop} cancel={cancel} />}
            />
          </Routes>
        </Suspense>
      ) : (
        <div className="loading-screen">
          <LoaderCircle className="spin" /> Opening your library…
        </div>
      )}
      {settingsOpen && (
        <Suspense fallback={null}>
          <SettingsPanel open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        </Suspense>
      )}
      {importState.status === 'preview' && (
        <ImportDialog
          sources={importState.preview.sources}
          target={importState.preview.target}
          library={library}
          onClose={dismissImport}
          onImport={(plans) => void runImport(plans)}
        />
      )}
      {importState.status === 'complete' && (
        <Suspense fallback={null}>
          <ImportComplete
            titles={importState.report.titles}
            issues={importState.report.issues}
            onClose={dismissImport}
            onExport={exportReport}
            onRetry={() => void runImport(importState.report.retry)}
          />
        </Suspense>
      )}
      {updateReady && (
        <div className="update-banner" role="status">
          A new Reader version is ready.{' '}
          <button
            className="btn"
            disabled={updating || busy}
            onClick={async () => {
              setUpdating(true);
              setUpdateError('');
              try {
                await applyUpdate();
              } catch (e) {
                setUpdateError(errorMessage(e));
              } finally {
                setUpdating(false);
              }
            }}
          >
            {updating ? 'Saving & reloading…' : busy ? 'Finish importing first' : 'Save & reload'}
          </button>
          {updateError && <span role="alert">{updateError}</span>}
          <details className="update-help">
            <summary>Need to refresh manually?</summary>
            <p>
              Return to your library first to save your reading position. Then press{' '}
              <strong>Ctrl + Shift + R</strong> on Windows/Linux, or <strong>⌘ + Shift + R</strong>{' '}
              in Chrome/Firefox on Mac. In Safari on Mac, use <strong>⌘ + Option + R</strong>.
            </p>
            <p>
              On mobile, or if the old version remains: close every Reader tab and app window, then
              reopen Reader while online.
            </p>
            <p>
              Do not clear site data—it contains your saved library and progress. Selected folders
              may need re-linking after reloading.
            </p>
          </details>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
          <button
            className="btn icon close-btn"
            onClick={() => notify('')}
            aria-label="Dismiss notification"
          >
            <X size={16} />
          </button>
        </div>
      )}
    </AppContext.Provider>
  );
}
