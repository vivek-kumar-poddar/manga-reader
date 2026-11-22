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
        <h3>Pages & layout</h3>
        <label>
          Reading mode
          <Dropdown
            aria-label="Reading mode"
            value={s.mode}
            onChange={(e) => change('mode', e.target.value as Settings['mode'])}
          >
            <option value="continuous">Continuous scroll</option>
            <option value="single">Single page</option>
          </Dropdown>
        </label>
        <label>
          Page fitting
          <Dropdown
            aria-label="Page fitting"
            value={s.layout}
            onChange={(e) => change('layout', e.target.value as Settings['layout'])}
          >
            <option value="max">Max-width</option>
            <option value="width">Respect width</option>
            <option value="height">Respect height</option>
            <option value="auto">Auto</option>
          </Dropdown>
        </label>
        <label>
          Maximum width
          <Dropdown
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
        </label>
        <label>
          Page-turn direction
          <Dropdown
            aria-label="Page-turn direction"
            value={s.direction}
            onChange={(e) => change('direction', e.target.value as Settings['direction'])}
          >
            <option value="ltr">Left to right</option>
            <option value="rtl">Right to left</option>
          </Dropdown>
        </label>
        <label>
          Two-page spreads on wide screens
          <input
            type="checkbox"
            checked={s.spread}
            onChange={(e) => change('spread', e.target.checked)}
          />
        </label>
        <label>
          Show the first page alone
          <input
            type="checkbox"
            checked={s.singleCover}
            onChange={(e) => change('singleCover', e.target.checked)}
          />
        </label>
        <p className="subtle">
          Spreads apply in single-page mode at widths of 700 pixels or more. Landscape
          pages stay separate. Pinch zoom keeps native touch panning; swipes do not turn
          pages while zoomed.
        </p>
        <p className="subtle">
          Width presets apply to Max-width mode. Pages remain gap-free and keep their
          original proportions.
        </p>
      </section>
      <section>
        <h3>Auto-scroll</h3>
        <label>
          {s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'}
          <Dropdown
            aria-label={
              s.mode === 'continuous' ? 'Seconds per screen' : 'Seconds per page'
            }
            value={s.customSeconds ? 'custom' : s.seconds}
            onChange={(e) =>
              setSettings({
                ...s,
                customSeconds: e.target.value === 'custom',
                ...(e.target.value !== 'custom'
                  ? { seconds: Number(e.target.value) }
                  : {}),
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
                change(
                  'seconds',
                  Math.min(120, Math.max(0.5, Number(e.target.value) || 3)),
                )
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
          At the end of playback
          <Dropdown
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
        </label>
        <label>
          Resume after interaction
          <Dropdown
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
        </label>
        <p className="subtle">
          Scrolling pauses when you use the mouse, touch, or keyboard, then resumes after
          this idle time. Opening a popup pauses it until the popup closes.
        </p>
      </section>
      <section>
        <h3>Accidental delete control</h3>
        <label>
          Confirm before deleting
          <input
            type="checkbox"
            checked={Boolean(s.confirmDelete)}
            onChange={(e) => change('confirmDelete', e.target.checked)}
          />
        </label>
        <p className="subtle">
          When enabled, clicking a delete button opens a confirmation popup modal to
          confirm the deletion or cancel the action.
        </p>
      </section>
    </>
  );
}
