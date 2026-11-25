import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { useSearchParams, useParams, useNavigate, useLocation } from 'react-router-dom';
import { ChevronRight, X } from 'lucide-react';
import { mangaPath, chapterIndex } from '../paths';
import { limits } from '../limits';
import { desktopAPI } from '../tauriBridge';
import type { PageOffset, WindowRange } from '../model';
import { useApp } from '../app-tsx';
import {
  stopBackground,
  scheduleBackground,
  prepareChapter,
  access,
  accessCache,
  sessionFiles,
  fileFor,
  syncChannel,
  saveManga,
  addBookmark,
  removeBookmark,
  matchingPosition,
  errorMessage,
  clearImageQueue,
  clearObjectUrlPool,
  type Manga,
  type Position,
} from '../data';
import { useAutoplay } from '../useAutoplay';
import { useReaderKeys } from '../useReaderKeys';
import { useProgressSave } from '../useProgressSave';
import { createPageStore, type PageStore } from './pageStore';
import { LoadingGate, RelinkGate, PreparingGate } from './ReaderGates';
import { ReaderHeader } from './ReaderHeader';
import { ReaderFooter, extractChapterNumber } from './ReaderFooter';
import { ReaderContent } from './ReaderContent';
import { ChapterEnd } from './ChapterEnd';
import { ShortcutsModal } from './ShortcutsModal';

const VIRTUALIZATION_THRESHOLD = 8;
type Offset = PageOffset;

