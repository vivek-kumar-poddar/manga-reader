import BookmarksPage, { BookmarkShelf } from './Bookmarks';
import Dropdown from './Dropdown';
import useInterfaceMotion from './useInterfaceMotion';
import { mangaPath, mangaDetailsPath } from './paths';
import DailyWelcome from './DailyWelcome';
import {
  useState,
  useEffect,
  useRef,
  useMemo,
  createContext,
  useContext,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  BookMarked,
  FolderPlus,
  Settings as Gear,
  Sun,
  Moon,
  X,
  MoreHorizontal,
  FolderSync,
  Trash2,
  Check,
  LoaderCircle,
  ArrowUpRight,
  Info,
  Download,
} from 'lucide-react';
import {
  warmSources,
  discardScan,
  scheduleBackground,
  resumeBackground,
  allManga,
  listLibrary,
  getManga,
  deleteManga,
  db,
  defaults,
  parseSettings,
  saveManga,
  indexSource,
  fromHandle,
  fromFiles,
  fromDesktopFolder,
  droppedSources,
  access,
  errorMessage,
  type Manga,
  type Summary,
  type Settings,
  type Directory,
  type Source,
  type ScanOptions,
  type ScanState,
  type Issue,
} from './data';
import { SupportedDialog, ImportDialog, Modal, type ImportPlan } from './ImportDialogs';
import { APP_VERSION, applyUpdate, hasUpdate } from './updates';

const Reader = lazy(() => import('./Reader'));
const MangaDetails = lazy(() => import('./MangaDetails'));
const SettingsPanel = lazy(() => import('./SettingsPanel'));
const ImportComplete = lazy(() => import('./ImportComplete'));
import { desktopAPI } from './tauriBridge';

