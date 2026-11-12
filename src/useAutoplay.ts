import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
} from 'react';
import type { Settings, Manga } from './model';
import type { PageOffset } from './readerGeometry';
import { errorMessage, type SaveProgressResult } from './data';

export interface UseAutoplayOptions {
  allowed: boolean | null;
  ready: boolean;
  prepared: number | null;
  ci: number;
  manga: Manga;
  settings: Settings;
  offsets: MutableRefObject<PageOffset[]>;
  groupsRef: MutableRefObject<number[][]>;
  pageToGroupRef: MutableRefObject<Int32Array>;
  chapterRef: MutableRefObject<number>;
  restoring: MutableRefObject<boolean>;
  held: MutableRefObject<Set<number>>;
  keysHeld: MutableRefObject<Set<string>>;
  latest: MutableRefObject<{
    s: Settings;
    ci: number;
    ready: boolean;
    allowed: boolean | null;
    page: number;
    zoom: number;
  }>;
  actions: MutableRefObject<{
    capture: () => void;
    flush: () => Promise<SaveProgressResult>;
    goChapter: (index: number, reset?: boolean) => Promise<void>;
    goPage: (n: number, user?: boolean) => void;
    step: (direction: number) => void;
    pause: () => void;
    updateWindow: (force?: boolean, targetPage?: number) => void;
    measure: (recomputeOnly?: boolean) => void;
  }>;
  setBars: Dispatch<SetStateAction<{ top: boolean; bottom: boolean }>>;
  notify: (msg: string) => void;
}

export function useAutoplay({
  allowed,
  ready,
  prepared,
  ci,
  manga,
  settings,
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
}: UseAutoplayOptions) {
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const endHandled = useRef(false);
  const pauseUntil = useRef(0);
  const playbackRevision = useRef(0);

  function pause() {
    playbackRevision.current++;
    pauseUntil.current = performance.now() + latest.current.s.resumeDelay * 1000;
  }

  useEffect(() => {
    if (!playing || !allowed || !ready || prepared !== ci) return;
    // Each start owns a fresh clock and uses the viewport, never a previous play target.
    actions.current.measure();
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

      const handleTransition = (promise: Promise<void>) => {
        promise.catch((err) => {
          setPlaying(false);
          setEnded(true);
          setBars({ top: true, bottom: true });
          notify(errorMessage(err));
        });
      };

      const action = latest.current.s.endAction;
      if (action === 'next' && ci < manga.chapters.length - 1)
        handleTransition(actions.current.goChapter(ci + 1, true));
      else if (action === 'replay') handleTransition(actions.current.goChapter(ci, true));
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
  }, [playing, allowed, ready, prepared, ci, settings.mode, settings.seconds]);

  return {
    playing,
    setPlaying,
    ended,
    setEnded,
    endHandled,
    pauseUntil,
    playbackRevision,
    pause,
  };
}
