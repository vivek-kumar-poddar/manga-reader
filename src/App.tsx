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
  memo,
  createContext,
  useContext,
  lazy,
  Suspense,
  type ReactNode,
} from 'react';
import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Bookmark,
  BookMarked,
  Settings as Gear,
  Sun,
  Moon,
  X,
  MoreHorizontal,
  FolderSync,
  Trash2,
  Check,
  LoaderCircle,
  Info,
  Download,
} from 'lucide-react';
import {
  resumeBackground,
  allManga,
  listLibrary,
  getManga,
  deleteManga,
  onMangaDelete,
  getStoredSettings,
  saveStoredSettings,
  ensureLibraryMigrated,
  syncChannel,
  getCover,
  defaults,
  parseSettings,
  saveManga,
  getBookmarkedMangaIds,
  getMangaBookmarkedIds,
  addBookmark,
  removeBookmark,
  fromHandle,
  fromFiles,
  fromDesktopFolder,
  droppedSources,
  access,
  errorMessage,
  type Manga,
  type Summary,
  type Settings,
  type Position,
  type Directory,
  type ScanOptions,
  type ScanState,
} from './data';
import { useImport } from './useImport';
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
const MAX_COVER_URLS = 64;
const coverUrlPool = new Map<string, string>();

export function clearCoverUrlPool(mangaId?: string): void {
  if (mangaId) {
    const existing = coverUrlPool.get(mangaId);
    if (existing) {
      try {
        URL.revokeObjectURL(existing);
      } catch {}
      coverUrlPool.delete(mangaId);
    }
  } else {
    for (const u of coverUrlPool.values()) {
      try {
        URL.revokeObjectURL(u);
      } catch {}
    }
    coverUrlPool.clear();
  }
}

onMangaDelete((id?: string) => {
  clearCoverUrlPool(id);
});

type CoverVisibleCallback = () => void;
const coverListeners = new Map<Element, CoverVisibleCallback>();
let sharedCoverObserver: IntersectionObserver | null = null;

function getSharedCoverObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!sharedCoverObserver) {
    sharedCoverObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cb = coverListeners.get(entry.target);
            if (cb) {
              coverListeners.delete(entry.target);
              sharedCoverObserver?.unobserve(entry.target);
              cb();
            }
          }
        }
      },
      { rootMargin: '100px 0px' },
    );
  }
  return sharedCoverObserver;
}

function observeCoverVisibility(el: HTMLElement, callback: CoverVisibleCallback): () => void {
  const observer = getSharedCoverObserver();
  if (!observer) {
    callback();
    return () => {};
  }
  coverListeners.set(el, callback);
  observer.observe(el);
  return () => {
    coverListeners.delete(el);
    observer.unobserve(el);
  };
}

export const Cover = memo(function Cover({ m }: { m: Pick<Summary, 'id'> }) {
  const [url, setUrl] = useState<string>(() => coverUrlPool.get(m.id) || '');
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const cached = coverUrlPool.get(m.id);
    if (cached) {
      setUrl(cached);
      return;
    }

    if (!host.current) return;

    const unobserve = observeCoverVisibility(host.current, () => {
      if (desktopAPI.isDesktop && desktopAPI.getThumbnailUrl) {
        desktopAPI
          .getThumbnailUrl(m.id)
          .then((thumbUrl) => {
            if (!live) return;
            if (thumbUrl) {
              setUrl(thumbUrl);
              return;
            }
            loadCoverBlob();
          })
          .catch(() => {
            if (live) loadCoverBlob();
          });
        return;
      }
      loadCoverBlob();

      function loadCoverBlob() {
        void getCover(m.id)
          .then((blob) => {
            if (!live || !blob) return;
            let objectUrl = coverUrlPool.get(m.id);
            if (!objectUrl) {
              if (coverUrlPool.size >= MAX_COVER_URLS) {
                const oldestKey = coverUrlPool.keys().next().value;
                if (oldestKey) clearCoverUrlPool(oldestKey);
              }
              objectUrl = URL.createObjectURL(blob);
              coverUrlPool.set(m.id, objectUrl);
            }
            setUrl(objectUrl);
          })
          .catch(() => {});
      }
    });

    return () => {
      live = false;
      unobserve();
    };
  }, [m.id]);

  return (
    <div ref={host} className="cover">
      {url ? <img src={url} alt="" /> : <BookOpen size={24} />}
    </div>
  );
});
function positionCardMenu(details: HTMLDetailsElement) {
  const rect = details.getBoundingClientRect();
  const popover = details.querySelector<HTMLElement>('.menu-popover');
  const popoverHeight = popover ? popover.offsetHeight || 195 : 195;
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;
  if (spaceBelow < popoverHeight && spaceAbove > spaceBelow) {
    details.classList.add('popover-top');
  } else {
    details.classList.remove('popover-top');
  }
}

