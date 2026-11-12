import {
  useRef,
  type MutableRefObject,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from 'react';
import type { Manga, Position, Settings } from './model';
import type { PageOffset } from './readerGeometry';
import type { PageStore } from './Reader';
import { saveProgress, errorMessage, type SaveProgressResult } from './storage';

export interface UseProgressSaveOptions {
  metadata: MutableRefObject<Manga>;
  chapterRef: MutableRefObject<number>;
  position: MutableRefObject<Position>;
  latest: MutableRefObject<{
    s: Settings;
    ci: number;
    ready: boolean;
    allowed: boolean | null;
    page: number;
    zoom: number;
  }>;
  offsets: MutableRefObject<PageOffset[]>;
  pageToGroupRef: MutableRefObject<Int32Array>;
  groupsRef: MutableRefObject<number[][]>;
  edgeProgress: RefObject<HTMLSpanElement | null>;
  restoring: MutableRefObject<boolean>;
  singlePage: number;
  pageStoreRef: MutableRefObject<PageStore | null>;
  setReadRevision: Dispatch<SetStateAction<number>>;
  notify: (msg: string) => void;
}

export function useProgressSave({
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
}: UseProgressSaveOptions) {
  const dirty = useRef(false);
  const lastSave = useRef(0);
  const inFlight = useRef<Promise<SaveProgressResult> | null>(null);
  const queuedFlush = useRef<Promise<SaveProgressResult> | null>(null);
  const snapshotRevision = useRef(0);
  const committedRevision = useRef(0);

  function flush(): Promise<SaveProgressResult> {
    if (!latest.current.ready || !latest.current.allowed) {
      return Promise.resolve('missing');
    }
    if (inFlight.current) {
      if (!queuedFlush.current) {
        queuedFlush.current = inFlight.current
          .catch(() => {
            // Absorb in-flight rejection so the queued retry attempt can proceed
          })
          .then(() => {
            queuedFlush.current = null;
            if (dirty.current) {
              return flush();
            }
            return 'saved';
          })
          .catch((err) => {
            queuedFlush.current = null;
            throw err;
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
    // Handled cleanup chain prevents unhandled rejection on the cleanup promise
    savePromise.then(
      () => {
        if (inFlight.current === savePromise) {
          inFlight.current = null;
        }
      },
      () => {
        if (inFlight.current === savePromise) {
          inFlight.current = null;
        }
      },
    );
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
    latest.current.page = o.page;
    if (latest.current.s.mode === 'continuous' && pageStoreRef.current) {
      pageStoreRef.current.setPage(o.page);
    }
    const c = metadata.current.chapters[chapterRef.current];
    const final = list[c.pages.length - 1] || list.at(-1);
    if (final && y + innerHeight >= final.bottom - 2 && !c.read) {
      c.read = true;
      setReadRevision((v) => v + 1);
    }
    if (edgeProgress.current) {
      const currentPage =
        latest.current.s.mode === 'single'
          ? singlePage
          : pageStoreRef.current
            ? pageStoreRef.current.getPage()
            : 0;
      const gIndex = pageToGroupRef.current[currentPage] ?? 0;
      const currentGroup = groupsRef.current[gIndex] || [currentPage];
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
    if (performance.now() - lastSave.current >= 1500) {
      void flush().catch((e) => notify(errorMessage(e)));
    }
  }

  return {
    dirty,
    lastSave,
    snapshotRevision,
    committedRevision,
    flush,
    capture,
  };
}
