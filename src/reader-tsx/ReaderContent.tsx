import { forwardRef } from 'react';
import PageImage from '../PageImage';
import type { Manga, Settings as AppSettings } from '../data';
import type { WindowRange } from '../model';

export interface ReaderContentProps {
  manga: Manga;
  ci: number;
  settings: AppSettings;
  visible: number[];
  singlePage: number;
  activeContinuousPage: number;
  windowRange: WindowRange;
  onSetFailure: (msg: string) => void;
  onRetryPreparation: () => void;
  onDimensionsResolved: (pageIndex: number, width: number, height: number) => void;
}

export const ReaderContent = forwardRef<HTMLDivElement, ReaderContentProps>(function ReaderContent(
  {
    manga,
    ci,
    settings: s,
    visible,
    singlePage,
    activeContinuousPage,
    windowRange,
    onSetFailure,
    onRetryPreparation,
    onDimensionsResolved,
  },
  ref,
) {
  const chapter = manga.chapters[ci];

  return (
    <div
      ref={ref}
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
                activePage={activeContinuousPage}
                lowQuality={s.lowQuality}
                report={onSetFailure}
                retryPreparation={onRetryPreparation}
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
            report={onSetFailure}
            retryPreparation={onRetryPreparation}
            onDimensionsResolved={onDimensionsResolved}
          />
        ))
      )}
    </div>
  );
});
