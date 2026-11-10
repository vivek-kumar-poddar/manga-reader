import { mangaPath, mangaDetailsPath, chapterIndex } from './paths';
import { limits } from './limits';
import Dropdown from './Dropdown';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  computeOffsets,
  getWindowRange,
  VIRTUALIZATION_THRESHOLD,
  type PageOffset,
  type WindowRange,
} from './readerGeometry';
import { Link, useParams, useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import {
  Home,
  X,
  ChevronLeft,
  ChevronRight,
  Settings,
  Play,
  Pause,
  BookOpen,
  FolderSync,
  LoaderCircle,
  Keyboard,
  Bookmark,
  BookMarked,
  Minus,
  Plus,
  Check,
  ChevronDown,
  MoreHorizontal,
} from 'lucide-react';
import { useApp, IconButton, ThemeButton } from './App';
import { Modal } from './ImportDialogs';
import PageImage from './PageImage';
import {
  stopBackground,
  scheduleBackground,
  prepareChapter,
  access,
  getManga,
  saveProgress,
  addBookmark,
  removeBookmark,
  matchingPosition,
  errorMessage,
  clearImageQueue,
  clearObjectUrlPool,
  type Manga,
  type Position,
  type SaveProgressResult,
} from './data';
export default function Reader({
  indexing,
  indexingProgress,
  cancelImport,
}: {
  indexing: boolean;
  indexingProgress: [number, number];
  cancelImport: () => void;
}) {
  const { mangaId, slug, chapterSegment } = useParams();
  const entrySearch = useRef(useLocation().search);
  const { library, notify } = useApp();
  const id = mangaId || library.find((m) => m.slug === slug)?.id;
  const resolvedId = useRef(id);
  if (id) resolvedId.current = id;
  const stableId = resolvedId.current;
  const [manga, setManga] = useState<Manga | null>();
  useEffect(() => {
    if (indexing) return;
    let live = true;
    setManga(undefined);
    void getManga(stableId || '')
      .then((m) => {
        if (m) {
          const query = new URLSearchParams(entrySearch.current);
          const page = Number(query.get('page'));
          if (Number.isInteger(page) && page > 0) {
            const ci = chapterIndex(
              chapterSegment,
              m.chapters.length,
              mangaId ? Number(query.get('chapter') ?? m.lastChapter) : m.lastChapter,
            );
            const chapter = m.chapters[ci];
            const index = Math.min(page - 1, chapter.pages.length - 1);
            chapter.position = {
              page: index,
              path: chapter.pages[index]?.path,
              fraction: Math.max(0, Math.min(1, Number(query.get('offset')) || 0)),
            };
          }
        }
        if (live) setManga(m || null);
      })
      .catch((e) => {
        notify(errorMessage(e));
        if (live) setManga(null);
      });
    return () => {
      live = false;
    };
  }, [stableId, indexing]);
  if (indexing)
    return (
      <main className="reader-gate">
        <LoaderCircle className="spin" />
        <h1>
          {indexingProgress[0]} / {indexingProgress[1] || '…'}
        </h1>
        <p>Updating your folder index. Saved reading progress is preserved.</p>
        <button className="secondary" onClick={cancelImport}>
          Cancel import
        </button>
      </main>
    );
  if (manga === undefined)
    return (
      <main className="reader-gate">
        <LoaderCircle className="spin" />
        <p>Opening your pages…</p>
      </main>
    );
  if (!manga)
    return (
      <main className="reader-gate">
        <BookOpen size={32} />
        <h1>This title isn’t in your library.</h1>
        <Link className="primary" to="/">
          Back to library
        </Link>
      </main>
    );
  return <ReaderView key={manga.id + ':' + manga.updatedAt} manga={manga} />;
}
type Offset = PageOffset;
function ReaderView({ manga }: { manga: Manga }) {
  const [params] = useSearchParams();
  const { chapterSegment, mangaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { settings: s, setSettings, openSettings, notify, pick, refresh } = useApp();
  const ci = chapterIndex(
    chapterSegment,
    manga.chapters.length,
    mangaId ? Number(params.get('chapter') ?? manga.lastChapter) : manga.lastChapter,
  );
  const chapter = manga.chapters[ci];
  useEffect(() => {
    const canonical = mangaPath(manga, ci);
    if (location.pathname !== canonical || location.search) navigate(canonical, { replace: true });
  }, [manga.slug, ci, location.pathname, location.search, navigate]);
  const [allowed, setAllowed] = useState<boolean | null>(null),
    [playing, setPlaying] = useState(false),
    [bars, setBars] = useState({ top: true, bottom: true }),
    [page, setPage] = useState(0),
    [ready, setReady] = useState(false),
    [zoom, setZoom] = useState(1),
    [wide, setWide] = useState(matchMedia('(min-width:700px)').matches),
    [shortcuts, setShortcuts] = useState(false),
    [bookmarkRevision, setBookmarkRevision] = useState(0),
    [failure, setFailure] = useState(''),
    [ended, setEnded] = useState(false),
    [readRevision, setReadRevision] = useState(0);
  const [prepared, setPrepared] = useState(
    chapter.pages.some((p) => p.dimensionsPending) ? -1 : ci,
  );
  const [preparation, setPreparation] = useState({ done: 0, total: 0 });
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const retryPreparation = () => setPreparationAttempt((attempt) => attempt + 1);
  useEffect(() => {
    if (!allowed) return;
    if (!manga.chapters[ci].pages.some((p) => p.dimensionsPending)) {
      setPrepared(ci);
      return;
    }
    stopBackground(manga.id);
    const controller = new AbortController();
    setFailure('');
    setPrepared(-1);
    setReady(false);
    setPreparation({
      done: 0,
      total: manga.chapters[ci].pages.filter((p) => p.dimensionsPending).length,
    });
    void prepareChapter(manga, ci, {
      signal: controller.signal,
      update: (state) => setPreparation({ done: state.done, total: state.total }),
    })
      .then((issues) => {
        if (!controller.signal.aborted) {
          if (issues.length)
            setFailure(
              `${issues.length} page(s) could not be prepared. ` +
                issues
                  .slice(0, 3)
                  .map((issue) => `${issue.path}: ${issue.reason}`)
                  .join(' ') +
                (issues.length > 3 ? ' More affected pages are marked below.' : ''),
            );
          setPrepared(ci);
          if (!issues.length) scheduleBackground(manga);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) {
          setFailure(errorMessage(e));
          setPrepared(ci);
        }
      });
    return () => controller.abort();
  }, [manga, ci, allowed, preparationAttempt]);
  const edgeProgress = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const offsets = useRef<Offset[]>([]);
  const measuredHeights = useRef<Map<number, number>>(new Map());
  const lastWindowScrollY = useRef(0);
  const [windowRange, setWindowRange] = useState<WindowRange>(() =>
    getWindowRange(offsets.current, 0, typeof window !== 'undefined' ? window.innerHeight : 800),
  );
  const position = useRef<Position>({ page: 0, fraction: 0 });
  const pendingRestore = useRef<Position | undefined>(undefined);
  const pointer = useRef(-1);
  const held = useRef(new Set<number>());
  const keysHeld = useRef(new Set<string>());
  const pauseUntil = useRef(0);
  const playbackRevision = useRef(0);
  const dirty = useRef(false);
  const lastSave = useRef(0);
  const inFlight = useRef<Promise<SaveProgressResult> | null>(null);
  const queuedFlush = useRef<Promise<SaveProgressResult> | null>(null);
  const snapshotRevision = useRef(0);
  const committedRevision = useRef(0);
  const restoring = useRef(false);
  const chapterRef = useRef(ci);
  const touch = useRef<{ x: number; y: number; multi: boolean } | null>(null);
  const endHandled = useRef(false);
  const metadata = useRef(manga);
  const latest = useRef({ s, ci, ready, allowed, page, zoom });
  latest.current = { s, ci, ready: ready && prepared === ci, allowed, page, zoom };
  const { groups, pageToGroup } = useMemo(() => {
    const result: number[][] = [];
    const p2g = new Int32Array(chapter.pages.length);
    for (let i = 0; i < chapter.pages.length;) {
      const groupIdx = result.length;
      if (
        !s.spread ||
        !wide ||
        (s.singleCover && i === 0) ||
        chapter.pages[i].width > chapter.pages[i].height ||
        i === chapter.pages.length - 1 ||
        chapter.pages[i + 1].width > chapter.pages[i + 1].height
      ) {
        p2g[i] = groupIdx;
        result.push([i++]);
      } else {
        p2g[i] = groupIdx;
        p2g[i + 1] = groupIdx;
        result.push([i, i + 1]);
        i += 2;
      }
    }
    return { groups: result, pageToGroup: p2g };
  }, [chapter, s.spread, s.singleCover, wide]);
  const pageToGroupRef = useRef(pageToGroup);
  pageToGroupRef.current = pageToGroup;
  const groupIndex =
    s.mode === 'single' ? Math.max(0, Math.min(groups.length - 1, pageToGroup[page] ?? 0)) : 0;
  const visible = s.mode === 'single' ? groups[groupIndex] || [] : [];
  const groupsRef = useRef(groups);
  groupsRef.current = groups;
  useEffect(() => {
    let live = true;
    void access(manga).then((v) => live && setAllowed(v));
    return () => {
      live = false;
    };
  }, [manga]);
  function pause() {
    playbackRevision.current++;
    pauseUntil.current = performance.now() + latest.current.s.resumeDelay * 1000;
  }
  function flush(): Promise<SaveProgressResult> {
    if (!latest.current.ready || !latest.current.allowed) {
      return Promise.resolve('missing');
    }
    if (inFlight.current) {
      if (!queuedFlush.current) {
        queuedFlush.current = inFlight.current.then(() => {
          queuedFlush.current = null;
          if (dirty.current) {
            return flush();
          }
          return 'saved';
        });
      }
      return queuedFlush.current;
    }
    if (!dirty.current) {
      return Promise.resolve('saved');
    }
    const index = chapterRef.current;
    const c = metadata.current.chapters[index];
    if (!c) {
      dirty.current = false;
      return Promise.resolve('missing');
    }
    const targetRevision = snapshotRevision.current;
    const p = { ...position.current };
    const isRead = Boolean(c.read);
    const bookmarks = c.bookmarks ? [...c.bookmarks] : undefined;

    dirty.current = false;
    lastSave.current = performance.now();

    const savePromise = (async (): Promise<SaveProgressResult> => {
      try {
        const result = await saveProgress(metadata.current, index, p, isRead, bookmarks);
        if (result === 'saved') {
          committedRevision.current = Math.max(committedRevision.current, targetRevision);
        } else {
          if (committedRevision.current < targetRevision) {
            dirty.current = true;
          }
        }
        return result;
      } catch (err) {
        if (committedRevision.current < targetRevision) {
          dirty.current = true;
        }
        throw err;
      }
    })();

    inFlight.current = savePromise;
    savePromise.finally(() => {
      if (inFlight.current === savePromise) {
        inFlight.current = null;
      }
    });
    return savePromise;
  }
  function capture() {
    if (restoring.current || !latest.current.ready || !offsets.current.length) return;
    const y = window.scrollY;
    const list = offsets.current;
    let index = 0;
    if (latest.current.s.mode === 'continuous') {
      let lo = 0,
        hi = list.length - 1;
      while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        if (list[mid].top <= y + 1) lo = mid;
        else hi = mid - 1;
      }
      index = lo;
    } else {
      index = Math.max(0, Math.min(list.length - 1, latest.current.page));
    }
    const o = list[index];
    position.current = {
      page: o.page,
      path: metadata.current.chapters[chapterRef.current].pages[o.page]?.path,
      fraction: Math.min(1, Math.max(0, (y - o.top) / o.height)),
    };
    if (latest.current.s.mode === 'continuous') setPage((old) => (old === o.page ? old : o.page));
    const c = metadata.current.chapters[chapterRef.current];
    const final = list[c.pages.length - 1] || list.at(-1);
    if (final && y + innerHeight >= final.bottom - 2 && !c.read) {
      c.read = true;
      setReadRevision((v) => v + 1);
    }
    if (edgeProgress.current) {
      const gIndex = pageToGroupRef.current[latest.current.page] ?? 0;
      const currentGroup = groupsRef.current[gIndex] || [latest.current.page];
      const progress =
        latest.current.s.mode === 'single'
          ? (Math.max(...currentGroup) + 1) / c.pages.length
          : final && y + innerHeight >= final.bottom - 2
            ? 1
            : (position.current.page + position.current.fraction) / c.pages.length;
      edgeProgress.current.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
    }
    c.position = { ...position.current };
    dirty.current = true;
    snapshotRevision.current++;
    if (performance.now() - lastSave.current >= 1500)
      void flush().catch((e) => notify(errorMessage(e)));
  }
  function updateWindow(force = false, targetPage?: number) {
    if (
      latest.current.s.mode !== 'continuous' ||
      chapter.pages.length <= VIRTUALIZATION_THRESHOLD
    ) {
      setWindowRange((prev) => {
        if (prev.startIndex === 0 && prev.endIndex === Math.max(0, chapter.pages.length - 1)) {
          return prev;
        }
        return {
          startIndex: 0,
          endIndex: Math.max(0, chapter.pages.length - 1),
          topSpacer: 0,
          bottomSpacer: 0,
        };
      });
      return;
    }
    const y =
      targetPage !== undefined && offsets.current[targetPage]
        ? offsets.current[targetPage].top
        : window.scrollY;
    const h = window.innerHeight;
    if (!force && Math.abs(y - lastWindowScrollY.current) < h * 1.0) {
      return;
    }
    lastWindowScrollY.current = y;
    const next = getWindowRange(offsets.current, y, h, 3);
    setWindowRange((prev) => {
      if (
        prev.startIndex === next.startIndex &&
        prev.endIndex === next.endIndex &&
        Math.abs(prev.topSpacer - next.topSpacer) < 2 &&
        Math.abs(prev.bottomSpacer - next.bottomSpacer) < 2
      ) {
        return prev;
      }
      return next;
    });
  }
  function measure(recomputeOnly = false) {
    if (!recomputeOnly) {
      const nodes = content.current?.querySelectorAll<HTMLElement>('[data-page]');
      if (nodes) {
        for (const el of nodes) {
          const p = Number(el.dataset.page);
          const rect = el.getBoundingClientRect();
          if (rect.height > 0) {
            measuredHeights.current.set(p, rect.height);
          }
        }
      }
    }
    const containerWidth = content.current?.clientWidth || window.innerWidth;
    const viewportHeight = window.innerHeight;
    offsets.current = computeOffsets(
      chapter.pages,
      {
        containerWidth,
        viewportHeight,
        layout: latest.current.s.layout,
        maxWidth: latest.current.s.maxWidth,
        zoom: latest.current.zoom,
      },
      measuredHeights.current,
    );
  }
  function restore(anchor: Position) {
    const index = Math.max(0, Math.min(offsets.current.length - 1, anchor.page));
    const o = offsets.current[index];
    if (o) window.scrollTo({ top: o.top + o.height * anchor.fraction, behavior: 'instant' });
    position.current = { ...anchor };
    playbackRevision.current++;
    restoring.current = false;
    updateWindow(true, anchor.page);
  }
  async function goChapter(index: number, reset = false) {
    if (index < 0 || index >= manga.chapters.length) return;
    capture();
    if (index === ci + 1) {
      metadata.current.chapters[ci].read = true;
      dirty.current = true;
      snapshotRevision.current++;
      setReadRevision((v) => v + 1);
    }
    await flush().catch((e) => notify(errorMessage(e)));
    // Suspend playback synchronously until the destination has been measured/restored.
    restoring.current = true;
    playbackRevision.current++;
    if (reset)
      metadata.current.chapters[index].position = {
        page: 0,
        path: metadata.current.chapters[index].pages[0]?.path,
        fraction: 0,
      };
    clearImageQueue();
    clearObjectUrlPool();
    if (index === ci) {
      pendingRestore.current = metadata.current.chapters[index].position || {
        page: 0,
        fraction: 0,
      };
      setPage(0);
      setZoom(1);
      measuredHeights.current.clear();
      requestAnimationFrame(() => {
        measure();
        updateWindow(true, 0);
        restore(pendingRestore.current!);
        capture();
      });
    } else navigate(mangaPath(manga, index));
    endHandled.current = false;
    setEnded(false);
  }
  function goPage(n: number, user = true) {
    const count = chapter.pages.length;
    n = Math.max(0, Math.min(count - 1, Math.floor(n) || 0));
    if (user) pause();
    setEnded(false);
    endHandled.current = false;
    if (s.mode === 'single') {
      const gIndex = pageToGroupRef.current[n] ?? 0;
      const group = groupsRef.current[gIndex] || [n];
      n = group[0];
      position.current = { page: n, path: chapter.pages[n].path, fraction: 0 };
      metadata.current.chapters[ci].position = { ...position.current };
      pendingRestore.current = { ...position.current };
      setPage(n);
      setZoom(1);
      dirty.current = true;
      snapshotRevision.current++;
      if (edgeProgress.current) {
        const progress = (Math.max(...group) + 1) / chapter.pages.length;
        edgeProgress.current.style.transform = `scaleX(${Math.min(1, Math.max(0, progress))})`;
      }
      if (performance.now() - lastSave.current >= 1500) {
        void flush().catch((e) => notify(errorMessage(e)));
      }
    } else {
      // A chapter's saved-position restore may still be queued when the user jumps.
      // Replace that anchor as well, so it cannot later undo the user's selection.
      const anchor = { page: n, path: chapter.pages[n].path, fraction: 0 };
      pendingRestore.current = anchor;
      measure();
      updateWindow(true, n);
      restore(anchor);
      capture();
    }
  }
  function step(direction: number) {
    const list = groupsRef.current;
    const index = Math.max(
      0,
      Math.min(list.length - 1, pageToGroupRef.current[latest.current.page] ?? 0),
    );
    const next = list[index + direction];
    if (next) goPage(next[0]);
  }
  const actions = useRef({ capture, flush, goChapter, goPage, step, pause, updateWindow });
  actions.current = { capture, flush, goChapter, goPage, step, pause, updateWindow };
  useLayoutEffect(() => {
    if (!allowed || prepared !== ci) {
      setReady(false);
      return;
    }
    setReady(false);
    restoring.current = true;
    chapterRef.current = ci;
    const c = metadata.current.chapters[ci];
    const anchor = matchingPosition(c.position, c.pages) || {
      page: 0,
      path: c.pages[0].path,
      fraction: 0,
    };
    position.current = anchor;
    pendingRestore.current = anchor;
    setPage(anchor.page);
    setZoom(1);
    setEnded(false);
    endHandled.current = false;
    measuredHeights.current.clear();
    const frame = requestAnimationFrame(() => {
      measure();
      updateWindow(true, anchor.page);
      restore(pendingRestore.current || anchor);
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [ci, allowed, prepared]);
  const prevLayoutProps = useRef({
    mode: s.mode,
    layout: s.layout,
    maxWidth: s.maxWidth,
    spread: s.spread,
    singleCover: s.singleCover,
    direction: s.direction,
    zoom,
    wide,
  });
  useLayoutEffect(() => {
    if (!allowed || !ready) return;
    const prev = prevLayoutProps.current;
    const layoutUnchanged =
      prev.mode === s.mode &&
      prev.layout === s.layout &&
      prev.spread === s.spread &&
      prev.singleCover === s.singleCover &&
      prev.direction === s.direction &&
      prev.wide === wide;

    if (layoutUnchanged) {
      if (prev.zoom !== zoom || prev.maxWidth !== s.maxWidth) {
        if (prev.zoom !== zoom && prev.zoom > 0) {
          const scale = zoom / prev.zoom;
          for (const [k, v] of measuredHeights.current) {
            measuredHeights.current.set(k, Math.max(1, Math.round(v * scale)));
          }
        }
        // When only zoom or max-width changes, recompute offsets from existing measured heights
        measure(true);
        const anchor = pendingRestore.current || position.current;
        updateWindow(true, anchor.page);
        if (latest.current.s.mode === 'continuous') {
          restore(anchor);
        }
        pendingRestore.current = undefined;
        capture();
      }
      prevLayoutProps.current = {
        mode: s.mode,
        layout: s.layout,
        maxWidth: s.maxWidth,
        spread: s.spread,
        singleCover: s.singleCover,
        direction: s.direction,
        zoom,
        wide,
      };
      return;
    }

    prevLayoutProps.current = {
      mode: s.mode,
      layout: s.layout,
      maxWidth: s.maxWidth,
      spread: s.spread,
      singleCover: s.singleCover,
      direction: s.direction,
      zoom,
      wide,
    };

    restoring.current = true;
    measuredHeights.current.clear();
    const frame = requestAnimationFrame(() => {
      const anchor = pendingRestore.current || position.current;
      measure();
      updateWindow(true, anchor.page);
      restore(anchor);
      pendingRestore.current = undefined;
      capture();
    });
    return () => cancelAnimationFrame(frame);
  }, [
    s.mode,
    s.layout,
    s.maxWidth,
    s.spread,
    s.singleCover,
    s.direction,
    zoom,
    wide,
    s.mode === 'single' ? page : 0,
    ready,
  ]);
  useEffect(() => {
    if (!ready || !content.current) return;
    let frame = 0;
    let width = innerWidth,
      height = innerHeight;
    const resize = () => {
      if (window.visualViewport && window.visualViewport.scale > 1.01) return;
      const changed = width !== innerWidth || height !== innerHeight;
      width = innerWidth;
      height = innerHeight;
      if (!changed) return;
      const anchor = { ...position.current };
      restoring.current = true;
      setWide(innerWidth >= 700);
      measuredHeights.current.clear();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        measure();
        updateWindow(true, anchor.page);
        restore(anchor);
        actions.current.capture();
      });
    };
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(frame);
    };
  }, [ready]);
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const scroll = () => {
      if (restoring.current) return;
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          if (latest.current.s.autoHideBars) {
            const y = pointer.current;
            setBars((old) => {
              const top = y >= 0 && y < 60,
                bottom = y > innerHeight - 60;
              return old.top === top && old.bottom === bottom ? old : { top, bottom };
            });
          }
          actions.current.capture();
          actions.current.updateWindow();
        });
    };
    const move = (e: PointerEvent) => {
      pointer.current = e.clientY;
      if (held.current.size) actions.current.pause();
      if (e.clientY < 60 || e.clientY > innerHeight - 60)
        setBars({ top: e.clientY < 60, bottom: e.clientY > innerHeight - 60 });
    };
    const down = (e: PointerEvent) => {
      held.current.add(e.pointerId);
      actions.current.pause();
    };
    const up = (e: PointerEvent) => {
      held.current.delete(e.pointerId);
      actions.current.pause();
    };
    const wheel = () => actions.current.pause();
    const key = (e: KeyboardEvent) => {
      keysHeld.current.add(e.code);
      actions.current.pause();
      if (
        e.defaultPrevented ||
        document.querySelector('[role="dialog"],[data-reader-dropdown]') ||
        (e.target as HTMLElement).closest('input,select,button,a,[contenteditable="true"]')
      )
        return;
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) setPlaying((v) => !v);
      }
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        const delta = e.key === 'ArrowRight' ? 1 : -1;
        if (latest.current.s.mode === 'single')
          actions.current.step(delta * (latest.current.s.direction === 'rtl' ? -1 : 1));
        else actions.current.goChapter(latest.current.ci + delta);
      }
      if (e.key === 'Escape') {
        setPlaying(false);
        setBars({ top: true, bottom: true });
      }
      if (e.key.toLowerCase() === 'b' && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        toggleBookmark();
      }
    };
    const keyup = (e: KeyboardEvent) => {
      keysHeld.current.delete(e.code);
      actions.current.pause();
    };
    const blur = () => {
      held.current.clear();
      keysHeld.current.clear();
      void actions.current.flush().catch((e) => notify(errorMessage(e)));
    };
    const leave = () => {
      pointer.current = -1;
    };
    const save = () => {
      actions.current.capture();
      void actions.current.flush().catch((e) => notify(errorMessage(e)));
    };
    const update = (e: Event) => {
      actions.current.capture();
      (e as CustomEvent<Promise<unknown>[]>).detail.push(actions.current.flush());
    };
    const interval = setInterval(() => {
      if (dirty.current) void actions.current.flush().catch((e) => notify(errorMessage(e)));
    }, 1500);
    window.addEventListener('scroll', scroll, { passive: true });
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, { passive: true });
    window.addEventListener('pointerup', up, { passive: true });
    window.addEventListener('pointercancel', up, { passive: true });
    window.addEventListener('wheel', wheel, { passive: true });
    window.addEventListener('keydown', key);
    window.addEventListener('keyup', keyup);
    window.addEventListener('blur', blur);
    document.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', save);
    window.addEventListener('pagehide', save);
    window.addEventListener('reader-before-update', update);
    requestAnimationFrame(() => actions.current.capture());
    return () => {
      clearInterval(interval);
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', scroll);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      window.removeEventListener('wheel', wheel);
      window.removeEventListener('keydown', key);
      window.removeEventListener('keyup', keyup);
      window.removeEventListener('blur', blur);
      document.removeEventListener('pointerleave', leave);
      document.removeEventListener('visibilitychange', save);
      window.removeEventListener('pagehide', save);
      window.removeEventListener('reader-before-update', update);
    };
  }, [ready]);
  useEffect(
    () => () => {
      void actions.current.flush().then(refresh);
      clearImageQueue();
      clearObjectUrlPool();
    },
    [],
  );
  useEffect(() => {
    if (!playing || !allowed || !ready || prepared !== ci) return;
    // Each start owns a fresh clock and uses the viewport, never a previous play target.
    measure();
    actions.current.capture();
    let frame = 0,
      last = 0,
      elapsed = 0,
      scrollRemainder = 0,
      revision = playbackRevision.current;
    function end() {
      if (endHandled.current) return;
      endHandled.current = true;
      actions.current.capture();
      void actions.current.flush().catch((e) => notify(errorMessage(e)));
      const action = latest.current.s.endAction;
      if (action === 'next' && ci < manga.chapters.length - 1)
        actions.current.goChapter(ci + 1, true);
      else if (action === 'replay') actions.current.goChapter(ci, true);
      else {
        setPlaying(false);
        setEnded(true);
        setBars({ top: true, bottom: true });
      }
    }
    const animate = (now: number) => {
      const reset = revision !== playbackRevision.current;
      if (reset) {
        revision = playbackRevision.current;
        elapsed = 0;
        scrollRemainder = 0;
      }
      const dt = last && !reset ? Math.min(now - last, 80) / 1000 : 0;
      last = now;
      if (
        !document.hidden &&
        latest.current.ready &&
        chapterRef.current === ci &&
        !restoring.current &&
        !held.current.size &&
        !keysHeld.current.size &&
        now > pauseUntil.current &&
        !document.querySelector(
          '[role="dialog"],[data-reader-dropdown],.reader-bar details[open]',
        ) &&
        (window.visualViewport?.scale || 1) <= 1.01
      ) {
        const state = latest.current;
        if (state.s.mode === 'single') {
          elapsed += dt;
          if (elapsed >= state.s.seconds) {
            elapsed = 0;
            const list = groupsRef.current;
            const i = pageToGroupRef.current[state.page] ?? 0;
            if (i < list.length - 1) actions.current.goPage(list[i + 1][0], false);
            else end();
          }
        } else {
          // One visible screen per interval, independent of image height or zoom.
          // Read each frame so mobile browser chrome and rotation adapt immediately.
          const viewportHeight = window.visualViewport?.height || innerHeight;
          const speed = viewportHeight / state.s.seconds;
          const y = scrollY + speed * dt + scrollRemainder;
          window.scrollTo({ top: y, behavior: 'instant' });
          // Preserve subpixel movement at slow speeds / high refresh rates.
          // Discard clamped movement at document boundaries.
          scrollRemainder = Math.abs(y - scrollY) < 1 ? y - scrollY : 0;
          const final = offsets.current.at(-1);
          if (final && scrollY + innerHeight >= final.bottom - 1) end();
        }
      } else {
        elapsed = 0;
        scrollRemainder = 0;
      }
      frame = requestAnimationFrame(animate);
    };
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  }, [playing, allowed, ready, prepared, ci, s.mode, s.seconds]);
  function markComplete() {
    capture();
    metadata.current.chapters[ci].read = true;
    dirty.current = true;
    snapshotRevision.current++;
    setReadRevision((v) => v + 1);
    void flush().catch((e) => notify(errorMessage(e)));
  }
  function changeZoom(value: number) {
    capture();
    pendingRestore.current = { ...position.current };
    setZoom(Math.min(3, Math.max(0.5, value)));
  }
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-reader-dropdown]')) return;
      for (const panel of document.querySelectorAll<HTMLDetailsElement>(
        '.reader-bar details[open]',
      ))
        if (!panel.contains(e.target as Node)) panel.open = false;
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape')
        for (const panel of document.querySelectorAll<HTMLDetailsElement>(
          '.reader-bar details[open]',
        ))
          panel.open = false;
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, []);
  function toggleBookmark() {
    actions.current.capture();
    const c = metadata.current.chapters[chapterRef.current];
    if (!c) return;
    const p = { ...position.current, timestamp: Date.now() };
    const marks = c.bookmarks || [];
    const exists = marks.findIndex((b) => (p.path ? b.path === p.path : b.page === p.page));
    if (exists < 0 && marks.length >= limits.bookmarksPerChapter) {
      notify(
        `Bookmark limit is ${limits.bookmarksPerChapter} per chapter. Remove one before adding another.`,
      );
      return;
    }
    const op = exists >= 0 ? removeBookmark(manga.id, c.name, p) : addBookmark(manga.id, c.name, p);
    void op
      .then((updatedMarks) => {
        c.bookmarks = updatedMarks;
        setBookmarkRevision((v) => v + 1);
      })
      .catch((e) => notify(errorMessage(e)));
    notify(exists >= 0 ? 'Bookmark removed.' : 'Page bookmarked.');
  }
  if (allowed === null)
    return (
      <main className="reader-gate">
        <LoaderCircle className="spin" />
        <p>Checking folder access…</p>
      </main>
    );
  if (!allowed)
    return (
      <main className="reader-gate">
        <FolderSync size={32} />
        <h1>Your story is still here.</h1>
        <p>Re-link “{manga.title}” to continue from your saved page.</p>
        <p>
          {manga.handle
            ? 'Your browser needs permission to read this folder again. Choose “Allow on every visit” in the browser prompt, if offered, to remember access.'
            : 'This folder was added with temporary access. Choose the same folder again; your saved progress is kept. For remembered access, use Choose a folder in a browser that supports it.'}
        </p>
        <button
          className="primary"
          onClick={() =>
            void access(manga, true)
              .then((ok) => (ok ? setAllowed(true) : pick(manga)))
              .catch((e) => notify(errorMessage(e)))
          }
        >
          Re-link folder
        </button>
        <Link className="text-button" to="/">
          Back to library
        </Link>
      </main>
    );
  if (prepared !== ci)
    return (
      <main className="reader-gate">
        <LoaderCircle className="spin" />
        <h2>Preparing {chapter.name}</h2>
        <p>
          {preparation.done} / {preparation.total} page sizes checked. This chapter is prepared once
          and saved on this device.
        </p>
        <Link className="secondary" to="/">
          Back to library
        </Link>
      </main>
    );
  const barActive = (v: boolean) => (v || !s.autoHideBars ? '' : ' bar-hidden');
  const bookmarked = metadata.current.chapters[ci].bookmarks?.some(
    (b) => b.path === chapter.pages[page]?.path,
  );
  void bookmarkRevision;
  void readRevision;
  const complete = metadata.current.chapters[ci].read;
  return (
    <div
      className={'reader reader-' + s.mode + ' layout-' + s.layout}
      style={
        {
          '--reading-width': s.maxWidth ? s.maxWidth + 'px' : '100vw',
          '--zoom': zoom,
        } as CSSProperties
      }
      onTouchStart={(e) => {
        const t = e.touches[0];
        touch.current = {
          x: t.clientX,
          y: t.clientY,
          multi: e.touches.length > 1 || (window.visualViewport?.scale || 1) > 1.01 || zoom > 1,
        };
        if (t.clientY < 65 || t.clientY > innerHeight - 65)
          setBars({ top: t.clientY < 65, bottom: t.clientY > innerHeight - 65 });
      }}
      onTouchMove={(e) => {
        if (e.touches.length > 1 && touch.current) touch.current.multi = true;
        pause();
      }}
      onTouchEnd={(e) => {
        const start = touch.current;
        if (e.touches.length) return;
        touch.current = null;
        if (
          !start ||
          start.multi ||
          s.mode !== 'single' ||
          (e.target as HTMLElement).closest('.reader-bar')
        )
          return;
        const t = e.changedTouches[0],
          dx = t.clientX - start.x,
          dy = t.clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy))
          step((dx < 0 ? 1 : -1) * (s.direction === 'rtl' ? -1 : 1));
      }}
    >
      <div className="edge-progress" aria-hidden="true">
        <span ref={edgeProgress} />
      </div>
      <header
        className={'reader-bar reader-top organized-bar' + barActive(bars.top)}
        onFocus={() => setBars((v) => ({ ...v, top: true }))}
        onPointerEnter={() => setBars((v) => ({ ...v, top: true }))}
      >
        <div className="bar-left header-identity">
          <Link
            className="icon-button"
            to="/"
            aria-label="Home"
            title="Home"
            onClick={() => {
              capture();
              void flush();
            }}
          >
            <Home size={19} />
          </Link>
          <Link
            className="reader-title"
            title={manga.title}
            to={mangaDetailsPath(manga)}
            onClick={async (event) => {
              event.preventDefault();
              capture();
              await flush();
              navigate(mangaDetailsPath(manga));
            }}
          >
            {manga.title}
          </Link>
        </div>
        <div
          className="bar-center header-selectors"
          role="group"
          aria-label="Chapter and page layout"
        >
          <Dropdown
            className="fit-select"
            aria-label="Page fitting"
            title="Page fitting"
            value={s.layout}
            onChange={(e) => {
              capture();
              setSettings({ ...s, layout: e.target.value as typeof s.layout });
            }}
          >
            <option value="max">Max-width</option>
            <option value="width">Respect width</option>
            <option value="height">Respect height</option>
            <option value="auto">Auto</option>
          </Dropdown>
          <Dropdown
            className="size-select"
            aria-label="Maximum width in pixels"
            title="Select a width to apply Max-width mode"
            value={s.maxWidth}
            onChange={(e) => {
              capture();
              setSettings({ ...s, layout: 'max', maxWidth: Number(e.target.value) });
            }}
          >
            {[920, 1024, 1280, 0].map((w) => (
              <option key={w} value={w}>
                {w ? w + ' px' : 'Full width'}
              </option>
            ))}
          </Dropdown>
          <Dropdown
            className="mode-select"
            aria-label="Reading mode"
            title="Reading mode"
            value={s.mode}
            onChange={(e) => {
              capture();
              void flush();
              setSettings({ ...s, mode: e.target.value as typeof s.mode });
            }}
          >
            <option value="continuous">Scroll</option>
            <option value="single">Single page</option>
          </Dropdown>
        </div>
        <div className="bar-right header-actions">
          <IconButton label="Keyboard shortcuts" onClick={() => setShortcuts(true)}>
            <Keyboard size={19} />
          </IconButton>
          <ThemeButton />
          <IconButton label="Settings" onClick={openSettings}>
            <Settings size={19} />
          </IconButton>
        </div>
      </header>
      {failure && (
        <div className="reader-error" role="alert">
          {failure} <button onClick={() => void pick(manga)}>Re-link</button>
          {chapter.pages.some((p) => p.dimensionsPending) && (
            <button onClick={retryPreparation}>Retry preparation</button>
          )}
          <button
            className="close-btn"
            aria-label="Dismiss reader error"
            onClick={() => setFailure('')}
          >
            <X size={20} />
          </button>
        </div>
      )}
      <div
        ref={content}
        className={
          'reader-content ' +
          (s.mode === 'single' && visible.length > 1 ? 'spread-content ' : '') +
          (s.direction === 'rtl' ? 'rtl-spread' : '')
        }
      >
        {s.mode === 'continuous' ? (
          <>
            {windowRange.topSpacer > 0 && (
              <div
                className="reader-spacer reader-spacer-top"
                style={{ height: windowRange.topSpacer }}
                aria-hidden="true"
              />
            )}
            {chapter.pages.slice(windowRange.startIndex, windowRange.endIndex + 1).map((p, idx) => {
              const actualIndex = windowRange.startIndex + idx;
              return (
                <PageImage
                  key={ci + '/' + p.path}
                  m={manga}
                  page={p}
                  index={actualIndex}
                  activePage={page}
                  lowQuality={s.lowQuality}
                  report={setFailure}
                  retryPreparation={retryPreparation}
                />
              );
            })}
            {windowRange.bottomSpacer > 0 && (
              <div
                className="reader-spacer reader-spacer-bottom"
                style={{ height: windowRange.bottomSpacer }}
                aria-hidden="true"
              />
            )}
          </>
        ) : (
          visible.map((i) => (
            <PageImage
              key={ci + '/' + i}
              m={manga}
              page={chapter.pages[i]}
              index={i}
              activePage={page}
              lowQuality={s.lowQuality}
              report={setFailure}
              retryPreparation={retryPreparation}
            />
          ))
        )}
      </div>
      {ended && (
        <div className="chapter-end">
          <h2>
            {ci === manga.chapters.length - 1 ? 'You’re all caught up.' : 'Chapter complete.'}
          </h2>
          <div className="button-row">
            {ci < manga.chapters.length - 1 && (
              <button className="primary" onClick={() => goChapter(ci + 1)}>
                Next chapter
              </button>
            )}
            <button className="secondary" onClick={() => goChapter(ci, true)}>
              Read again
            </button>
            <Link className="secondary" to="/">
              Library
            </Link>
          </div>
        </div>
      )}
      <footer
        className={'reader-bar reader-bottom organized-bar' + barActive(bars.bottom)}
        onFocus={() => setBars((v) => ({ ...v, bottom: true }))}
        onPointerEnter={() => setBars((v) => ({ ...v, bottom: true }))}
      >
        <div className="bar-left chapter-navigation" role="group" aria-label="Chapter navigation">
          <button
            className="icon-button"
            disabled={ci === 0}
            aria-label="Previous chapter"
            title="Previous chapter"
            onClick={() => goChapter(ci - 1)}
          >
            <ChevronLeft size={20} />
          </button>
          <Dropdown
            className="chapter-select"
            aria-label="Chapter"
            title={chapter.name}
            value={ci}
            onChange={(e) => goChapter(Number(e.target.value))}
          >
            {manga.chapters.map((c, i) => (
              <option key={c.name} value={i}>
                {metadata.current.chapters[i].read ? '✓ ' : ''}
                {c.name}
              </option>
            ))}
          </Dropdown>
          <button
            className="icon-button"
            disabled={ci === manga.chapters.length - 1}
            aria-label="Next chapter"
            title="Complete this chapter and open the next"
            onClick={() => goChapter(ci + 1)}
          >
            <ChevronRight size={20} />
          </button>
        </div>
        <div
          className="bar-center page-progress-control"
          role="group"
          aria-label="Reading progress"
        >
          <input
            className="current-page-input"
            aria-label="Current page"
            title="Jump to page"
            type="number"
            min={1}
            max={chapter.pages.length}
            value={page + 1}
            onChange={(e) => goPage(Number(e.target.value) - 1)}
          />
          <input
            className="page-progress-slider"
            type="range"
            aria-label="Page progress"
            aria-valuetext={`Page ${page + 1} of ${chapter.pages.length}`}
            min={1}
            max={Math.max(1, chapter.pages.length)}
            step={1}
            value={page + 1}
            disabled={chapter.pages.length === 1}
            onChange={(e) => goPage(Number(e.target.value) - 1)}
            style={
              {
                '--progress-fill':
                  (chapter.pages.length > 1 ? (page / (chapter.pages.length - 1)) * 100 : 100) +
                  '%',
              } as CSSProperties
            }
          />
          <span className="total-page-count" aria-label={`${chapter.pages.length} total pages`}>
            {chapter.pages.length}
          </span>
        </div>
        <div className="bar-right reading-actions" role="group" aria-label="Reading controls">
          <button
            className={'icon-button completion-button ' + (complete ? 'completed' : '')}
            title={complete ? 'Chapter completed' : 'Mark chapter completed'}
            aria-label={complete ? 'Chapter completed' : 'Mark chapter completed'}
            aria-pressed={complete}
            onClick={markComplete}
          >
            <Check size={18} />
          </button>
          <span className="control-divider" aria-hidden="true" />
          <details className="bar-popover zoom-menu" name="reader-controls">
            <summary className="zoom-trigger" aria-label="Image zoom" title="Image zoom">
              {Math.round(zoom * 100)}%<ChevronDown size={12} />
            </summary>
            <div className="bar-popover-panel">
              <h3>Image zoom</h3>
              <div className="zoom-adjustment">
                <button
                  className="icon-button"
                  aria-label="Zoom out"
                  disabled={zoom <= 0.5}
                  onClick={() => changeZoom(zoom - 0.25)}
                >
                  <Minus size={16} />
                </button>
                <input
                  type="range"
                  aria-label="Image zoom percentage"
                  min={50}
                  max={300}
                  step={25}
                  value={zoom * 100}
                  onChange={(e) => changeZoom(Number(e.target.value) / 100)}
                />
                <button
                  className="icon-button"
                  aria-label="Zoom in"
                  disabled={zoom >= 3}
                  onClick={() => changeZoom(zoom + 0.25)}
                >
                  <Plus size={16} />
                </button>
              </div>
              <button className="secondary" onClick={() => changeZoom(1)}>
                Reset to 100%
              </button>
            </div>
          </details>
          <span className="control-divider" aria-hidden="true" />
          <button
            className={'icon-button playback-button ' + (playing ? 'active' : '')}
            title={playing ? 'Pause autoplay' : 'Start autoplay'}
            aria-label={playing ? 'Pause autoplay' : 'Start autoplay'}
            aria-pressed={playing}
            onClick={(e) => {
              endHandled.current = false;
              setPlaying((v) => !v);
              e.currentTarget.blur();
            }}
          >
            {playing ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <details className="bar-popover playback-menu" name="reader-controls">
            <summary
              className="icon-button"
              aria-label="Autoplay and bookmark options"
              title="Autoplay and bookmarks"
            >
              <MoreHorizontal size={18} />
            </summary>
            <div className="bar-popover-panel">
              <h3>Autoplay</h3>
              <label>
                {s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'}
                <Dropdown
                  aria-label={
                    s.mode === 'continuous'
                      ? 'Seconds per screen presets'
                      : 'Seconds per page presets'
                  }
                  value={s.customSeconds ? 'custom' : s.seconds}
                  onChange={(e) =>
                    setSettings({
                      ...s,
                      customSeconds: e.target.value === 'custom',
                      ...(e.target.value !== 'custom' ? { seconds: Number(e.target.value) } : {}),
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
                      setSettings({
                        ...s,
                        seconds: Math.max(0.5, Math.min(120, Number(e.target.value) || 3)),
                      })
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
                Chapter end
                <Dropdown
                  aria-label="Chapter end"
                  value={s.endAction}
                  onChange={(e) =>
                    setSettings({
                      ...s,
                      endAction: e.target.value as typeof s.endAction,
                      advance: e.target.value === 'next',
                    })
                  }
                >
                  <option value="next">Next chapter</option>
                  <option value="stop">Stop</option>
                  <option value="replay">Replay</option>
                </Dropdown>
              </label>
              <div className="popover-menu-actions">
                <button onClick={toggleBookmark}>
                  <Bookmark size={16} />
                  {bookmarked ? 'Remove this bookmark' : 'Bookmark this page'}
                </button>
                <button
                  onClick={async () => {
                    capture();
                    await flush();
                    navigate('/bookmarks');
                  }}
                >
                  <BookMarked size={16} /> View bookmarks
                </button>
                {s.mode === 'single' && (
                  <div className="popover-page-buttons">
                    <button disabled={groupIndex === 0} onClick={() => step(-1)}>
                      <ChevronLeft size={16} /> Previous page
                    </button>
                    <button disabled={groupIndex === groups.length - 1} onClick={() => step(1)}>
                      Next page <ChevronRight size={16} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          </details>
        </div>
      </footer>
      <Modal
        open={shortcuts}
        onClose={() => setShortcuts(false)}
        title="Keyboard shortcuts"
        description="Reader shortcuts work when a control or popup is not focused."
      >
        <table className="shortcuts-table">
          <tbody>
            {[
              ['Space', 'Start / pause auto-scroll or page playback'],
              [
                '← / →',
                'Turn pages (follows reading direction), or change chapters in continuous mode',
              ],
              ['B', 'Bookmark / unbookmark the current page'],
              ['Escape', 'Stop auto-scroll and show bars; close an open popup first'],
              ['↑ / ↓ · Page Up / Down', 'Browser scrolling'],
              ['Home / End', 'Browser navigation to top / bottom'],
              ['Tab / Shift + Tab', 'Focus next / previous control'],
              ['Enter / Space', 'Activate a focused button'],
              ['← / → · Home / End', 'Switch tabs when a settings tab is focused'],
            ].map(([key, value]) => (
              <tr key={key}>
                <td>
                  <kbd>{key}</kbd>
                </td>
                <td>{value}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="subtle">
          Pinch to zoom and pan on touch devices. Page swipes are disabled while zoomed. Open the
          percentage control at the bottom right to adjust zoom. Drag the center progress bar to
          jump between pages.
        </p>
      </Modal>
    </div>
  );
}
