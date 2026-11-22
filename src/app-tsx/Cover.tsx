import { useState, useEffect, useRef, memo } from 'react';
import { BookOpen } from 'lucide-react';
import { getCover, onMangaDelete, type Summary } from '../data';
import { desktopAPI } from '../tauriBridge';

export const MAX_COVER_URLS = 64;
export const coverUrlPool = new Map<string, string>();

export function clearCoverUrlPool(mangaId?: string): void {
  if (mangaId) {
    for (const [k, existing] of coverUrlPool.entries()) {
      if (k === mangaId || k.startsWith(`${mangaId}:`)) {
        try {
          URL.revokeObjectURL(existing);
        } catch {}
        coverUrlPool.delete(k);
      }
    }
  } else {
    for (const u of coverUrlPool.values()) {
      try {
        URL.revokeObjectURL(u);
      } catch {}
    }
    coverUrlPool.clear();
  }
}

onMangaDelete((id?: string) => {
  clearCoverUrlPool(id);
});

type CoverVisibleCallback = () => void;
const coverListeners = new Map<Element, CoverVisibleCallback>();
let sharedCoverObserver: IntersectionObserver | null = null;

function getSharedCoverObserver(): IntersectionObserver | null {
  if (typeof IntersectionObserver === 'undefined') return null;
  if (!sharedCoverObserver) {
    sharedCoverObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const cb = coverListeners.get(entry.target);
            if (cb) {
              coverListeners.delete(entry.target);
              sharedCoverObserver?.unobserve(entry.target);
              cb();
            }
          }
        }
      },
      { rootMargin: '100px 0px' },
    );
  }
  return sharedCoverObserver;
}

export function observeCoverVisibility(
  el: HTMLElement,
  callback: CoverVisibleCallback,
): () => void {
  const observer = getSharedCoverObserver();
  if (!observer) {
    callback();
    return () => {};
  }
  coverListeners.set(el, callback);
  observer.observe(el);
  return () => {
    coverListeners.delete(el);
    observer.unobserve(el);
  };
}

export const Cover = memo(function Cover({
  m,
  size = 512,
}: {
  m: Pick<Summary, 'id'> & { updatedAt?: number };
  size?: number;
}) {
  const cacheKey = `${m.id}:${m.updatedAt ?? 0}:${size}`;
  const [url, setUrl] = useState<string>(() => coverUrlPool.get(cacheKey) || '');
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    const cached = coverUrlPool.get(cacheKey);
    if (cached) {
      setUrl(cached);
      return;
    }

    if (!host.current) return;

    const unobserve = observeCoverVisibility(host.current, () => {
      if (desktopAPI.isDesktop && (desktopAPI.getCoverImageUrl || desktopAPI.getThumbnailUrl)) {
        if (desktopAPI.getCoverImageUrl) {
          const coverUrl = desktopAPI.getCoverImageUrl(m.id, m.updatedAt, size);
          setUrl(coverUrl);
          return;
        }
        desktopAPI.getThumbnailUrl!(m.id, size)
          .then((thumbUrl) => {
            if (!live) return;
            if (thumbUrl) {
              setUrl(thumbUrl);
              return;
            }
            loadCoverBlob();
          })
          .catch(() => {
            if (live) loadCoverBlob();
          });
        return;
      }
      loadCoverBlob();

      function loadCoverBlob() {
        void getCover(m.id)
          .then((blob) => {
            if (!live || !blob) return;
            let objectUrl = coverUrlPool.get(cacheKey);
            if (!objectUrl) {
              if (coverUrlPool.size >= MAX_COVER_URLS) {
                const oldestKey = coverUrlPool.keys().next().value;
                if (oldestKey) clearCoverUrlPool(oldestKey);
              }
              objectUrl = URL.createObjectURL(blob);
              coverUrlPool.set(cacheKey, objectUrl);
            }
            setUrl(objectUrl);
          })
          .catch(() => {});
      }
    });

    return () => {
      live = false;
      unobserve();
    };
  }, [cacheKey, m.id, m.updatedAt]);

  return (
    <div ref={host} className="cover">
      {url ? (
        <img
          src={url}
          alt=""
          onError={() => {
            if (url.includes('/cover/')) {
              void getCover(m.id)
                .then((blob) => {
                  if (!blob) {
                    setUrl('');
                    return;
                  }
                  let objectUrl = coverUrlPool.get(cacheKey);
                  if (!objectUrl) {
                    if (coverUrlPool.size >= MAX_COVER_URLS) {
                      const oldestKey = coverUrlPool.keys().next().value;
                      if (oldestKey) clearCoverUrlPool(oldestKey);
                    }
                    objectUrl = URL.createObjectURL(blob);
                    coverUrlPool.set(cacheKey, objectUrl);
                  }
                  setUrl(objectUrl);
                })
                .catch(() => setUrl(''));
            } else {
              setUrl('');
            }
          }}
        />
      ) : (
        <BookOpen size={24} />
      )}
    </div>
  );
});
