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
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-theme" className="setting-title">
              Theme
            </label>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-theme"
              aria-label="Theme"
              value={s.theme}
              onChange={(e) => change('theme', e.target.value as Settings['theme'])}
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-font-scale" className="setting-title">
              Text &amp; UI font scaling
            </label>
            <p className="subtle setting-desc">
              Scales text, headings, and controls together (80%–200%).
            </p>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-font-scale"
              aria-label="Text and UI font scaling"
              value={currentScale}
              onChange={(e) => handleScaleChange(Number(e.target.value))}
            >
              {SCALE_OPTIONS.map((scale) => (
                <option key={scale} value={scale}>
                  {Math.round(scale * 100)}% ({scale.toFixed(1)}x)
                  {scale === 1.0 ? ' (Default)' : ''}
                </option>
              ))}
              {!SCALE_OPTIONS.some((opt) => Math.abs(opt - currentScale) < 0.01) && (
                <option value={currentScale}>
                  {Math.round(currentScale * 100)}% ({currentScale.toFixed(1)}x)
                </option>
              )}
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-auto-hide" className="setting-title">
              Auto-hide reader bars
            </label>
            <p className="subtle setting-desc">
              Hide reader controls while reading. Hover or tap screen edges to reveal.
            </p>
          </div>
          <div className="setting-control">
            <input
              id="setting-auto-hide"
              type="checkbox"
              checked={s.autoHideBars}
              onChange={(e) => change('autoHideBars', e.target.checked)}
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-reduced-motion" className="setting-title">
              Reduce interface motion
            </label>
            <p className="subtle setting-desc">
              Minimizes UI animations while keeping manual auto-scroll available.
            </p>
          </div>
          <div className="setting-control">
            <input
              id="setting-reduced-motion"
              type="checkbox"
              checked={s.reduced}
              onChange={(e) => change('reduced', e.target.checked)}
            />
          </div>
        </div>
      </section>
      <section>
        <h3>Image performance</h3>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-low-quality" className="setting-title">
              Lower image resolution on mobile
            </label>
            <p className="subtle setting-desc">
              Downscales large pages to 1,000px wide on narrow screens. Originals are never
              modified.
            </p>
          </div>
          <div className="setting-control">
            <input
              id="setting-low-quality"
              type="checkbox"
              checked={s.lowQuality}
              onChange={(e) => change('lowQuality', e.target.checked)}
            />
          </div>
        </div>
      </section>
      <section>
        <h3>Reset</h3>
        <div className="setting-row setting-row-actions">
          <div className="setting-info">
            <span className="setting-title">Restore default preferences</span>
            <p className="subtle setting-desc">
              Resets reading and appearance settings only. Your library stays intact.
            </p>
          </div>
          <div className="setting-control">
            <div className="button-row">
              <button
                className="btn secondary"
                onClick={() => {
                  setSettings(defaults);
                  notify('Default preferences restored. Your library and progress are unchanged.');
                }}
              >
                <RefreshCw size={16} /> Restore defaults
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