interface Context {
  settings: Settings;
  setSettings: (s: Settings) => void;
  openSettings: () => void;
  notify: (s: string) => void;
  pick: (m?: Summary | Manga) => Promise<void>;
  library: Summary[];
  refresh: () => Promise<void>;
}
const AppContext = createContext<Context>(null!);
export const useApp = () => useContext(AppContext);
export function IconButton({
  label,
  children,
  onClick,
  className = '',
}: {
  label: string;
  children: ReactNode;
  onClick: () => void;
  className?: string;
}) {
  return (
    <button
      className={'icon-button ' + className}
      title={label}
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
export function ThemeButton() {
  const { settings, setSettings } = useApp();
  return (
    <IconButton
      label="Toggle light / dark theme"
      onClick={() =>
        setSettings({
          ...settings,
          theme: document.documentElement.classList.contains('dark') ? 'light' : 'dark',
        })
      }
    >
      {settings.theme === 'dark' ? <Sun size={19} /> : <Moon size={19} />}
    </IconButton>
  );
}
export function Cover({ m }: { m: Pick<Summary, 'id'> }) {
  const [url, setUrl] = useState('');
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true,
      u = '';
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        void db
          .then((d) => d.get('covers', m.id))
          .then((blob) => {
            if (live && blob) {
              u = URL.createObjectURL(blob);
              setUrl(u);
            }
          })
          .catch(() => {});
      },
      { rootMargin: '200px' },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      live = false;
      observer.disconnect();
      if (u) URL.revokeObjectURL(u);
    };
  }, [m.id]);
  return (
    <div ref={host} className="cover">
      {url ? <img src={url} alt="" /> : <BookOpen size={24} />}
    </div>
  );
}
function Library({
  busy,
  scan,
  drop,
  cancel,
}: {
  busy: boolean;
  scan: ScanState;
  drop: (items: DataTransferItem[]) => void;
  cancel: () => void;
}) {
  const { library, pick, notify, refresh, openSettings, settings, setSettings } = useApp();
  const shelfSort = settings.shelfSort || 'recent';
  const sortedLibrary = useMemo(
    () =>
      [...library].sort((a, b) => {
        const byTitle = a.title.localeCompare(b.title, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        return (
          (shelfSort === 'title'
            ? byTitle
            : shelfSort === 'added'
              ? b.addedAt - a.addedAt
              : shelfSort === 'progress'
                ? b.chaptersRead / Math.max(1, b.chapterCount) -
                  a.chaptersRead / Math.max(1, a.chapterCount)
                : b.updatedAt - a.updatedAt) ||
          byTitle ||
          a.id.localeCompare(b.id)
        );
      }),
    [library, shelfSort],
  );
  const [drag, setDrag] = useState(false);
  const [needs, setNeeds] = useState<Set<string>>(new Set());
  const [supported, setSupported] = useState(false);
  const [removeId, setRemoveId] = useState<string>();
  const nav = useNavigate();
  useEffect(() => {
    function dismiss(event: MouseEvent | KeyboardEvent) {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      document.querySelectorAll<HTMLDetailsElement>('.card-menu[open]').forEach((menu) => {
        if (event instanceof KeyboardEvent) {
          if (menu.contains(document.activeElement)) menu.querySelector('summary')?.focus();
          menu.open = false;
        } else if (event.target instanceof Node && !menu.contains(event.target)) {
          menu.open = false;
        }
      });
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', dismiss);
    };
  }, []);
  useEffect(() => {
    let live = true;
    let revision = 0;
    function checkAccess() {
      const current = ++revision;
      void Promise.all(library.map(async (m) => (!(await access(m)) ? m.id : ''))).then(
        (ids) => live && current === revision && setNeeds(new Set(ids.filter(Boolean))),
      );
    }
    function onVisible() {
      if (document.visibilityState === 'visible') checkAccess();
    }
    checkAccess();
    window.addEventListener('focus', checkAccess);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      window.removeEventListener('focus', checkAccess);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [library]);
  async function mark(id: string, read: boolean) {
    const m = await getManga(id);
    if (!m) return;
    await saveManga({ ...m, chapters: m.chapters.map((c) => ({ ...c, read })) });
    await refresh();
  }
  async function remove() {
    if (!removeId) return;
    await deleteManga(removeId);
    setRemoveId(undefined);
    await refresh();
  }
  return (
    <>
      <header className="library-header">
        <Link to="/" className="brand">
          <BookOpen size={23} strokeWidth={1.5} />
          <span>
            Reader<span className="brand-period">.</span>
          </span>
        </Link>
        <div className="header-actions">
          <span className="local-label">Your files. Your space.</span>
          <Link className="icon-button" to="/bookmarks" aria-label="Bookmarks" title="Bookmarks">
            <BookMarked size={19} />
          </Link>
          <ThemeButton />
          <IconButton label="Settings" onClick={openSettings}>
            <Gear size={19} />
          </IconButton>
        </div>
      </header>
      <main className="library-main">
        <div className="page-heading">
          <div>
            <div className="eyebrow">A LITTLE SPACE FOR YOUR STORIES</div>
            <h1>Your library</h1>
            <DailyWelcome />
          </div>
        </div>
        <div
          aria-busy={busy}
          onClick={(e) => {
            if (!busy && !(e.target as HTMLElement).closest('button,a')) void pick();
          }}
          onDragOver={(e) => {
            e.preventDefault();
            if (!busy) setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) drop(Array.from(e.dataTransfer.items));
          }}
          className={
            'upload-zone group bg-white dark:bg-zinc-900 min-h-[350px] p-8 rounded w-full flex flex-col items-center justify-center relative transition-colors duration-300 cursor-pointer shadow ' +
            (drag ? 'dragging' : '')
          }
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={26} />
              <strong className="index-count" aria-live="polite">
                {scan.phase === 'index' ? 'Saving…' : `${scan.done} found`}
              </strong>
              <span>
                {scan.phase === 'index' ? 'Adding to your library…' : 'Preparing your manga…'}
              </span>
              <span className="subtle">{scan.title}</span>
              <button className="secondary" onClick={cancel}>
                Cancel import
              </button>
            </>
          ) : (
            <>
              <span className="upload-icon">
                <FolderPlus size={29} strokeWidth={1.35} />
              </span>
              <h2>{drag ? 'Drop your stories here' : 'Make room for a good story'}</h2>
              <p>Drop manga folders here, or choose your files.</p>
              <div className="upload-buttons">
                <button className="browse-button" onClick={() => void pick()}>
                  Choose a folder <ArrowUpRight size={16} />
                </button>
                <button className="secondary support-button" onClick={() => setSupported(true)}>
                  <Info size={16} /> What’s supported
                </button>
              </div>
              <span className="subtle upload-note">
                Files stay on your device. No uploads, ever.
              </span>
            </>
          )}
        </div>
        <BookmarkShelf carousel />
        <div className="shelf-toolbar">
          <div className="collection-heading">
            <h2>
              {library.length
                ? `${library.length} manga on your shelf.`
                : 'Your first manga belongs here.'}
            </h2>
            <span>{library.length ? 'Saved on this device' : 'Ready when you are'}</span>
          </div>
          {library.length > 1 && (
            <label className="shelf-sort">
              <span>Sort by</span>
              <Dropdown
                aria-label="Sort manga shelf"
                value={shelfSort}
                onChange={(e) =>
                  setSettings({ ...settings, shelfSort: e.target.value as Settings['shelfSort'] })
                }
              >
                <option value="recent">Recent activity</option>
                <option value="title">Title A–Z</option>
                <option value="added">Newest added</option>
                <option value="progress">Most completed</option>
              </Dropdown>
            </label>
          )}
        </div>
        {library.length ? (
          <div className="manga-grid">
            {sortedLibrary.map((m) => (
              <article className="manga-card" key={m.id}>
                <div className="manga-open">
                  <Cover m={m} />
                  <div className="manga-info">
                    <h3 title={m.title}>{m.title}</h3>
                    <p>
                      {m.chaptersRead} / {m.chapterCount} chapters read
                    </p>
                    <div className="reading-progress">
                      <span
                        style={{
                          width: (100 * m.chaptersRead) / Math.max(1, m.chapterCount) + '%',
                        }}
                      />
                    </div>
                    <div className="manga-card-actions">
                      <button
                        className="continue-label"
                        onClick={() =>
                          void getManga(m.id)
                            .then((latest) => {
                              if (latest) nav(mangaPath(latest));
                            })
                            .catch((error) => notify(errorMessage(error)))
                        }
                      >
                        {m.hasProgress ? 'Continue reading' : 'Start reading'}{' '}
                        <ArrowUpRight size={13} />
                      </button>
                      <Link className="manga-details-link" to={mangaDetailsPath(m)}>
                        Chapters
                      </Link>
                    </div>
                    {needs.has(m.id) && (
                      <span className="relink-label">
                        {m.handle ? 'Folder access needed' : 'Re-link folder to read'}
                      </span>
                    )}
                  </div>
                </div>
                <details className="card-menu">
                  <summary aria-label={'Options for ' + m.title}>
                    <MoreHorizontal className="card-menu-dots" size={19} />
                    <X className="card-menu-close" size={19} />
                  </summary>
                  <div
                    className="menu-popover"
                    onClick={(event) => {
                      if ((event.target as Element).closest('button')) {
                        const menu = event.currentTarget.closest('details');
                        if (menu) {
                          menu.querySelector('summary')?.focus();
                          menu.open = false;
                        }
                      }
                    }}
                  >
                    <button onClick={() => void pick(m)}>
                      <FolderSync size={16} /> Re-link / re-index
                    </button>
                    <button
                      onClick={() => void mark(m.id, true).catch((e) => notify(errorMessage(e)))}
                    >
                      <Check size={16} /> Mark all read
                    </button>
                    <button
                      onClick={() => void mark(m.id, false).catch((e) => notify(errorMessage(e)))}
                    >
                      <BookOpen size={16} /> Mark all unread
                    </button>
                    <button className="danger-text" onClick={() => setRemoveId(m.id)}>
                      <Trash2 size={16} /> Remove
                    </button>
                  </div>
                </details>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-shelf">
            <BookOpen size={23} strokeWidth={1.3} />
            <p>Your next chapter starts here.</p>
            <span>Add your first folder to build your library.</span>
          </div>
        )}
        <footer className="library-footer">
          <span>By Vivek Kr. Poddar · v{APP_VERSION}</span>
          <span>A quieter way to read.</span>
        </footer>
      </main>
      <SupportedDialog open={supported} onClose={() => setSupported(false)} />
      <Modal
        open={!!removeId}
        onClose={() => setRemoveId(undefined)}
        title="Remove this title?"
        description="Only this title’s saved metadata, cover, bookmarks, and reading progress will be removed. Your original files stay untouched."
      >
        <div className="button-row">
          <button
            className="secondary danger-text"
            onClick={() => void remove().catch((e) => notify(errorMessage(e)))}
          >
            Remove title
          </button>
          <button className="secondary" onClick={() => setRemoveId(undefined)}>
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
export default function App() {
  const [settings, setSettingsState] = useState<Settings>(defaults);
  const [library, setLibrary] = useState<Summary[]>([]);
  const [ready, setReady] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [notice, notify] = useState('');
  const [busy, setBusy] = useState(false);
  const [scan, setScan] = useState<ScanState>({ phase: 'discover', done: 0, total: 0 });
  const [preview, setPreview] = useState<{ sources: Source[]; target?: Manga }>();
  const [report, setReport] = useState<{
    titles: Manga[];
    issues: Issue[];
    count: number;
    reused: number;
    retry: ImportPlan[];
  }>();
  const [updateReady, setUpdateReady] = useState(hasUpdate());
  const [updating, setUpdating] = useState(false);
  const [updateError, setUpdateError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const imageInput = useRef<HTMLInputElement>(null);
  const pending = useRef<Summary | Manga | undefined>(undefined);
  const locked = useRef(false);
  const controller = useRef<AbortController | undefined>(undefined);
  const standardOnly = useRef(false);
  useInterfaceMotion(settings.reduced);
  const refresh = async () => setLibrary(await listLibrary());
  useEffect(() => {
    const blocked = () =>
      notify(
        'Close other Reader tabs to finish upgrading local storage. Your data will be preserved.',
      );
    window.addEventListener('reader-storage-blocked', blocked);
    Promise.all([
      refresh(),
      db
        .then((d) => d.get('settings', 'global'))
        .then((s) => {
          if (s) {
            setSettingsState(parseSettings(s));
          }
        }),
    ])
      .catch((e) => notify(errorMessage(e)))
      .finally(() => setReady(true));
    return () => window.removeEventListener('reader-storage-blocked', blocked);
  }, []);
  useEffect(() => {
    void resumeBackground().catch(() => {});
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
    void db
      .then((d) => d.put('settings', validated, 'global'))
      .catch((e) => notify(errorMessage(e)));
  }
  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const update = () => {
      document.documentElement.classList.toggle(
        'dark',
        settings.theme === 'dark' || (settings.theme === 'system' && media.matches),
      );
      document.documentElement.classList.toggle('reduced', settings.reduced);
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
  function start() {
    locked.current = true;
    setBusy(true);
    setScan({ phase: 'discover', done: 0, total: 0 });
    controller.current = new AbortController();
    let last = 0;
    desktopAPI.setProgressBar(2); // Indeterminate mode while discovering
    return {
      signal: controller.current.signal,
      update: (s: ScanState) => {
        const now = performance.now();
        if (now - last > 80 || s.done === s.total) {
          setScan(s);
          last = now;
          if (s.total > 0) {
            desktopAPI.setProgressBar(Math.min(1, Math.max(0, s.done / s.total)));
          } else {
            desktopAPI.setProgressBar(2);
          }
        }
      },
    } satisfies ScanOptions;
  }
  function finish() {
    locked.current = false;
    setBusy(false);
    desktopAPI.setProgressBar(-1);
  }
  async function discover(
    read: (options: ScanOptions) => Promise<Source[]>,
    target?: Summary | Manga,
  ) {
    if (locked.current) return;
    const options = start();
    let sources: Source[] = [];
    try {
      sources = await read(options);
      await warmSources(sources, options);
      options.signal.throwIfAborted();
      if (!sources.length)
        throw new Error(
          'No supported image candidates found. Select folders with images, or extract archives first.',
        );
      setPreview({ sources, target: target ? await getManga(target.id) : undefined });
    } catch (e) {
      discardScan(sources);
      notify(
        e instanceof DOMException && e.name === 'AbortError'
          ? 'Import cancelled. Existing data is unchanged.'
          : errorMessage(e),
      );
    } finally {
      finish();
    }
  }
  async function runImport(plans: ImportPlan[]) {
    if (locked.current) return;
    setPreview(undefined);
    setReport(undefined);
    const options = start();
    const issues: Issue[] = [];
    const retry: ImportPlan[] = [];
    const titles: Manga[] = [];
    let count = 0,
      reused = 0;
    try {
      for (const plan of plans) {
        options.signal.throwIfAborted();
        try {
          const previous = plan.targetId ? await getManga(plan.targetId) : undefined;
          const result = await indexSource(plan.source, options, previous, plan.sort);
          count++;
          titles.push(result.m);
          scheduleBackground(result.m);
          reused += result.reused;
          issues.push(
            ...result.issues.map((i) => ({ ...i, path: plan.source.title + '/' + i.path })),
          );
          if (result.issues.length) retry.push({ ...plan, targetId: result.m.id });
        } catch (e) {
          options.signal.throwIfAborted();
          issues.push({ path: plan.source.title, reason: errorMessage(e) });
          retry.push(plan);
        }
      }
      await refresh();
      setReport({ titles, count, reused, issues, retry });
    } catch (e) {
      await refresh();
      notify(
        e instanceof DOMException && e.name === 'AbortError'
          ? `Import cancelled. ${count} completed titles saved; the unfinished title was not changed.`
          : errorMessage(e),
      );
    } finally {
      discardScan(plans.map((p) => p.source));
      finish();
    }
  }
  async function pick(m?: Summary | Manga) {
    if (locked.current) return;
    pending.current = m;
    // On desktop, use the native folder dialog and IPC-based file access.
    // This avoids File System Access API permission issues in the installed app.
    if (desktopAPI.isDesktop) {
      let folderPath: string | null = null;
      try {
        folderPath = await desktopAPI.selectFolder();
      } catch {
        // dialog error — do nothing
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
  const cancel = () => controller.current?.abort();
  const drop = (items: DataTransferItem[]) => {
    if (locked.current) return;
    const options = start();
    const read = droppedSources(items, options);
    void read()
      .then(async (sources) => {
        try {
          await warmSources(sources, options);
        } catch (e) {
          discardScan(sources);
          throw e;
        }
        options.signal.throwIfAborted();
        if (!sources.length)
          throw new Error('Drop folders or image files. Extract archives first.');
        setPreview({ sources });
      })
      .catch((e) =>
        notify(
          e instanceof DOMException && e.name === 'AbortError'
            ? 'Import cancelled.'
            : errorMessage(e),
        ),
      )
      .finally(finish);
  };
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
    if (!report) return;
    const url = URL.createObjectURL(
      new Blob([report.issues.map((i) => `${i.path}: ${i.reason}`).join('\n')], {
        type: 'text/plain',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manga-import-report.txt';
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
      {preview && (
        <ImportDialog
          sources={preview.sources}
          target={preview.target}
          library={library}
          onClose={() => {
            discardScan(preview.sources);
            setPreview(undefined);
          }}
          onImport={(plans) => void runImport(plans)}
        />
      )}
      {report && (
        <Suspense fallback={null}>
          <ImportComplete
            titles={report.titles}
            issues={report.issues}
            onClose={() => setReport(undefined)}
            onExport={exportReport}
            onRetry={() => void runImport(report.retry)}
          />
        </Suspense>
      )}
      {updateReady && (
        <div className="update-banner" role="status">
          A new Reader version is ready.{' '}
          <button
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
            className="close-btn"
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
