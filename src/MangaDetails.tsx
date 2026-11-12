import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Cover, ThemeButton, useApp } from './App';
import Dropdown from './Dropdown';
import { getManga, errorMessage, type Manga } from './data';
import { mangaPath } from './paths';

type ChapterSort = 'first' | 'last' | 'unread';

export default function MangaDetails() {
  const { slug } = useParams();
  const nav = useNavigate();
  const { library } = useApp();
  const summary = library.find((entry) => entry.slug === slug);
  const [manga, setManga] = useState<Manga>();
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState('');
  const [sort, setSort] = useState<ChapterSort>('first');
  const [chapterQuery, setChapterQuery] = useState('');
  const [retry, setRetry] = useState(0);

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
        }
      } catch (error) {
        if (live && request === revision) setFailure(errorMessage(error));
      } finally {
        if (live && request === revision) setLoading(false);
      }
    };
    const visible = () => {
      if (!document.hidden) void load();
    };
    void load();
    window.addEventListener('focus', visible);
    document.addEventListener('visibilitychange', visible);
    return () => {
      live = false;
      window.removeEventListener('focus', visible);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [summary, retry]);

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
    <main className="manga-details">
      <nav className="manga-details-nav" aria-label="Manga navigation">
        <Link to="/">← Library</Link>
        <ThemeButton />
      </nav>
      {loading ? (
        <p role="status">Loading manga…</p>
      ) : failure ? (
        <div role="alert">
          {failure}{' '}
          <button className="secondary" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </div>
      ) : !manga ? (
        <h1>This title isn’t in your library.</h1>
      ) : (
        <>
          <section className="manga-overview" aria-label="Manga overview">
            <Cover m={manga} />
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
              <p className="manga-current" aria-live="polite">
                {hasProgress
                  ? `Currently reading Chapter ${manga.lastChapter + 1} · Page ${current.position!.page + 1}`
                  : 'Not started yet'}
              </p>
              <Link className="primary" to={mangaPath(manga)}>
                {hasProgress ? 'Continue reading' : 'Start reading'}
              </Link>
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
  );
}