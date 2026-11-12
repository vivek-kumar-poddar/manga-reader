import { useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { Settings } from './model';

export interface UseReaderKeysOptions {
  latest: MutableRefObject<{
    s: Settings;
    ci: number;
    ready: boolean;
    allowed: boolean | null;
    page: number;
    zoom: number;
  }>;
  actions: MutableRefObject<{
    pause: () => void;
    step: (direction: number) => void;
    goChapter: (index: number, reset?: boolean) => Promise<void>;
  }>;
  setPlaying: Dispatch<SetStateAction<boolean>>;
  setBars: Dispatch<SetStateAction<{ top: boolean; bottom: boolean }>>;
  toggleBookmark: () => void;
}

export function useReaderKeys({
  latest,
  actions,
  setPlaying,
  setBars,
  toggleBookmark,
}: UseReaderKeysOptions) {
  const keysHeld = useRef(new Set<string>());
  const navigatingRef = useRef(false);

  const onKeyDown = (e: KeyboardEvent) => {
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
      if (latest.current.s.mode === 'single') {
        actions.current.step(delta * (latest.current.s.direction === 'rtl' ? -1 : 1));
      } else {
        // Serialize navigation: ignore repeated keystrokes while chapter transition is active
        if (navigatingRef.current) return;
        navigatingRef.current = true;
        actions.current
          .goChapter(latest.current.ci + delta)
          .catch((err) => {
            console.warn('Chapter navigation failed:', err);
          })
          .finally(() => {
            navigatingRef.current = false;
          });
      }
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

  const onKeyUp = (e: KeyboardEvent) => {
    keysHeld.current.delete(e.code);
    actions.current.pause();
  };

  return {
    keysHeld,
    onKeyDown,
    onKeyUp,
  };
}
