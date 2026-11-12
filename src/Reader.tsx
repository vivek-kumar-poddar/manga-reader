import { mangaPath, mangaDetailsPath, chapterIndex } from './paths';
import { limits } from './limits';
import Dropdown from './Dropdown';
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  memo,
  type CSSProperties,
} from 'react';
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
import { useAutoplay } from './useAutoplay';
import { useReaderKeys } from './useReaderKeys';
import { useProgressSave } from './useProgressSave';

export interface PageStore {
  getPage: () => number;
  setPage: (page: number) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createPageStore(initialPage = 0): PageStore {
  let current = initialPage;
  const listeners = new Set<() => void>();
  return {
    getPage: () => current,
    setPage: (page: number) => {
      if (current === page) return;
      current = page;
      for (const listener of listeners) {
        listener();
      }
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export interface PageProgressControlProps {
  totalPages: number;
  store: PageStore;
  onGoPage: (pageIndex: number) => void;
}

export const PageProgressControl = memo(function PageProgressControl({
  totalPages,
  store,
  onGoPage,
}: PageProgressControlProps) {
  const currentPage = useSyncExternalStore(store.subscribe, store.getPage);

  return (
    <div className="bar-center page-progress-control" role="group" aria-label="Reading progress">
      <input
        className="current-page-input"
        aria-label="Current page"
        title="Jump to page"
        type="number"
        min={1}
        max={totalPages}
        value={currentPage + 1}
        onChange={(e) => onGoPage(Number(e.target.value) - 1)}
      />
      <input
        className="page-progress-slider"
        type="range"
        aria-label="Page progress"
        aria-valuetext={`Page ${currentPage + 1} of ${totalPages}`}
        min={1}
        max={Math.max(1, totalPages)}
        step={1}
        value={currentPage + 1}
        disabled={totalPages <= 1}
        onChange={(e) => onGoPage(Number(e.target.value) - 1)}
        style={
          {
            '--progress-fill':
              (totalPages > 1 ? (currentPage / (totalPages - 1)) * 100 : 100) + '%',
          } as CSSProperties
        }
      />
      <span className="total-page-count" aria-label={`${totalPages} total pages`}>
        {totalPages}
      </span>
    </div>
  );
});

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
  const location = useLocation();
  const entrySearch = useRef(location.search);
  if (location.search) {
    entrySearch.current = location.search;
  }
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
          if (m.chapters && m.chapters.length > 0) {
            const query = new URLSearchParams(entrySearch.current);
            const page = Number(query.get('page'));
            if (Number.isInteger(page) && page > 0) {
              const ci = chapterIndex(
                chapterSegment,
                m.chapters.length,
                mangaId ? Number(query.get('chapter') ?? m.lastChapter) : m.lastChapter,
              );
              const chapter = m.chapters[ci];
              if (chapter && chapter.pages && chapter.pages.length > 0) {
                const index = Math.max(0, Math.min(page - 1, chapter.pages.length - 1));
                chapter.position = {
                  page: index,
                  path: chapter.pages[index]?.path,
                  fraction: Math.max(0, Math.min(1, Number(query.get('offset')) || 0)),
                };
              }
            }
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
        <Link className="primary button" to="/">
          Back to library
        </Link>
      </main>
    );
  if (
    !manga.chapters ||
    manga.chapters.length === 0 ||
    !manga.chapters.some((c) => c.pages && c.pages.length > 0)
  )
    return (
      <main className="reader-gate">
        <BookOpen size={32} />
        <h1>No readable pages in this title</h1>
        <p>"{manga.title || 'Untitled'}" does not contain any readable chapter or page data.</p>
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1rem' }}>
          <Link className="primary button" to="/">
            Back to library
          </Link>
          <Link className="secondary button" to={mangaDetailsPath(manga)}>
            Title details
          </Link>
        </div>
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
    [bars, setBars] = useState({ top: true, bottom: true }),
    [singlePage, setSinglePage] = useState(0),
    [ready, setReady] = useState(false),
    [zoom, setZoom] = useState(1),
    [wide, setWide] = useState(matchMedia('(min-width:700px)').matches),
    [shortcuts, setShortcuts] = useState(false),
    [bookmarkRevision, setBookmarkRevision] = useState(0),
    [failure, setFailure] = useState(''),
    [readRevision, setReadRevision] = useState(0);
  const pageStoreRef = useRef<PageStore | null>(null);
  if (!pageStoreRef.current) {
    pageStoreRef.current = createPageStore(0);
  }
  const pageStore = pageStoreRef.current;
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
  const restoring = useRef(false);
  const chapterRef = useRef(ci);
  const touch = useRef<{ x: number; y: number; multi: boolean } | null>(null);
  const metadata = useRef(manga);
  const latest = useRef({ s, ci, ready, allowed, page: 0, zoom });
  latest.current = {
    s,
    ci,
    ready: ready && prepared === ci,
    allowed,
    page: s.mode === 'single' ? singlePage : pageStore.getPage(),
    zoom,
  };
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
    s.mode === 'single'
      ? Math.max(0, Math.min(groups.length - 1, pageToGroup[singlePage] ?? 0))
      : 0;
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
  const { dirty, lastSave, snapshotRevision, flush, capture } = useProgressSave({
    metadata,
    chapterRef,
    position,
    latest,
    offsets,
    pageToGroupRef,
    groupsRef,
    edgeProgress,
    restoring,
    singlePage,
    pageStoreRef,
    setReadRevision,
    notify,
  });
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
      setSinglePage(0);
      pageStore.setPage(0);
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
      setSinglePage(n);
      pageStore.setPage(n);
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
      pageStore.setPage(n);
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
  const actions = useRef({
    capture,
    flush,
    goChapter,
    goPage,
    step,
    pause: () => { },
    updateWindow,
    measure,
  });
  actions.current = {
    capture,
    flush,
    goChapter,
    goPage,
    step,
    pause: () => { },
    updateWindow,
    measure,
  };

  const {
    keysHeld,
    onKeyDown: key,
    onKeyUp: keyup,
  } = useReaderKeys({
    latest,
    actions,
    setPlaying: (v) => setPlaying(v),
    setBars,
    toggleBookmark: () => toggleBookmark(),
  });

  const { playing, setPlaying, ended, setEnded, endHandled, pauseUntil, playbackRevision, pause } =
    useAutoplay({
      allowed,
      ready,
      prepared,
      ci,
      manga,
      settings: s,
      offsets,
      groupsRef,
      pageToGroupRef,
      chapterRef,
      restoring,
      held,
      keysHeld,
      latest,
      actions,
      setBars,
      notify,
    });
  actions.current.pause = pause;
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
    setSinglePage(anchor.page);
    pageStore.setPage(anchor.page);
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
    s.mode === 'single' ? singlePage : 0,
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
      void actions.current
        .flush()
        .then((res) => {
          if (res === 'saved') {
            refresh();
          }
        })
        .catch((e) => {
          console.warn('Failed to flush progress on unmount:', e);
        });
      clearImageQueue();
      clearObjectUrlPool();
    },
    [],
  );
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
    const exists = marks.findIndex(
      (b) => !b.mangaBookmark && (p.path ? b.path === p.path : b.page === p.page),
    );
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

  const [, setDimRevision] = useState(0);
  const onDimensionsResolved = (pageIndex: number, width: number, height: number) => {
    const c = metadata.current.chapters[ci];
    if (c && c.pages && c.pages[pageIndex]) {
      c.pages[pageIndex] = {
        ...c.pages[pageIndex],
        width,
        height,
        dimensionsPending: false,
      };
      setDimRevision((v) => v + 1);
      actions.current.measure(false);
    }
  };

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
  const currentPage = s.mode === 'single' ? singlePage : pageStore.getPage();
  const bookmarked = metadata.current.chapters[ci].bookmarks?.some(
    (b) => !b.mangaBookmark && b.path === chapter.pages[currentPage]?.path,
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
                  activePage={s.mode === 'single' ? singlePage : undefined}
                  lowQuality={s.lowQuality}
                  report={setFailure}
                  retryPreparation={retryPreparation}
                  onDimensionsResolved={onDimensionsResolved}
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
              activePage={singlePage}
              lowQuality={s.lowQuality}
              report={setFailure}
              retryPreparation={retryPreparation}
              onDimensionsResolved={onDimensionsResolved}
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
        <PageProgressControl
          totalPages={chapter.pages.length}
          store={pageStore}
          onGoPage={goPage}
        />
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