function formatAddedDate(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

function formatWholeDate(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

function CalendarIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="2"
      className={className}
      aria-hidden="true"
    >
      <path d="M16 2v4M8 2v4m13 8v-2c0-3.771 0-5.657-1.172-6.828S16.771 4 13 4h-2C7.229 4 5.343 4 4.172 5.172S3 8.229 3 12v2c0 3.771 0 5.657 1.172 6.828S7.229 22 11 22h2M3 10h18m-3.5 5v7m3.5-3.5h-7" />
    </svg>
  );
}

function UploadIcon({
  className,
  size = 24,
  strokeWidth = 2,
}: {
  className?: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={strokeWidth}
      color="currentColor"
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
    >
      <path d="M14 21.5h-4c-3.288 0-4.931 0-6.038-.908a4 4 0 0 1-.554-.554C2.5 18.93 2.5 17.288 2.5 14c0-3.287 0-4.931.908-6.038a4 4 0 0 1 .554-.554C5.07 6.5 6.712 6.5 10 6.5h4c3.287 0 4.931 0 6.038.908q.304.25.554.554c.908 1.107.908 2.75.908 6.038s0 4.931-.908 6.038a4 4 0 0 1-.554.554c-1.107.908-2.75.908-6.038.908" />
      <path d="M2.5 14.5v-4c0-3.771 0-5.657 1.172-6.828S6.729 2.5 10.5 2.5h3c3.771 0 5.657 0 6.828 1.172S21.5 6.729 21.5 10.5v4" />
      <path d="M15 13.5s-2.21-3-3-3-3 3-3 3m3-2.5v6.5" />
    </svg>
  );
}

function DateTooltip({ timestamp, children }: { timestamp?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const badgeRef = useRef<HTMLDivElement>(null);

  const showTooltip = () => {
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      if (rect.top < 44) {
        setPlacement('bottom');
      } else {
        setPlacement('top');
      }
      if (rect.left + 260 > window.innerWidth) {
        setAlign('right');
      } else {
        setAlign('left');
      }
    }
    setOpen(true);
  };

  const hideTooltip = () => {
    setOpen(false);
  };

  const wholeDate = formatWholeDate(timestamp);

  return (
    <div
      ref={badgeRef}
      className="manga-card-date-badge"
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onClick={(e) => e.stopPropagation()}
      tabIndex={0}
      role="note"
      aria-label={wholeDate ? `Manga was added on ${wholeDate}` : undefined}
    >
      {children}
      {open && wholeDate && (
        <div className={`space-tooltip tooltip-${placement} tooltip-align-${align}`} role="tooltip">
          Manga was added on {wholeDate}
        </div>
      )}
    </div>
  );
}

