import { useState, useRef, type ReactNode } from 'react';

export function formatAddedDate(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
}

export function formatWholeDate(timestamp?: number): string {
  if (!timestamp) return '';
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

export function DateTooltip({ timestamp, children }: { timestamp?: number; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('top');
  const [align, setAlign] = useState<'left' | 'right'>('left');
  const badgeRef = useRef<HTMLDivElement>(null);

  const showTooltip = () => {
    if (badgeRef.current) {
      const rect = badgeRef.current.getBoundingClientRect();
      setPlacement(rect.top < 44 ? 'bottom' : 'top');
      setAlign(rect.left + 260 > window.innerWidth ? 'right' : 'left');
    }
    setOpen(true);
  };

  const hideTooltip = () => setOpen(false);
  const wholeDate = formatWholeDate(timestamp);

  return (
    <div
      ref={badgeRef}
      className="manga-card-date-badge"
      onPointerEnter={showTooltip}
      onPointerLeave={hideTooltip}
      onFocus={showTooltip}
      onBlur={hideTooltip}
      onClick={(e) => e.stopPropagation()}
      tabIndex={0}
      role="note"
      aria-label={wholeDate ? `Manga was added on ${wholeDate}` : undefined}
    >
      {children}
      {open && wholeDate && (
        <div className={`space-tooltip tooltip-${placement} tooltip-align-${align}`} role="tooltip">
          Manga was added on {wholeDate}
        </div>
      )}
    </div>
  );
}
