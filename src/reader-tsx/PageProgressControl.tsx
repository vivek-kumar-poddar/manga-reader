import { memo, useSyncExternalStore, type CSSProperties } from 'react';
import type { PageStore } from './pageStore';

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
