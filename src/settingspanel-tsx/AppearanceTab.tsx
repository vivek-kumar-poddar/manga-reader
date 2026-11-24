import Dropdown from '../Dropdown';
import { RefreshCw } from 'lucide-react';
import { defaults, type Settings } from '../data';

interface AppearanceTabProps {
  settings: Settings;
  setSettings: (s: Settings) => void;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  notify: (msg: string) => void;
}

const SCALE_OPTIONS = [0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0];

export default function AppearanceTab({
  settings: s,
  setSettings,
  change,
  notify,
}: AppearanceTabProps) {
  const currentScale =
    typeof s.fontSizeScale === 'number' && Number.isFinite(s.fontSizeScale)
      ? Math.round(s.fontSizeScale * 10) / 10
      : typeof s.fontSizeUi === 'number' && Number.isFinite(s.fontSizeUi)
        ? Math.round((s.fontSizeUi / 15) * 10) / 10
        : 1.0;

  const handleScaleChange = (scale: number) => {
    setSettings({
      ...s,
      fontSizeScale: scale,
      fontSizeUi: Math.round(15 * scale),
      fontSizeButton: Math.round(14 * scale),
      fontSizeTitle: Math.round(28 * scale),
    });
  };

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
          Text &amp; UI font scaling
          <Dropdown
            aria-label="Text and UI font scaling"
            value={currentScale}
            onChange={(e) => handleScaleChange(Number(e.target.value))}
          >
            {SCALE_OPTIONS.map((scale) => (
              <option key={scale} value={scale}>
                {Math.round(scale * 100)}% ({scale.toFixed(1)}x){scale === 1.0 ? ' (Default)' : ''}
              </option>
            ))}
            {!SCALE_OPTIONS.some((opt) => Math.abs(opt - currentScale) < 0.01) && (
              <option value={currentScale}>
                {Math.round(currentScale * 100)}% ({currentScale.toFixed(1)}x)
              </option>
            )}
          </Dropdown>
        </label>
        <p className="subtle">
          Scales all interface text together up to 2x in 10% steps. At 100%: 15px UI text, 14px
          buttons, 28px headings and titles.
        </p>
        <label>
          Auto-hide reader bars
          <input
            type="checkbox"
            checked={s.autoHideBars}
            onChange={(e) => change('autoHideBars', e.target.checked)}
          />
        </label>
        <p className="subtle">
          Turn off to keep reader controls visible. When enabled, move or tap near the top or bottom
          edge to reveal them.
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
          Your system’s reduced-motion preference is also respected. Auto-scroll remains available
          when you explicitly start it.
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
          When supported, large pages are displayed at up to 1,000 pixels wide on narrow screens.
          Original files are never changed. Nearby pages load as you read; distant images are
          released from memory.
        </p>
      </section>
      <section>
        <h3>Start fresh</h3>
        <button
          className="btn secondary"
          onClick={() => {
            setSettings(defaults);
            notify('Default preferences restored. Your library and progress are unchanged.');
          }}
        >
          <RefreshCw size={16} /> Restore default preferences
        </button>
        <p className="subtle">Resets appearance and reading preferences only.</p>
      </section>
    </>
  );
}
