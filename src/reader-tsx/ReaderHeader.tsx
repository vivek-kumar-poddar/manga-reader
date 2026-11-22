import { Link, useNavigate } from 'react-router-dom';
import { Home, Keyboard, Settings } from 'lucide-react';
import { mangaDetailsPath } from '../paths';
import Dropdown from '../Dropdown';
import { IconButton, ThemeButton } from '../app-tsx';
import type { Manga, Settings as AppSettings } from '../data';

export interface ReaderHeaderProps {
  manga: Manga;
  visible: boolean;
  settings: AppSettings;
  onSetSettings: (s: AppSettings) => void;
  onOpenSettings: () => void;
  onOpenShortcuts: () => void;
  onBeforeNavigate: () => Promise<void>;
  onFocusBars: () => void;
}

export function ReaderHeader({
  manga,
  visible,
  settings: s,
  onSetSettings,
  onOpenSettings,
  onOpenShortcuts,
  onBeforeNavigate,
  onFocusBars,
}: ReaderHeaderProps) {
  const navigate = useNavigate();
  const barClass = visible || !s.autoHideBars ? '' : ' bar-hidden';

  return (
    <header
      className={'reader-bar reader-top organized-bar' + barClass}
      onFocus={onFocusBars}
      onPointerEnter={onFocusBars}
    >
      <div className="bar-left header-identity">
        <Link
          className="btn icon"
          to="/"
          aria-label="Home"
          title="Home"
          onClick={() => {
            void onBeforeNavigate();
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
            await onBeforeNavigate();
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
            void onBeforeNavigate();
            onSetSettings({ ...s, layout: e.target.value as typeof s.layout });
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
            void onBeforeNavigate();
            onSetSettings({ ...s, layout: 'max', maxWidth: Number(e.target.value) });
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
            void onBeforeNavigate();
            onSetSettings({ ...s, mode: e.target.value as typeof s.mode });
          }}
        >
          <option value="continuous">Scroll</option>
          <option value="single">Single page</option>
        </Dropdown>
      </div>
      <div className="bar-right header-actions">
        <IconButton label="Keyboard shortcuts" onClick={onOpenShortcuts}>
          <Keyboard size={19} />
        </IconButton>
        <ThemeButton />
        <IconButton label="Settings" onClick={onOpenSettings}>
          <Settings size={19} />
        </IconButton>
      </div>
    </header>
  );
}
