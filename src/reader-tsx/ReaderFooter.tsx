import { useNavigate } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Check,
  ChevronDown,
  Minus,
  Plus,
  Play,
  Pause,
  MoreHorizontal,
  Bookmark,
  BookMarked,
} from 'lucide-react';
import Dropdown from '../Dropdown';
import { PageProgressControl } from './PageProgressControl';
import type { PageStore } from './pageStore';
import type { Manga, Settings as AppSettings } from '../data';

export interface ReaderFooterProps {
  manga: Manga;
  ci: number;
  visible: boolean;
  settings: AppSettings;
  pageStore: PageStore;
  zoom: number;
  playing: boolean;
  complete: boolean;
  bookmarked: boolean;
  groupIndex: number;
  totalGroups: number;
  onGoChapter: (index: number) => void;
  onGoPage: (pageIndex: number) => void;
  onMarkComplete: () => void;
  onChangeZoom: (newZoom: number) => void;
  onTogglePlay: (e: React.MouseEvent<HTMLButtonElement>) => void;
  onSetSettings: (s: AppSettings) => void;
  onToggleBookmark: () => void;
  onStep: (dir: number) => void;
  onBeforeNavigate: () => Promise<void>;
  onFocusBars: () => void;
}

export function ReaderFooter({
  manga,
  ci,
  visible,
  settings: s,
  pageStore,
  zoom,
  playing,
  complete,
  bookmarked,
  groupIndex,
  totalGroups,
  onGoChapter,
  onGoPage,
  onMarkComplete,
  onChangeZoom,
  onTogglePlay,
  onSetSettings,
  onToggleBookmark,
  onStep,
  onBeforeNavigate,
  onFocusBars,
}: ReaderFooterProps) {
  const navigate = useNavigate();
  const chapter = manga.chapters[ci];
  const barClass = visible || !s.autoHideBars ? '' : ' bar-hidden';

  return (
    <footer
      className={'reader-bar reader-bottom organized-bar' + barClass}
      onFocus={onFocusBars}
      onPointerEnter={onFocusBars}
    >
      <div className="bar-left chapter-navigation" role="group" aria-label="Chapter navigation">
        <button
          className="btn icon"
          disabled={ci === 0}
          aria-label="Previous chapter"
          title="Previous chapter"
          onClick={() => onGoChapter(ci - 1)}
        >
          <ChevronLeft size={20} />
        </button>
        <Dropdown
          className="chapter-select"
          aria-label="Chapter"
          title={chapter.name}
          value={ci}
          onChange={(e) => onGoChapter(Number(e.target.value))}
        >
          {manga.chapters.map((c, i) => (
            <option key={c.id || `${i}:${c.name}`} value={i}>
              {manga.chapters[i].read ? '✓ ' : ''}
              {c.name}
            </option>
          ))}
        </Dropdown>
        <button
          className="btn icon"
          disabled={ci === manga.chapters.length - 1}
          aria-label="Next chapter"
          title="Complete this chapter and open the next"
          onClick={() => onGoChapter(ci + 1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <PageProgressControl
        totalPages={chapter.pages.length}
        store={pageStore}
        onGoPage={onGoPage}
      />
      <div className="bar-right reading-actions" role="group" aria-label="Reading controls">
        <button
          className={'btn icon completion-button ' + (complete ? 'completed' : '')}
          title={complete ? 'Chapter completed' : 'Mark chapter completed'}
          aria-label={complete ? 'Chapter completed' : 'Mark chapter completed'}
          aria-pressed={complete}
          onClick={onMarkComplete}
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
                className="btn icon"
                aria-label="Zoom out"
                disabled={zoom <= 0.5}
                onClick={() => onChangeZoom(zoom - 0.25)}
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
                onChange={(e) => onChangeZoom(Number(e.target.value) / 100)}
              />
              <button
                className="btn icon"
                aria-label="Zoom in"
                disabled={zoom >= 3}
                onClick={() => onChangeZoom(zoom + 0.25)}
              >
                <Plus size={16} />
              </button>
            </div>
            <button className="btn secondary" onClick={() => onChangeZoom(1)}>
              Reset to 100%
            </button>
          </div>
        </details>
        <span className="control-divider" aria-hidden="true" />
        <button
          className={'btn icon playback-button ' + (playing ? 'active' : '')}
          title={playing ? 'Pause autoplay' : 'Start autoplay'}
          aria-label={playing ? 'Pause autoplay' : 'Start autoplay'}
          aria-pressed={playing}
          onClick={onTogglePlay}
        >
          {playing ? <Pause size={18} /> : <Play size={18} />}
        </button>
        <details className="bar-popover playback-menu" name="reader-controls">
          <summary
            className="btn icon"
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
                  onSetSettings({
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
                    onSetSettings({
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
                  onSetSettings({
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
              <button className="btn" onClick={onToggleBookmark}>
                <Bookmark size={16} />
                {bookmarked ? 'Remove this bookmark' : 'Bookmark this page'}
              </button>
              <button
                className="btn"
                onClick={async () => {
                  await onBeforeNavigate();
                  navigate('/bookmarks');
                }}
              >
                <BookMarked size={16} /> View bookmarks
              </button>
              {s.mode === 'single' && (
                <div className="popover-page-buttons">
                  <button className="btn" disabled={groupIndex === 0} onClick={() => onStep(-1)}>
                    <ChevronLeft size={16} /> Previous page
                  </button>
                  <button
                    className="btn"
                    disabled={groupIndex === totalGroups - 1}
                    onClick={() => onStep(1)}
                  >
                    Next page <ChevronRight size={16} />
                  </button>
                </div>
              )}
            </div>
          </div>
        </details>
      </div>
    </footer>
  );
}
