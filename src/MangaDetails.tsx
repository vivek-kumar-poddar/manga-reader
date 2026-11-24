import { useEffect, useMemo, useState, useCallback } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { BookOpen, BookMarked, Home, Search, Settings, FolderSync } from 'lucide-react';
import { Cover, IconButton, ThemeButton, useApp } from './App';
import Dropdown from './Dropdown';
import { getManga, errorMessage, syncChannel, access, type Manga } from './data';
import { mangaPath } from './paths';

type ChapterSort = 'first' | 'last' | 'unread';

export default function MangaDetails() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { library, openSettings, relink, notify } = useApp();
  const summary = library.find((entry) => entry.slug === slug);
  const [manga, setManga] = useState<Manga>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [sort, setSort] = useState<ChapterSort>('first');
  const [chapterQuery, setChapterQuery] = useState('');
  const [retry, setRetry] = useState(0);
  const [needsRelink, setNeedsRelink] = useState(false);

  const checkFolderAccess = useCallback(
    async (target?: Manga | typeof summary) => {
      const item = target || manga || summary;
      if (!item) return;
      try {
        const allowed = await access(item);
        setNeedsRelink(!allowed);
      } catch {
        setNeedsRelink(true);
      }
    },
    [manga, summary],
  );

  useEffect(() => {
    if (slug === 'index.html') {
      nav('/', { replace: true });
    }
  }, [slug, nav]);

  useEffect(() => {
    let live = true;
    let revision = 0;
    setManga(undefined);
    setLoading(true);
    const load = async () => {
      const request = ++revision;
      try {
        const result = summary ? await getManga(summary.id) : undefined;
        if (live && request === revision) {
          setManga(result);
          setFailure('');
          if (result) void checkFolderAccess(result);
        }
      } catch (error) {
        if (live && request === revision) setFailure(errorMessage(error));
      } finally {
        if (live && request === revision) setLoading(false);
      }
    };
    const visible = () => {
      if (!document.hidden) {
        void load();
        void checkFolderAccess();
      }
    };
    const onSync = (e: MessageEvent) => {
      if (!e.data?.id || e.data.id === summary?.id) {
        void load();
        void checkFolderAccess();
      }
    };
    void load();
    void checkFolderAccess();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    syncChannel?.addEventListener('message', onSync);
    return () => {
      live = false;
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
      syncChannel?.removeEventListener('message', onSync);
    };
  }, [summary, retry, checkFolderAccess]);

  const handleRelink = async () => {
    const target = manga || summary;
    if (!target) return;
    try {
      const ok = await relink(target);
      if (ok) {
        setNeedsRelink(false);
        notify('Folder access restored.');
      }
    } catch (e) {
      notify(errorMessage(e));
    }
  };

  const chapters = useMemo(() => {
    const entries = manga?.chapters.map((chapter, index) => ({ chapter, index })) || [];
    if (sort === 'last') entries.reverse();
    if (sort === 'unread')
      entries.sort((a, b) => Number(a.chapter.read) - Number(b.chapter.read) || a.index - b.index);
    const query = chapterQuery.trim().toLowerCase();
    if (!query) return entries;
    const number = Number(query);
    return entries.filter(({ chapter, index }) => {
      if (Number.isFinite(number) && index + 1 === number) return true;
      const match = chapter.name.toLowerCase().match(/\d+(?:\.\d+)?/g);
      const numTokens: string[] = match ? Array.from(match) : [];
      return numTokens.includes(query) || chapter.name.toLowerCase().includes(query);
    });
  }, [manga, sort, chapterQuery]);

  const current = manga?.chapters[manga.lastChapter];
  const hasProgress = !!current?.position;

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
            <Link className="btn icon" to="/" aria-label="Home" title="Home">
              <Home size={19} />
            </Link>
            <Link className="btn icon" to="/bookmarks" aria-label="Bookmarks" title="Bookmarks">
              <BookMarked size={19} />
            </Link>
            <ThemeButton />
            <IconButton label="Settings" onClick={openSettings}>
              <Settings size={19} />
            </IconButton>
          </div>
        </header>
      </div>
      <main className="manga-details">
        <nav className="manga-details-nav" aria-label="Manga navigation">
          <Link to="/" className="btn secondary">
            ← Library
          </Link>
        </nav>
        {loading ? (
          <p role="status">Loading manga…</p>
        ) : failure ? (
          <div role="alert">
            {failure}{' '}
            <button className="btn secondary" onClick={() => setRetry((n) => n + 1)}>
              Retry
            </button>
          </div>
        ) : !manga ? (
          <h1>This title isn’t in your library.</h1>
        ) : (
          <>
            <section className="manga-overview" aria-label="Manga overview">
              <Cover m={manga} size={1024} />
              <div className="manga-overview-info">
                <h1>{manga.title}</h1>
                <dl className="manga-totals">
                  <div>
                    <dt>Total chapters</dt>
                    <dd>{manga.chapters.length}</dd>
                  </div>
                  <div>
                    <dt>Total pages</dt>
                    <dd>
                      {manga.chapters.reduce((total, chapter) => total + chapter.pages.length, 0)}
                    </dd>
                  </div>
                </dl>
                {needsRelink && (
                  <div className="relink-banner" role="alert">
                    <FolderSync size={20} className="relink-banner-icon" />
                    <div className="relink-banner-text">
                      <strong>Folder access needed</strong>
                      <p>Re-link folder to continue reading from your saved progress.</p>
                    </div>
                    <button type="button" className="btn primary relink-btn" onClick={handleRelink}>
                      Re-link folder
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  className="btn blue continue-reading"
                  onClick={async () => {
                    if (needsRelink) {
                      const target = manga || summary;
                      if (target) {
                        const ok = await relink(target);
                        if (ok) {
                          setNeedsRelink(false);
                          nav(mangaPath(manga));
                        }
                      }
                      return;
                    }
                    nav(mangaPath(manga));
                  }}
                >
                  {hasProgress ? (
                    <>
                      Continue from{' '}
                      <span className="text-semibold">Ch. {manga.lastChapter + 1}</span>{' '}
                      <span className="text-semibold">Pg. {current.position!.page + 1}</span>
                    </>
                  ) : (
                    'Start reading'
                  )}
                </button>
              </div>
            </section>
            <section aria-label="Chapters">
              <div className="chapter-list-heading">
                <form
                  className="chapter-search"
                  role="search"
                  aria-label="Search chapters"
                  onSubmit={(event) => event.preventDefault()}
                >
                  <Search size={18} aria-hidden="true" />
                  <input
                    type="search"
                    inputMode="numeric"
                    aria-label="Search by chapter number"
                    placeholder="Search by chapter number"
                    value={chapterQuery}
                    onChange={(event) => setChapterQuery(event.target.value)}
                  />
                </form>
                <label>
                  Sort chapters
                  <Dropdown
                    aria-label="Sort chapters"
                    value={sort}
                    onChange={(event) => setSort(event.target.value as ChapterSort)}
                  >
                    <option value="first">First chapter first</option>
                    <option value="last">Last chapter first</option>
                    <option value="unread">Unread first</option>
                  </Dropdown>
                </label>
              </div>
              {chapters.length === 0 && <p role="status">No chapter found for this number.</p>}
              <div className="chapter-grid">
                {chapters.map(({ chapter, index }) => (
                  <Link
                    className="chapter-card"
                    key={chapter.name}
                    to={mangaPath(manga, index)}
                    onClick={async (e) => {
                      if (needsRelink) {
                        e.preventDefault();
                        const target = manga || summary;
                        if (target) {
                          const ok = await relink(target);
                          if (ok) {
                            setNeedsRelink(false);
                            nav(mangaPath(manga, index));
                          }
                        }
                      }
                    }}
                    aria-current={hasProgress && index === manga.lastChapter ? 'true' : undefined}
                  >
                    <strong>{chapter.name}</strong>
                    <span>{chapter.pages.length} pages</span>
                    <small>
                      {chapter.read
                        ? 'Completed'
                        : chapter.position
                          ? `Reading · Page ${chapter.position.page + 1}`
                          : 'Not started'}
                    </small>
                  </Link>
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </>
  );
}
