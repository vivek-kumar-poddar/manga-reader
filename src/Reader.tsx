import { useEffect, useRef, useState } from 'react';
import { useParams, useLocation } from 'react-router-dom';
import { chapterIndex } from './paths';
import { useApp } from './app-tsx';
import { getManga, errorMessage, syncChannel, type Manga } from './data';
import { IndexingGate, LoadingGate, NotFoundGate, NoPagesGate, ReaderView } from './reader-tsx';

// Re-export modular components and utilities for seamless backwards compatibility
export type { PageStore } from './reader-tsx/pageStore';
export { createPageStore } from './reader-tsx/pageStore';
export { PageProgressControl } from './reader-tsx/PageProgressControl';
export {
  IndexingGate,
  LoadingGate,
  NotFoundGate,
  NoPagesGate,
  RelinkGate,
  PreparingGate,
} from './reader-tsx/ReaderGates';
export { ShortcutsModal } from './reader-tsx/ShortcutsModal';
export { ChapterEnd } from './reader-tsx/ChapterEnd';
export { ReaderHeader } from './reader-tsx/ReaderHeader';
export { ReaderFooter } from './reader-tsx/ReaderFooter';
export { ReaderContent } from './reader-tsx/ReaderContent';
export { ReaderView } from './reader-tsx/ReaderView';

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
    const onSync = (e: MessageEvent) => {
      if (!e.data?.id || e.data.id === stableId) {
        void getManga(stableId || '').then((m) => {
          if (live && m) setManga(m);
        });
      }
    };
    syncChannel?.addEventListener('message', onSync);
    return () => {
      live = false;
      syncChannel?.removeEventListener('message', onSync);
    };
  }, [stableId, indexing]);

  if (indexing) {
    return <IndexingGate progress={indexingProgress} onCancel={cancelImport} />;
  }

  if (manga === undefined) {
    return <LoadingGate />;
  }

  if (!manga) {
    return <NotFoundGate />;
  }

  if (
    !manga.chapters ||
    manga.chapters.length === 0 ||
    !manga.chapters.some((c) => c.pages && c.pages.length > 0)
  ) {
    return <NoPagesGate manga={manga} />;
  }

  return <ReaderView key={manga.id} manga={manga} />;
}
