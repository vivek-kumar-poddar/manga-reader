import { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BookOpen,
  BookMarked,
  Settings as Gear,
  X,
  LoaderCircle,
  Info,
  Bookmark,
} from 'lucide-react';
import { BookmarkShelf } from '../Bookmarks';
import Dropdown from '../Dropdown';
import DailyWelcome from '../DailyWelcome';
import { mangaPath, mangaDetailsPath } from '../paths';
import { SupportedDialog, Modal } from '../ImportDialogs';
import { APP_VERSION } from '../updates';
import { desktopAPI } from '../tauriBridge';
import {
  getManga,
  deleteManga,
  saveManga,
  getMangaBookmarkedIds,
  addBookmark,
  removeBookmark,
  access,
  syncChannel,
  errorMessage,
  type Summary,
  type Settings,
  type Position,
  type ScanState,
} from '../data';
import { useApp } from './AppContext';
import { IconButton } from './IconButton';
import { ThemeButton } from './ThemeButton';
import { Cover } from './Cover';
import { CardMenu } from './CardMenu';
import { DateTooltip, formatAddedDate } from './DateTooltip';
import { CalendarIcon, UploadIcon, AddMangaIcon } from './Icons';

export function Library({
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
  const [sortedIds, setSortedIds] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    const payload = library.map((m) => ({
      id: m.id,
      title: m.title,
      addedAt: m.addedAt,
      updatedAt: m.updatedAt,
      chaptersRead: m.chaptersRead,
      chapterCount: m.chapterCount,
    }));
    void desktopAPI
      .sortLibraryEntries(payload, shelfSort)
      .then((ids) => {
        if (live) setSortedIds(ids);
      })
      .catch(() => {
        if (live) setSortedIds(library.map((m) => m.id));
      });
    return () => {
      live = false;
    };
  }, [library, shelfSort]);

  const sortedLibrary = useMemo(() => {
    if (!sortedIds.length) return library;
    const byId = new Map(library.map((m) => [m.id, m]));
    const ordered: Summary[] = [];
    const seen = new Set<string>();
    for (const id of sortedIds) {
      const item = byId.get(id);
      if (item && !seen.has(id)) {
        seen.add(id);
        ordered.push(item);
      }
    }
    for (const item of library) {
      if (!seen.has(item.id)) {
        ordered.push(item);
      }
    }
    return ordered;
  }, [library, sortedIds]);

  const [drag, setDrag] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [needs, setNeeds] = useState<Set<string>>(new Set());
  const [supported, setSupported] = useState(false);
  const [removeId, setRemoveId] = useState<string>();
  const [bookmarkedIds, setBookmarkedIds] = useState<Set<string>>(new Set());
  const nav = useNavigate();

  const showUploadZone = library.length === 0 || uploadOpen || busy;

  useEffect(() => {
    if (library.length === 0) {
      setUploadOpen(false);
    }
  }, [library.length]);

  useEffect(() => {
    if (!showUploadZone) {
      setDrag(false);
    }
  }, [showUploadZone]);

  useEffect(() => {
    let live = true;
    function updateBookmarkedIds() {
      void getMangaBookmarkedIds().then((ids) => {
        if (live) setBookmarkedIds(ids);
      });
    }
    updateBookmarkedIds();
    const onSync = (e: MessageEvent) => {
      if (e.data?.type === 'progress' || e.data?.type === 'library') updateBookmarkedIds();
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
        for (const ch of manga.chapters) {
          for (const b of ch.bookmarks || []) {
            if (b.mangaBookmark) {
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
        notify('Bookmark removed.');
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
    await saveManga({
      ...m,
      chapters: m.chapters.map((c) => ({
        ...c,
        read,
        ...(read ? {} : { position: undefined }),
      })),
    });
    await refresh();
  }

  async function remove() {
    if (!removeId) return;
    await deleteManga(removeId);
    setRemoveId(undefined);
    await refresh();
    notify('Manga removed.');
  }

  return (
    <>
      <div className="header-wrap">
        <header className="library-header">
          <Link to="/" className="brand">
            <BookOpen size={23} strokeWidth={1.5} />
            <span>
              Reader<span className="brand-period">.</span>
            </span>
          </Link>
          <div className="header-actions">
            <Link className="btn icon" to="/bookmarks" aria-label="Bookmarks" title="Bookmarks">
              <BookMarked size={19} />
            </Link>
            <ThemeButton />
            <IconButton label="Settings" onClick={openSettings}>
              <Gear size={19} />
            </IconButton>
          </div>
        </header>
      </div>
      <main className="library-main">
        <div className="page-heading library-page-heading">
          <div>
            <h1>Your library</h1>
            <DailyWelcome />
          </div>
          {library.length > 0 && (
            <button
              type="button"
              className={'btn blue' + (uploadOpen ? ' is-open' : '')}
              aria-expanded={showUploadZone}
              aria-controls={showUploadZone ? 'library-upload-zone' : undefined}
              disabled={busy}
              onClick={() => setUploadOpen((prev) => !prev)}
            >
              {uploadOpen ? (
                <>
                  <X size={18} aria-hidden="true" />
                  <span>Close Upload</span>
                </>
              ) : (
                <>
                  <AddMangaIcon />
                  <span>Add New Manga</span>
                </>
              )}
            </button>
          )}
        </div>
        {showUploadZone && (
          <div
            id="library-upload-zone"
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
              if (!busy && !desktopAPI.isDesktop) drop(Array.from(e.dataTransfer.items));
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
                <button className="btn secondary" onClick={cancel}>
                  Cancel import
                </button>
              </>
            ) : (
              <>
                <h2 className="upload-area-title">
                  {drag ? 'Drop your stories here' : 'Make room for a good story'}
                </h2>
                <p>Drop manga folders here, or choose your files.</p>
                <div className="upload-buttons">
                  <button className="btn blue" onClick={() => void pick()}>
                    Choose a folder <UploadIcon size={16} />
                  </button>
                  <button className="btn secondary" onClick={() => setSupported(true)}>
                    <Info size={16} /> What’s supported
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {library.length > 0 && (
          <>
            <BookmarkShelf carousel />
            <div className="shelf-toolbar">
              <div className="collection-heading">
                <h2>
                  {library.length === 1
                    ? '1 manga on your shelf.'
                    : `${library.length} manga on your shelf.`}
                </h2>
                <span>Saved on this device</span>
              </div>
              {library.length > 1 && (
                <label className="shelf-sort">
                  <Dropdown
                    aria-label="Sort manga shelf"
                    value={shelfSort}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        shelfSort: e.target.value as Settings['shelfSort'],
                      })
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
            <div className="manga-grid">
              {sortedLibrary.map((m) => {
                const openManga = () =>
                  void getManga(m.id)
                    .then((latest) => {
                      if (latest) nav(mangaPath(latest));
                    })
                    .catch((error) => notify(errorMessage(error)));

                return (
                  <article className="manga-card" key={m.id}>
                    <div
                      className="manga-card-left"
                      role="button"
                      tabIndex={-1}
                      aria-hidden="true"
                      onClick={openManga}
                    >
                      <Cover m={m} size={512} />
                    </div>
                    <div className="manga-card-right">
                      <div
                        className="manga-open"
                        role="button"
                        tabIndex={0}
                        onClick={openManga}
                        onKeyDown={(e) => {
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            openManga();
                          }
                        }}
                        aria-label={
                          (m.hasProgress ? 'Continue reading ' : 'Start reading ') + m.title
                        }
                      >
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
                              'btn icon manga-bookmark-btn' +
                              (bookmarkedIds.has(m.id) ? ' bookmarked' : '')
                            }
                            onClick={(e) => void toggleMangaBookmark(m, e)}
                            title={
                              bookmarkedIds.has(m.id) ? 'Remove bookmark' : 'Bookmark this title'
                            }
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
                      <div className="manga-card-bottom">
                        {needs.has(m.id) ? (
                          <button
                            type="button"
                            className="btn relink-needed-btn"
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
                            className="btn icon manga-info-btn"
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
                        <CardMenu
                          title={m.title}
                          needsRelink={needs.has(m.id)}
                          onRelink={() => void pick(m)}
                          onMarkRead={() =>
                            void mark(m.id, true).catch((e) => notify(errorMessage(e)))
                          }
                          onMarkUnread={() =>
                            void mark(m.id, false).catch((e) => notify(errorMessage(e)))
                          }
                          onRemove={() => {
                            if (settings.confirmDelete) {
                              setRemoveId(m.id);
                            } else {
                              void deleteManga(m.id)
                                .then(refresh)
                                .then(() => notify('Manga removed.'))
                                .catch((e) => notify(errorMessage(e)));
                            }
                          }}
                        />
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
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
            className="btn delete"
            onClick={() => void remove().catch((e) => notify(errorMessage(e)))}
          >
            Remove title
          </button>
          <button className="btn secondary" onClick={() => setRemoveId(undefined)}>
            Cancel
          </button>
        </div>
      </Modal>
    </>
  );
}