export const shelfCollator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortLibraryEntries(
  library: readonly Summary[],
  shelfSort: Settings['shelfSort'] = 'recent',
): Summary[] {
  return [...library].sort((a, b) => {
    const byTitle = shelfCollator.compare(a.title, b.title);
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
      shelfCollator.compare(a.id, b.id)
    );
  });
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
  const sortedLibrary = useMemo(() => sortLibraryEntries(library, shelfSort), [library, shelfSort]);
  const [drag, setDrag] = useState(false);
  const [needs, setNeeds] = useState<Set<string>>(new Set());
  const [supported, setSupported] = useState(false);
  const [removeId, setRemoveId] = useState<string>();
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const nav = useNavigate();

  useEffect(() => {
    let live = true;
    function updateBookmarkedIds() {
      void getMangaBookmarkedIds().then((ids) => {
        if (live) setBookmarkedIds(ids);
      });
    }
    updateBookmarkedIds();
    const onSync = (e: MessageEvent) => {
      if (e.data?.type === 'progress') updateBookmarkedIds();
    };
    syncChannel?.addEventListener('message', onSync);
    return () => {
      live = false;
      syncChannel?.removeEventListener('message', onSync);
    };
  }, [library]);

  async function toggleMangaBookmark(m: Summary, e: React.MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    const isBookmarked = bookmarkedIds.has(m.id);
    try {
      const manga = await getManga(m.id);
      if (!manga) return;
      if (isBookmarked) {
        let removedMangaBookmark = false;
        for (const ch of manga.chapters) {
          for (const b of ch.bookmarks || []) {
            if (b.mangaBookmark) {
              await removeBookmark(m.id, ch.name, b);
              removedMangaBookmark = true;
            }
          }
        }
        if (!removedMangaBookmark) {
          for (const ch of manga.chapters) {
            for (const b of ch.bookmarks || []) {
              await removeBookmark(m.id, ch.name, b);
            }
          }
        }
        setBookmarkedIds((prev) => {
          const next = new Set(prev);
          next.delete(m.id);
          return next;
        });
        await refresh();
        notify(`Bookmark removed.`);
      } else {
        const ch = manga.chapters[0];
        if (ch) {
          const pagePath = ch.pages[0]?.path;
          const pos: Position = {
            page: 0,
            fraction: 0,
            path: pagePath,
            mangaBookmark: true,
            timestamp: Date.now(),
          };
          await addBookmark(m.id, ch.name, pos);
          setBookmarkedIds((prev) => new Set(prev).add(m.id));
          await refresh();
          notify(`Bookmarked ${m.title}.`);
        }
      }
    } catch (err) {
      notify(errorMessage(err));
    }
  }
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
    function reposition() {
      document.querySelectorAll<HTMLDetailsElement>('.card-menu[open]').forEach(positionCardMenu);
    }
    document.addEventListener('pointerdown', dismiss, true);
    document.addEventListener('click', dismiss, true);
    document.addEventListener('keydown', dismiss);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', dismiss, true);
      document.removeEventListener('click', dismiss, true);
      document.removeEventListener('keydown', dismiss);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
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
                <UploadIcon size={29} strokeWidth={1.5} />
              </span>
              <h2>{drag ? 'Drop your stories here' : 'Make room for a good story'}</h2>
              <p>Drop manga folders here, or choose your files.</p>
              <div className="upload-buttons">
                <button className="browse-button" onClick={() => void pick()}>
                  Choose a folder <UploadIcon size={16} />
                </button>
                <button className="secondary support-button" onClick={() => setSupported(true)}>
                  <Info size={16} /> What’s supported
                </button>
              </div>
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
                <div
                  className="manga-open"
                  role="button"
                  tabIndex={0}
                  onClick={() =>
                    void getManga(m.id)
                      .then((latest) => {
                        if (latest) nav(mangaPath(latest));
                      })
                      .catch((error) => notify(errorMessage(error)))
                  }
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      void getManga(m.id)
                        .then((latest) => {
                          if (latest) nav(mangaPath(latest));
                        })
                        .catch((error) => notify(errorMessage(error)));
                    }
                  }}
                  aria-label={(m.hasProgress ? 'Continue reading ' : 'Start reading ') + m.title}
                >
                  <div className="manga-card-left">
                    <Cover m={m} />
                  </div>
                  <div className="manga-card-right">
                    <div className="manga-card-right-top">
                      <div className="manga-card-title-row">
                        <h3 title={m.title}>{m.title}</h3>
                        <span className="manga-card-counter">
                          {m.chaptersRead} / {m.chapterCount}
                        </span>
                      </div>
                      <div className="reading-progress">
                        <span
                          style={{
                            width: (100 * m.chaptersRead) / Math.max(1, m.chapterCount) + '%',
                          }}
                        />
                      </div>
                    </div>
                    <div className="manga-card-right-bottom">
                      <DateTooltip timestamp={m.addedAt}>
                        <CalendarIcon className="manga-card-calendar-icon" />
                        <span className="manga-card-date">{formatAddedDate(m.addedAt)}</span>
                      </DateTooltip>
                      <button
                        type="button"
                        className={
                          'manga-bookmark-btn' + (bookmarkedIds.has(m.id) ? ' bookmarked' : '')
                        }
                        onClick={(e) => void toggleMangaBookmark(m, e)}
                        title={bookmarkedIds.has(m.id) ? 'Remove bookmark' : 'Bookmark this title'}
                        aria-label={
                          bookmarkedIds.has(m.id) ? 'Remove bookmark' : 'Bookmark this title'
                        }
                        aria-pressed={bookmarkedIds.has(m.id)}
                      >
                        <Bookmark
                          size={16}
                          fill={bookmarkedIds.has(m.id) ? 'currentColor' : 'none'}
                        />
                      </button>
                    </div>
                  </div>
                </div>
                <div className="manga-card-bottom">
                  {needs.has(m.id) ? (
                    <button
                      type="button"
                      className="relink-needed-btn"
                      onClick={async (e) => {
                        e.stopPropagation();
                        try {
                          const allowed = await access(m, true);
                          if (allowed) {
                            setNeeds((prev) => {
                              const next = new Set(prev);
                              next.delete(m.id);
                              return next;
                            });
                            await refresh();
                            return;
                          }
                        } catch {
                          // Fall through to folder picker
                        }
                        void pick(m);
                      }}
                      title="Grant access or re-link folder"
                    >
                      Re-link needed
                    </button>
                  ) : (
                    <Link
                      className="manga-info-btn"
                      to={mangaDetailsPath(m)}
                      aria-label={'Info for ' + m.title}
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="18"
                        height="18"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        color="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <path d="M12 16v-4m.125-3.75H12m.25 0a.25.25 0 1 0-.5 0 .25.25 0 0 0 .5 0" />
                      </svg>
                      <span>Info</span>
                    </Link>
                  )}
                  <details
                    className="card-menu"
                    onToggle={(e) => {
                      if (e.currentTarget.open) {
                        positionCardMenu(e.currentTarget);
                      }
                    }}
                  >
                    <summary
                      aria-label={'Options for ' + m.title}
                      onPointerDown={(e) => {
                        const details = e.currentTarget.closest<HTMLDetailsElement>('details');
                        if (details) positionCardMenu(details);
                      }}
                    >
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
                      {needs.has(m.id) && (
                        <button onClick={() => void pick(m)}>
                          <FolderSync size={16} /> Re-link / re-index
                        </button>
                      )}
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
                      <button
                        className="danger-text"
                        onClick={() => {
                          if (settings.confirmDelete) {
                            setRemoveId(m.id);
                          } else {
                            void deleteManga(m.id)
                              .then(refresh)
                              .then(() => notify('Manga removed.'))
                              .catch((e) => notify(errorMessage(e)));
                          }
                        }}
                      >
                        <Trash2 size={16} /> Remove
                      </button>
                    </div>
                  </details>
                </div>
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
        className="confirm-modal"
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
      void desktopAPI.recordOpenedRoot?.(folderPath);
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
