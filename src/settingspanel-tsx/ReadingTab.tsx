import Dropdown from '../Dropdown';
import type { Settings } from '../data';

interface ReadingTabProps {
  settings: Settings;
  setSettings: (s: Settings) => void;
  change: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
}

export default function ReadingTab({ settings: s, setSettings, change }: ReadingTabProps) {
  return (
    <>
      <section>
        <h3>Pages &amp; layout</h3>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-reading-mode" className="setting-title">
              Reading mode
            </label>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-reading-mode"
              aria-label="Reading mode"
              value={s.mode}
              onChange={(e) => change('mode', e.target.value as Settings['mode'])}
            >
              <option value="continuous">Continuous scroll</option>
              <option value="single">Single page</option>
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-page-fitting" className="setting-title">
              Page fitting
            </label>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-page-fitting"
              aria-label="Page fitting"
              value={s.layout}
              onChange={(e) => change('layout', e.target.value as Settings['layout'])}
            >
              <option value="max">Max-width</option>
              <option value="width">Respect width</option>
              <option value="height">Respect height</option>
              <option value="auto">Auto</option>
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-max-width" className="setting-title">
              Maximum width
            </label>
            <p className="subtle setting-desc">Applies to Max-width fitting.</p>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-max-width"
              aria-label="Maximum width"
              value={s.maxWidth}
              onChange={(e) => change('maxWidth', Number(e.target.value))}
            >
              {[920, 1024, 1280, 0].map((n) => (
                <option key={n} value={n}>
                  {n ? n + ' px' : 'Full width'}
                </option>
              ))}
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-direction" className="setting-title">
              Page-turn direction
            </label>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-direction"
              aria-label="Page-turn direction"
              value={s.direction}
              onChange={(e) => change('direction', e.target.value as Settings['direction'])}
            >
              <option value="ltr">Left to right</option>
              <option value="rtl">Right to left</option>
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-spread" className="setting-title">
              Two-page spreads on wide screens
            </label>
            <p className="subtle setting-desc">
              Single-page mode at 700px+ width; landscape pages stay single.
            </p>
          </div>
          <div className="setting-control">
            <input
              id="setting-spread"
              type="checkbox"
              checked={s.spread}
              onChange={(e) => change('spread', e.target.checked)}
            />
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-single-cover" className="setting-title">
              Show the first page alone
            </label>
          </div>
          <div className="setting-control">
            <input
              id="setting-single-cover"
              type="checkbox"
              checked={s.singleCover}
              onChange={(e) => change('singleCover', e.target.checked)}
            />
          </div>
        </div>
      </section>
      <section>
        <h3>Auto-scroll</h3>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-seconds" className="setting-title">
              {s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'}
            </label>
            <p className="subtle setting-desc">
              {s.mode === 'continuous'
                ? 'Scrolls one screen height per interval. Higher is slower.'
                : 'Advances to the next page or spread after each interval.'}
            </p>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-seconds"
              aria-label={s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'}
              value={s.customSeconds ? 'custom' : s.seconds}
              onChange={(e) =>
                setSettings({
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
          </div>
        </div>
        {s.customSeconds && (
          <div className="setting-row">
            <div className="setting-info">
              <label htmlFor="setting-custom-seconds" className="setting-title">
                Custom seconds
              </label>
            </div>
            <div className="setting-control">
              <input
                id="setting-custom-seconds"
                aria-label={
                  s.mode === 'continuous' ? 'Custom seconds per screen' : 'Custom seconds per page'
                }
                type="number"
                min="0.5"
                max="120"
                step="0.5"
                value={s.seconds}
                onChange={(e) =>
                  change('seconds', Math.min(120, Math.max(0.5, Number(e.target.value) || 3)))
                }
              />
            </div>
          </div>
        )}
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-end-action" className="setting-title">
              At the end of playback
            </label>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-end-action"
              aria-label="At the end of playback"
              value={s.endAction}
              onChange={(e) =>
                setSettings({
                  ...s,
                  endAction: e.target.value as Settings['endAction'],
                  advance: e.target.value === 'next',
                })
              }
            >
              <option value="next">Next chapter</option>
              <option value="stop">Stop</option>
              <option value="replay">Replay chapter</option>
            </Dropdown>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-resume-delay" className="setting-title">
              Resume after interaction
            </label>
            <p className="subtle setting-desc">Pauses on input and resumes after this delay.</p>
          </div>
          <div className="setting-control">
            <Dropdown
              id="setting-resume-delay"
              aria-label="Resume after interaction"
              value={s.resumeDelay}
              onChange={(e) => change('resumeDelay', Number(e.target.value))}
            >
              {[1, 1.8, 3, 5, 10].map((n) => (
                <option key={n} value={n}>
                  {n} seconds
                </option>
              ))}
            </Dropdown>
          </div>
        </div>
      </section>
      <section>
        <h3>Safety</h3>
        <div className="setting-row">
          <div className="setting-info">
            <label htmlFor="setting-confirm-delete" className="setting-title">
              Confirm before deleting
            </label>
            <p className="subtle setting-desc">
              Ask for confirmation before deleting titles or bookmarks.
            </p>
          </div>
          <div className="setting-control">
            <input
              id="setting-confirm-delete"
              type="checkbox"
              checked={Boolean(s.confirmDelete)}
              onChange={(e) => change('confirmDelete', e.target.checked)}
            />
          </div>
        </div>
      </section>
    </>
  );
}
