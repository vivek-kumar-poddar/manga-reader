import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpen,
  BookMarked,
  ChevronLeft,
  ChevronRight,
  Home,
  Settings,
  Trash2,
} from 'lucide-react';
import { useApp, ThemeButton, IconButton } from './App';
import Dropdown from './Dropdown';
import { Modal } from './ImportDialogs';
import {
  getBookmarkedMangaIds,
  removeBookmark,
  getManga,
  fileFor,
  access,
  errorMessage,
  syncChannel,
  type Manga,
  type Position,
} from './data';
import { mangaPath } from './paths';
import { APP_VERSION } from './updates';

type Mark = { manga: Manga; chapter: number; position: Position };
type BookmarkTab = 'all' | 'manga' | 'individual';
type BookmarkSort = 'newest' | 'oldest' | 'title-asc' | 'title-desc' | 'chapter';
const key = (b: Mark) =>
  b.manga.id +
  '/' +
  b.chapter +
  '/' +
  (b.position.mangaBookmark ? 'manga' : b.position.path || b.position.page);
function Thumbnail({ mark }: { mark: Mark }) {
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    let live = true,
      url = '';
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0].isIntersecting) return;
        observer.disconnect();
        void (async () => {
          let blob = mark.manga.cover;
          const page = mark.manga.chapters[mark.chapter]?.pages?.[mark.position.page];
          try {
            if (!blob && page && (await access(mark.manga))) {
              blob = await fileFor(mark.manga, page);
            } else if (page && !mark.position.mangaBookmark && (await access(mark.manga))) {
              blob = await fileFor(mark.manga, page);
            }
          } catch {
            /* A saved cover remains available without folder permission. */
          }
          if (live && blob) {
            url = URL.createObjectURL(blob);
            setUrl(url);
          }
        })();
      },
      { rootMargin: '100px' },
    );
    if (host.current) observer.observe(host.current);
    return () => {
      live = false;
      observer.disconnect();
      if (url) URL.revokeObjectURL(url);
    };
  }, [mark]);
  return (
    <div className="bookmark-thumbnail" ref={host}>
      {url ? (
        <img
          src={url}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setUrl('')}
        />
      ) : (
        <BookOpen size={30} />
      )}
    </div>
  );
}
export function BookmarkShelf({ carousel = false }: { carousel?: boolean }) {
  const { library, notify, settings } = useApp();
  const [marks, setMarks] = useState<Mark[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [removing, setRemoving] = useState('');
  const [confirmMark, setConfirmMark] = useState<Mark | null>(null);
  const [tab, setTab] = useState<BookmarkTab>('all');
  const [sortBy, setSortBy] = useState<BookmarkSort>('newest');
  const track = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const drag = useRef<{ x: number; scroll: number; id: number; moved: boolean } | null>(null);
  const suppress = useRef(false);
  const tabInitialized = useRef(false);

  useEffect(() => {
    let live = true;
    function loadBookmarks() {
      setLoading(true);
      void (async () => {
        const ids = await getBookmarkedMangaIds();
        const result: Mark[] = [];
        for (const item of library) {
          if (!ids.has(item.id)) continue;
          const manga = await getManga(item.id);
          if (!manga) continue;
          for (let i = 0; i < manga.chapters.length; i++)
            for (const position of manga.chapters[i].bookmarks || [])
              result.push({ manga, chapter: i, position });
        }
        if (live) {
          setMarks(result);
          setError('');
        }
      })()
        .catch((e) => {
          if (live) setError(errorMessage(e));
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }
    loadBookmarks();
    const onSync = (e: MessageEvent) => {
      if (e.data?.type === 'progress') loadBookmarks();
    };
    syncChannel?.addEventListener('message', onSync);
    return () => {
      live = false;
      syncChannel?.removeEventListener('message', onSync);
    };
  }, [library]);

  const mangaMarks = marks.filter((m) => Boolean(m.position.mangaBookmark));
  const individualMarks = marks.filter((m) => !m.position.mangaBookmark);

  function getSortedMarks(items: Mark[], sort: BookmarkSort): Mark[] {
    const list = [...items];
    switch (sort) {
      case 'newest':
        return list.sort((a, b) => {
          const timeA = a.position.timestamp || a.manga.updatedAt || a.manga.addedAt || 0;
          const timeB = b.position.timestamp || b.manga.updatedAt || b.manga.addedAt || 0;
          return timeB - timeA;
        });
      case 'oldest':
        return list.sort((a, b) => {
          const timeA = a.position.timestamp || a.manga.addedAt || a.manga.updatedAt || 0;
          const timeB = b.position.timestamp || b.manga.addedAt || b.manga.updatedAt || 0;
          return timeA - timeB;
        });
      case 'title-asc':
        return list.sort((a, b) => {
          const cmp = a.manga.title.localeCompare(b.manga.title, undefined, {
            sensitivity: 'base',
            numeric: true,
          });
          if (cmp !== 0) return cmp;
          return a.chapter - b.chapter || a.position.page - b.position.page;
        });
      case 'title-desc':
        return list.sort((a, b) => {
          const cmp = b.manga.title.localeCompare(a.manga.title, undefined, {
            sensitivity: 'base',
            numeric: true,
          });
          if (cmp !== 0) return cmp;
          return a.chapter - b.chapter || a.position.page - b.position.page;
        });
      case 'chapter':
        return list.sort((a, b) => {
          const cmp = a.manga.title.localeCompare(b.manga.title, undefined, {
            sensitivity: 'base',
            numeric: true,
          });
          if (cmp !== 0) return cmp;
          return a.chapter - b.chapter || a.position.page - b.position.page;
        });
      default:
        return list;
    }
  }

  const activeMarks = tab === 'all' ? marks : tab === 'manga' ? mangaMarks : individualMarks;
  const displayMarks = carousel ? marks : getSortedMarks(activeMarks, sortBy);

  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const update = () =>
      setEdges({
        start: el.scrollLeft <= 1,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1,
      });
    const wheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      const amount = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1);
      if (
        (amount > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) ||
        (amount < 0 && el.scrollLeft > 1)
      ) {
        e.preventDefault();
        el.scrollLeft += amount;
      }
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(el);
    el.addEventListener('scroll', update, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      resize.disconnect();
      el.removeEventListener('scroll', update);
      el.removeEventListener('wheel', wheel);
    };
  }, [carousel, loading, marks]);

  async function remove(mark: Mark) {
    const id = key(mark);
    setRemoving(id);
    try {
      await removeBookmark(mark.manga.id, mark.manga.chapters[mark.chapter].name, mark.position);
      setMarks((items) => items.filter((b) => key(b) !== id));
      notify('Bookmark removed.');
    } catch (e) {
      notify(errorMessage(e));
    } finally {
      setRemoving('');
    }
  }

  const move = (direction: number) => {
    const el = track.current;
    if (el)
      el.scrollBy({
        left: direction * Math.max(180, el.clientWidth * 0.8),
        behavior:
          settings.reduced || matchMedia('(prefers-reduced-motion: reduce)').matches
            ? 'instant'
            : 'smooth',
      });
  };

  if (loading) return carousel ? null : <p className="subtle">Loading bookmarks…</p>;
  if (error) return <p role="alert">{error}</p>;
  if (!marks.length)
    return carousel ? null : (
      <div className="empty-shelf">
        <BookMarked size={28} />
        <p>No bookmarks yet.</p>
        <span>Bookmark a manga from your shelf or a page while reading to keep it here.</span>
        <Link className="secondary no-bookmark-browse-btn" to="/">
          Browse your library
        </Link>
      </div>
    );

  const cards = displayMarks.map((mark) => {
    const isMangaBookmark = Boolean(mark.position.mangaBookmark);
    return (
      <article className="bookmark-card" key={key(mark)}>
        <Link
          className="bookmark-open"
          draggable={false}
          to={
            mangaPath(mark.manga, mark.chapter) +
            '?' +
            new URLSearchParams({
              page: String(mark.position.page + 1),
              offset: String(mark.position.fraction),
            })
          }
        >
          <Thumbnail mark={mark} />
          <div className="bookmark-caption">
            <h3 title={mark.manga.title}>{mark.manga.title}</h3>
            <div className="bookmark-caption-bottom">
              {isMangaBookmark ? (
                <span className="bookmark-page-number">Manga Bookmarked</span>
              ) : (
                <>
                  <p title={mark.manga.chapters[mark.chapter].name}>
                    {mark.manga.chapters[mark.chapter].name}
                  </p>
                  <span className="bookmark-page-number">Page {mark.position.page + 1}</span>
                </>
              )}
            </div>
          </div>
        </Link>
        <button
          className="icon-button bookmark-remove"
          disabled={removing === key(mark)}
          aria-label={
            isMangaBookmark
              ? 'Remove bookmark: ' + mark.manga.title + ' (Manga Bookmarked)'
              : 'Remove bookmark: ' +
                mark.manga.title +
                ', ' +
                mark.manga.chapters[mark.chapter].name +
                ', page ' +
                (mark.position.page + 1)
          }
          title="Remove bookmark"
          onClick={() => {
            if (settings.confirmDelete) {
              setConfirmMark(mark);
            } else {
              void remove(mark);
            }
          }}
        >
          <Trash2 size={16} />
        </button>
      </article>
    );
  });

  const modal = (
    <Modal
      open={!!confirmMark}
      onClose={() => setConfirmMark(null)}
      title="Remove this bookmark?"
      className="confirm-modal"
      description={
        confirmMark?.position.mangaBookmark
          ? `Remove manga bookmark for “${confirmMark.manga.title}”?`
          : `Remove bookmark for “${confirmMark?.manga.title}” (${confirmMark?.manga.chapters[confirmMark.chapter]?.name || ''}, Page ${(confirmMark?.position.page ?? 0) + 1})?`
      }
    >
      <div className="button-row">
        <button
          className="secondary danger-text"
          onClick={() => {
            if (confirmMark) {
              const target = confirmMark;
              setConfirmMark(null);
              void remove(target);
            }
          }}
        >
          Remove bookmark
        </button>
        <button className="secondary" onClick={() => setConfirmMark(null)}>
          Cancel
        </button>
      </div>
    </Modal>
  );

  if (carousel) {
    return (
      <>
        <section className="bookmark-section" aria-label="Saved bookmarks">
          <div className="bookmark-section-heading">
            <h2>Your bookmarks</h2>
            <div className="bookmark-navigation">
              <Link to="/bookmarks">View all</Link>
              <button
                className="icon-button"
                aria-label="Previous bookmarks"
                disabled={edges.start}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label="Next bookmarks"
                disabled={edges.end}
                onClick={() => move(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
          <div
            className="bookmark-track"
            ref={track}
            tabIndex={0}
            aria-label="Bookmarks carousel"
            onKeyDown={(e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === 'ArrowLeft' || e.key === 'ArrowRight')
              ) {
                e.preventDefault();
                move(e.key === 'ArrowLeft' ? -1 : 1);
              }
            }}
            onPointerDown={(e) => {
              suppress.current = false;
              if (
                e.pointerType === 'mouse' &&
                e.button === 0 &&
                !(e.target as Element).closest('button')
              )
                drag.current = {
                  x: e.clientX,
                  scroll: e.currentTarget.scrollLeft,
                  id: e.pointerId,
                  moved: false,
                };
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const distance = e.clientX - d.x;
              if (!d.moved && Math.abs(distance) > 5) {
                d.moved = true;
                e.currentTarget.setPointerCapture(d.id);
              }
              if (d.moved) {
                e.currentTarget.scrollLeft = d.scroll - distance;
                suppress.current = true;
              }
            }}
            onPointerLeave={() => {
              if (!drag.current?.moved) drag.current = null;
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
              suppress.current = false;
            }}
            onClickCapture={(e) => {
              if (suppress.current) {
                e.preventDefault();
                e.stopPropagation();
                suppress.current = false;
              }
            }}
            onDragStart={(e) => e.preventDefault()}
          >
            {cards}
          </div>
        </section>
        {modal}
      </>
    );
  }

  return (
    <>
      <section className="bookmarks-page-content" aria-label="Saved bookmarks">
        <div className="bookmarks-toolbar">
          <div className="bookmark-tabs" role="tablist" aria-label="Bookmark sections">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'all'}
              className="bookmark-tab-button"
              onClick={() => setTab('all')}
            >
              <span>All</span>
              <span className="bookmark-tab-count">{marks.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'manga'}
              className="bookmark-tab-button"
              onClick={() => setTab('manga')}
            >
              <span>Manga</span>
              <span className="bookmark-tab-count">{mangaMarks.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'individual'}
              className="bookmark-tab-button"
              onClick={() => setTab('individual')}
            >
              <span>Manga Chapters</span>
              <span className="bookmark-tab-count">{individualMarks.length}</span>
            </button>
          </div>
          {activeMarks.length > 0 && (
            <label className="shelf-sort bookmark-sort">
              <span>Sort by</span>
              <Dropdown
                aria-label="Sort bookmarks"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as BookmarkSort)}
              >
                <option value="newest">Newest added</option>
                <option value="oldest">Oldest added</option>
                <option value="title-asc">Title A–Z</option>
                <option value="title-desc">Title Z–A</option>
                <option value="chapter">Chapter / Page</option>
              </Dropdown>
            </label>
          )}
        </div>

        {activeMarks.length === 0 ? (
          <div className="empty-shelf">
            <BookMarked size={28} />
            <p>
              {tab === 'all'
                ? 'No bookmarks yet.'
                : tab === 'manga'
                  ? 'No manga bookmarks yet.'
                  : 'No chapter bookmarks yet.'}
            </p>
            <span>
              {tab === 'all'
                ? 'Click the bookmark icon on any manga card on your shelf, or bookmark pages while reading.'
                : tab === 'manga'
                  ? 'Click the bookmark icon on any manga card on your shelf to bookmark the title.'
                  : 'Bookmark pages while reading in the reader to keep them here.'}
            </span>
            <Link className="secondary no-bookmark-browse-btn" to="/">
              Browse your library
            </Link>
          </div>
        ) : (
          <div className="bookmark-grid">{cards}</div>
        )}
      </section>
      {modal}
    </>
  );
}

export default function BookmarksPage() {
  const { openSettings } = useApp();
  return (
    <>
      <header className="library-header">
        <Link to="/" className="brand">
          <BookOpen size={23} />
          <span>Reader.</span>
        </Link>
        <div className="header-actions">
          <Link className="icon-button" to="/" aria-label="Home" title="Home">
            <Home size={19} />
          </Link>
          <ThemeButton />
          <IconButton label="Settings" onClick={openSettings}>
            <Settings size={19} />
          </IconButton>
        </div>
      </header>
      <main className="library-main">
        <div className="page-heading">
          <div>
            <h1>Your bookmarks</h1>
            <span className="subtle">Saved manga and reading positions</span>
          </div>
        </div>
        <BookmarkShelf />
        <footer className="library-footer">
          <span>By Vivek Kr. Poddar · v{APP_VERSION}</span>
          <Link to="/">Back to your library</Link>
        </footer>
      </main>
    </>
  );
}
