import {
  useState,
  useEffect,
  useLayoutEffect,
  useRef,
  useCallback,
  type CSSProperties,
} from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X, FolderSync, Check, BookOpen, Trash2 } from 'lucide-react';

export function CardMenu({
  title,
  needsRelink,
  onRelink,
  onMarkRead,
  onMarkUnread,
  onRemove,
}: {
  title: string;
  needsRelink: boolean;
  onRelink: () => void;
  onMarkRead: () => void;
  onMarkUnread: () => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>({});
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const summaryRef = useRef<HTMLElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePosition = useCallback(() => {
    const trigger = summaryRef.current || detailsRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const popoverEl = popoverRef.current;
    const popoverHeight = popoverEl?.offsetHeight || (needsRelink ? 200 : 160);
    const popoverWidth = popoverEl?.offsetWidth || 190;
    const gap = 6;
    const margin = 10;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    const placeTop = spaceBelow < popoverHeight + gap + margin && spaceAbove > spaceBelow;

    setPlacement(placeTop ? 'top' : 'bottom');

    let left = rect.right - popoverWidth;
    if (left < margin) {
      left = Math.min(rect.left, window.innerWidth - popoverWidth - margin);
    }
    left = Math.max(margin, left);

    if (placeTop) {
      setPopoverStyle({
        position: 'fixed',
        top: 'auto',
        bottom: `${Math.max(margin, window.innerHeight - rect.top + gap)}px`,
        left: `${left}px`,
        right: 'auto',
        zIndex: 9999,
      });
    } else {
      setPopoverStyle({
        position: 'fixed',
        top: `${Math.min(window.innerHeight - popoverHeight - margin, rect.bottom + gap)}px`,
        bottom: 'auto',
        left: `${left}px`,
        right: 'auto',
        zIndex: 9999,
      });
    }
  }, [needsRelink]);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    const raf = requestAnimationFrame(updatePosition);
    return () => cancelAnimationFrame(raf);
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function handleOutside(event: MouseEvent | PointerEvent) {
      const target = event.target as Node | null;
      if (!target) return;
      if (detailsRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }
      setOpen(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setOpen(false);
        summaryRef.current?.focus();
      }
    }
    document.addEventListener('pointerdown', handleOutside, true);
    document.addEventListener('click', handleOutside, true);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      document.removeEventListener('pointerdown', handleOutside, true);
      document.removeEventListener('click', handleOutside, true);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [open, updatePosition]);

  const menuContent = (
    <div
      ref={popoverRef}
      className="menu-popover"
      style={popoverStyle}
      onClick={(event) => {
        if ((event.target as Element).closest('button')) {
          setOpen(false);
          summaryRef.current?.focus();
        }
      }}
    >
      {needsRelink && (
        <button type="button" className="btn" onClick={onRelink}>
          <FolderSync size={16} /> Re-link / re-index
        </button>
      )}
      <button type="button" className="btn" onClick={onMarkRead}>
        <Check size={16} /> Mark all read
      </button>
      <button type="button" className="btn" onClick={onMarkUnread}>
        <BookOpen size={16} /> Mark all unread
      </button>
      <button type="button" className="btn delete" onClick={onRemove}>
        <Trash2 size={16} /> Remove
      </button>
    </div>
  );

  return (
    <details
      ref={detailsRef}
      open={open}
      className={`card-menu${placement === 'top' ? ' popover-top' : ''}`}
      onToggle={(e) => {
        const nextOpen = e.currentTarget.open;
        if (nextOpen !== open) {
          setOpen(nextOpen);
        }
      }}
    >
      <summary
        ref={summaryRef}
        aria-label={'Options for ' + title}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
      >
        <MoreHorizontal className="card-menu-dots" size={19} />
        <X className="card-menu-close" size={19} />
      </summary>
      {open &&
        (typeof document !== 'undefined' ? createPortal(menuContent, document.body) : menuContent)}
    </details>
  );
}
