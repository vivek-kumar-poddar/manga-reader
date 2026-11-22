import Dropdown from '../Dropdown';
import { RefreshCw } from 'lucide-react';
import { defaults, type Settings } from '../data';

interface AppearanceTabProps {
  settings: Settings;
  setSettings: (s: Settings) => void;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  notify: (msg: string) => void;
}

export default function AppearanceTab({
  settings: s,
  setSettings,
  change,
  notify,
}: AppearanceTabProps) {
  return (
    <>
      <section>
        <h3>Appearance</h3>
        <label>
          Theme
          <Dropdown
            aria-label="Theme"
            value={s.theme}
            onChange={(e) => change('theme', e.target.value as Settings['theme'])}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </Dropdown>
        </label>
        <label>
          Headings & titles font size
          <Dropdown
            aria-label="Headings and titles font size"
            value={s.fontSizeTitle}
            onChange={(e) => change('fontSizeTitle', Number(e.target.value))}
          >
            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
              <option key={size} value={size}>
                {size}px{size === 15 ? ' (Default)' : ''}
              </option>
            ))}
            {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeTitle) && (
              <option value={s.fontSizeTitle}>{s.fontSizeTitle}px</option>
            )}
          </Dropdown>
        </label>
        <label>
          UI font size
          <Dropdown
            aria-label="UI font size"
            value={s.fontSizeUi}
            onChange={(e) => change('fontSizeUi', Number(e.target.value))}
          >
            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
              <option key={size} value={size}>
                {size}px{size === 15 ? ' (Default)' : ''}
              </option>
            ))}
            {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeUi) && (
              <option value={s.fontSizeUi}>{s.fontSizeUi}px</option>
            )}
          </Dropdown>
        </label>
        <label>
          Button font size
          <Dropdown
            aria-label="Button font size"
            value={s.fontSizeButton}
            onChange={(e) => change('fontSizeButton', Number(e.target.value))}
          >
            {[12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].map((size) => (
              <option key={size} value={size}>
                {size}px{size === 15 ? ' (Default)' : ''}
              </option>
            ))}
            {![12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24].includes(s.fontSizeButton) && (
              <option value={s.fontSizeButton}>{s.fontSizeButton}px</option>
            )}
          </Dropdown>
        </label>
        <label>
          Auto-hide reader bars
          <input
            type="checkbox"
            checked={s.autoHideBars}
            onChange={(e) => change('autoHideBars', e.target.checked)}
          />
        </label>
        <p className="subtle">
          Turn off to keep reader controls visible. When enabled, move or tap near the top
          or bottom edge to reveal them.
        </p>
        <label>
          Reduce interface motion
          <input
            type="checkbox"
            checked={s.reduced}
            onChange={(e) => change('reduced', e.target.checked)}
          />
        </label>
        <p className="subtle">
          Your system’s reduced-motion preference is also respected. Auto-scroll remains
          available when you explicitly start it.
        </p>
      </section>
      <section>
        <h3>Image performance</h3>
        <label>
          Lower image resolution on mobile
          <input
            type="checkbox"
            checked={s.lowQuality}
            onChange={(e) => change('lowQuality', e.target.checked)}
          />
        </label>
        <p className="subtle">
          When supported, large pages are displayed at up to 1,000 pixels wide on narrow
          screens. Original files are never changed. Nearby pages load as you read;
          distant images are released from memory.
        </p>
      </section>
      <section>
        <h3>Start fresh</h3>
        <button
          className="btn secondary"
          onClick={() => {
            setSettings(defaults);
            notify(
              'Default preferences restored. Your library and progress are unchanged.',
            );
          }}
        >
          <RefreshCw size={16} /> Restore default preferences
        </button>
        <p className="subtle">Resets appearance and reading preferences only.</p>
      </section>
    </>
  );
}