export function ReaderView({ manga }: { manga: Manga }) {
  const [params] = useSearchParams();
  const { chapterSegment, mangaId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { settings: s, setSettings, openSettings, notify, pick, relink, refresh } = useApp();
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

  const [allowed, setAllowed] = useState<boolean | null>(() => {
    if (sessionFiles.has(manga.id)) return true;
    if (desktopAPI.isDesktop && manga.localPath) return true;
    const cached = accessCache.get(manga.id);
    return cached ? cached.granted : null;
  });
  const [bars, setBars] = useState({ top: true, bottom: true });
  const [singlePage, setSinglePage] = useState(0);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [wide, setWide] = useState(matchMedia('(min-width:700px)').matches);
  const [shortcuts, setShortcuts] = useState(false);
  const [bookmarkRevision, setBookmarkRevision] = useState(0);
  const [failure, setFailure] = useState('');
  const [readRevision, setReadRevision] = useState(0);

  const pageStoreRef = useRef<PageStore | null>(null);
  if (!pageStoreRef.current) {
    pageStoreRef.current = createPageStore(0);
  }
  const pageStore = pageStoreRef.current;

  const [prepared, setPrepared] = useState(ci);
  const [preparation, setPreparation] = useState({ done: 0, total: 0 });
  const [preparationAttempt, setPreparationAttempt] = useState(0);
  const retryPreparation = () => setPreparationAttempt((attempt) => attempt + 1);

  useEffect(() => {
    if (!allowed) return;

    // Check window: previous 10 and next 10 chapters around ci
    const start = Math.max(0, ci - 10);
    const end = Math.min(manga.chapters.length - 1, ci + 10);
    let hasUnindexedInWindow = false;
    for (let i = start; i <= end; i++) {
      const ch = manga.chapters[i];
      if (ch && ch.pages.some((p) => p.dimensionsPending || p.width === 0 || p.height === 0)) {
        hasUnindexedInWindow = true;
        break;
      }
    }

    // If index is not available for all previous and next 10 chapters,
    // start indexing it at that point with 1+1 chapter indexing without notifying the user
    if (hasUnindexedInWindow) {
      scheduleBackground(manga, ci);
    }

    // Seamlessly prepare current chapter ci if it has pending dimensions, without blocking gate or notification
    const currentChapter = manga.chapters[ci];
    if (
      currentChapter &&
      currentChapter.pages.some((p) => p.dimensionsPending || p.width === 0 || p.height === 0)
    ) {
      const controller = new AbortController();
      void prepareChapter(manga, ci, {
        signal: controller.signal,
        update: (state) => setPreparation({ done: state.done, total: state.total }),
      })
        .then(() => {
          if (!controller.signal.aborted) {
            setPrepared(ci);
            setDimRevision((v) => v + 1);
            actions.current.measure(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setPrepared(ci);
          }
        });
      return () => controller.abort();
    } else {
      setPrepared(ci);
    }
  }, [manga, ci, allowed, preparationAttempt]);

  const edgeProgress = useRef<HTMLSpanElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const offsets = useRef<Offset[]>([]);
  const measuredHeights = useRef<Map<number, number>>(new Map());
  const lastWindowScrollY = useRef(0);
  const [windowRange, setWindowRange] = useState<WindowRange>(() => ({
    startIndex: 0,
    endIndex: Math.max(0, chapter.pages.length - 1),
    topSpacer: 0,
    bottomSpacer: 0,
  }));
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
    const fallbackTimer = setTimeout(() => {
      if (live) {
        setAllowed((prev) => (prev === null ? false : prev));
      }
    }, 1500);

    const verify = async () => {
      try {
        const ok = await access(manga);
        if (live) setAllowed(ok);
      } catch {
        if (live) setAllowed(false);
      } finally {
        clearTimeout(fallbackTimer);
      }
    };
    void verify();
    const onSync = (e: MessageEvent) => {
      if (!e.data?.id || e.data.id === manga.id) {
        void verify();
      }
    };
    syncChannel?.addEventListener('message', onSync);
    return () => {
      live = false;
      clearTimeout(fallbackTimer);
      syncChannel?.removeEventListener('message', onSync);
    };
  }, [manga.id, manga.updatedAt]);

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
    void desktopAPI.getWindowRange(offsets.current, y, h, 3).then((next) => {
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
    const measuredObj = Object.fromEntries(measuredHeights.current);
    void desktopAPI
      .computeOffsets(
        chapter.pages,
        {
          containerWidth,
          viewportHeight,
          layout: latest.current.s.layout,
          maxWidth: latest.current.s.maxWidth,
          zoom: latest.current.zoom,
        },
        measuredObj,
      )
      .then((res) => {
        offsets.current = res;
      });
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
    pause: () => {},
    updateWindow,
    measure,
  });
  actions.current = {
    capture,
    flush,
    goChapter,
    goPage,
    step,
    pause: () => {},
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

  const { playing, setPlaying, ended, setEnded, endHandled, playbackRevision, pause } = useAutoplay(
    {
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
    },
  );
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

  const [continuousAtEnd, setContinuousAtEnd] = useState(false);

  const checkContinuousEnd = useCallback(() => {
    if (latest.current.s.mode !== 'continuous') return false;
    const ch = metadata.current.chapters[chapterRef.current];
    if (!ch || !ch.pages.length) return false;
    const scrollBottom = window.scrollY + window.innerHeight;
    const docHeight = document.documentElement.scrollHeight;
    if (docHeight > 0) {
      if (docHeight <= window.innerHeight + 10) return true;
      if (scrollBottom >= docHeight - 50) return true;
    }
    const lastOffset = offsets.current[ch.pages.length - 1] || offsets.current.at(-1);
    if (lastOffset && lastOffset.bottom > 0 && scrollBottom >= lastOffset.bottom - 50) {
      return true;
    }
    const nodes = content.current?.querySelectorAll<HTMLElement>('[data-page]');
    if (nodes && nodes.length > 0) {
      const lastEl = nodes[nodes.length - 1];
      if (lastEl && Number(lastEl.dataset.page) === ch.pages.length - 1) {
        const rect = lastEl.getBoundingClientRect();
        if (rect.bottom <= window.innerHeight + 50) {
          return true;
        }
      }
    }
    return false;
  }, []);

  useEffect(() => {
    if (s.mode === 'continuous') {
      const update = () => {
        setContinuousAtEnd(checkContinuousEnd());
      };
      update();
      const timer = setTimeout(update, 150);
      return () => clearTimeout(timer);
    } else {
      setContinuousAtEnd(false);
    }
  }, [ci, s.mode, checkContinuousEnd]);

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
          if (latest.current.s.mode === 'continuous') {
            const isEnd = checkContinuousEnd();
            setContinuousAtEnd((prev) => (prev !== isEnd ? isEnd : prev));
          }
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
          scheduleBackground(metadata.current);
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
  const dimSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (dimSaveTimer.current) clearTimeout(dimSaveTimer.current);
    };
  }, []);

  const onDimensionsResolved = useCallback(
    (pageIndex: number, width: number, height: number) => {
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
        if (dimSaveTimer.current) clearTimeout(dimSaveTimer.current);
        dimSaveTimer.current = setTimeout(() => {
          void saveManga(metadata.current).catch(() => {});
        }, 500);
      }
    },
    [ci],
  );

  if (allowed === null) return <LoadingGate message="Checking folder access…" />;

  if (!allowed)
    return (
      <RelinkGate
        manga={manga}
        onRelink={async () => {
          try {
            const ok = await relink(manga);
            if (ok) {
              setAllowed(true);
            }
          } catch (e) {
            notify(errorMessage(e));
          }
        }}
      />
    );

  const currentPage = s.mode === 'single' ? singlePage : pageStore.getPage();
  const bookmarked = !!metadata.current.chapters[ci].bookmarks?.some(
    (b) => !b.mangaBookmark && b.path === chapter.pages[currentPage]?.path,
  );
  void bookmarkRevision;
  void readRevision;
  const complete = !!metadata.current.chapters[ci].read;

  const handleBeforeNavigate = async () => {
    capture();
    await flush();
  };

  const hasNextChapter = ci < manga.chapters.length - 1;
  const nextChapter = hasNextChapter ? manga.chapters[ci + 1] : null;
  const nextChapterNumber = nextChapter ? extractChapterNumber(nextChapter.name, ci + 1) : '';
  const isAtChapterEnd = s.mode === 'single' ? groupIndex >= groups.length - 1 : continuousAtEnd;
  const showNextChapterNotification = isAtChapterEnd && !playing && hasNextChapter;

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

      <ReaderHeader
        manga={manga}
        visible={bars.top}
        settings={s}
        onSetSettings={setSettings}
        onOpenSettings={openSettings}
        onOpenShortcuts={() => setShortcuts(true)}
        onBeforeNavigate={handleBeforeNavigate}
        onFocusBars={() => setBars((v) => ({ ...v, top: true }))}
      />

      {failure && (
        <div className="reader-error" role="alert">
          {failure}{' '}
          <button className="btn" onClick={() => void relink(manga)}>
            Re-link
          </button>
          {chapter.pages.some((p) => p.dimensionsPending) && (
            <button className="btn" onClick={retryPreparation}>
              Retry preparation
            </button>
          )}
          <button
            className="btn icon close-btn"
            aria-label="Dismiss reader error"
            onClick={() => setFailure('')}
          >
            <X size={20} />
          </button>
        </div>
      )}

      <ReaderContent
        ref={content}
        manga={manga}
        ci={ci}
        settings={s}
        visible={visible}
        singlePage={singlePage}
        activeContinuousPage={pageStore.getPage()}
        windowRange={windowRange}
        onSetFailure={setFailure}
        onRetryPreparation={retryPreparation}
        onDimensionsResolved={onDimensionsResolved}
      />

      {ended && (
        <ChapterEnd
          isLastChapter={ci === manga.chapters.length - 1}
          onNextChapter={() => goChapter(ci + 1)}
          onReadAgain={() => goChapter(ci, true)}
        />
      )}

      {hasNextChapter && (
        <div
          className={`next-chapter-toast ${showNextChapterNotification ? 'visible' : ''} ${bars.bottom ? '' : 'bar-hidden'}`}
          aria-hidden={!showNextChapterNotification}
        >
          <button
            type="button"
            className="next-chapter-btn"
            onClick={() => void goChapter(ci + 1, true)}
            tabIndex={showNextChapterNotification ? 0 : -1}
            aria-label={`Read Next Chapter ${nextChapterNumber}`}
          >
            <span>Read Next Ch. {nextChapterNumber}</span>
            <ChevronRight size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      <ReaderFooter
        manga={manga}
        ci={ci}
        visible={bars.bottom}
        settings={s}
        pageStore={pageStore}
        zoom={zoom}
        playing={playing}
        complete={complete}
        bookmarked={bookmarked}
        groupIndex={groupIndex}
        totalGroups={groups.length}
        onGoChapter={goChapter}
        onGoPage={goPage}
        onMarkComplete={markComplete}
        onChangeZoom={changeZoom}
        onTogglePlay={(e) => {
          endHandled.current = false;
          setPlaying((v) => !v);
          e.currentTarget.blur();
        }}
        onSetSettings={setSettings}
        onToggleBookmark={toggleBookmark}
        onStep={step}
        onBeforeNavigate={handleBeforeNavigate}
        onFocusBars={() => setBars((v) => ({ ...v, bottom: true }))}
      />

      <ShortcutsModal open={shortcuts} onClose={() => setShortcuts(false)} />
    </div>
  );
}
