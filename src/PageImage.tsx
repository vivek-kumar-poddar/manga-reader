import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { fileFor, errorMessage, type Manga, type Page } from './data';
import { limits, assertImageDimensions } from './limits';
import { enqueueImage, reprioritizeImage, type CancelHandle } from './imageQueue';
import { downscaleImage } from './images';
import { getObjectUrl, storeObjectUrl } from './objectUrlPool';
import { desktopAPI } from './tauriBridge';

const watched = new Map<Element, (visible: boolean) => void>();
let observer: IntersectionObserver | undefined;

function observe(element: Element, callback: (visible: boolean) => void) {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const entry of entries) watched.get(entry.target)?.(entry.isIntersecting);
    },
    { rootMargin: '180% 0px' },
  );
  watched.set(element, callback);
  observer.observe(element);
  return () => {
    watched.delete(element);
    observer?.unobserve(element);
    if (!watched.size) {
      observer?.disconnect();
      observer = undefined;
    }
  };
}

interface PageImageProps {
  m: Manga;
  page: Page;
  index: number;
  activePage?: number;
  lowQuality: boolean;
  report: (message: string) => void;
  retryPreparation: () => void;
}

function PageImage({
  m,
  page,
  index,
  activePage,
  lowQuality,
  report,
  retryPreparation,
}: PageImageProps) {
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [useBlobFallback, setUseBlobFallback] = useState(false);
  const reportRef = useRef(report);
  reportRef.current = report;

  const currentActive = activePage ?? index;
  const distance = Math.abs(index - currentActive);
  const priority = Math.max(1, 100 - distance * 10);

  const { path: pagePath, width: pageWidth, height: pageHeight, dimensionsPending } = page;
  const {
    id: mangaId,
    updatedAt: mangaUpdatedAt,
    handle: mangaHandle,
    localPath: mangaLocalPath,
  } = m;

  // Auto-resolve pending dimensions via native Rust header parser on desktop
  useEffect(() => {
    if (!dimensionsPending) return;
    let live = true;
    if (desktopAPI.isDesktop && desktopAPI.getImageDimensions && mangaLocalPath) {
      const sep = mangaLocalPath.includes('\\') ? '\\' : '/';
      const absPath = mangaLocalPath + sep + pagePath.split('/').join(sep);
      void desktopAPI
        .getImageDimensions(absPath)
        .then((dim) => {
          if (!live || !dim || dim.width <= 0 || dim.height <= 0) return;
          page.width = dim.width;
          page.height = dim.height;
          page.dimensionsPending = false;
          setRetry((r) => r + 1);
        })
        .catch(() => {
          // Fall through to manual retry or background preparation
        });
    }
    return () => {
      live = false;
    };
  }, [dimensionsPending, mangaLocalPath, pagePath, page]);

  // Dynamically update priority for waiting tasks as user scrolls near/far
  useEffect(() => {
    if (dimensionsPending) return;
    const taskKey = `${mangaId}:${mangaUpdatedAt}:${pagePath}:${lowQuality ? 'low' : 'full'}`;
    reprioritizeImage(taskKey, priority);
  }, [mangaId, mangaUpdatedAt, pagePath, lowQuality, priority, dimensionsPending]);

  useEffect(() => {
    if (dimensionsPending) return;
    let live = true,
      wanted = false,
      cancelTask: CancelHandle | null = null,
      objectUrl = '';

    // Fast zero-copy path on desktop: use native custom URI scheme mangaimg:
    if (!useBlobFallback && desktopAPI.isDesktop && desktopAPI.convertFileSrc && mangaLocalPath) {
      const sep = mangaLocalPath.includes('\\') ? '\\' : '/';
      const absPath = mangaLocalPath + sep + pagePath.split('/').join(sep);
      const customSrc = desktopAPI.convertFileSrc(absPath, 'mangaimg');

      const stop = host.current
        ? observe(host.current, (visible) => {
            if (!live) return;
            if (visible) {
              setUrl(customSrc);
              setError('');
            } else {
              setUrl('');
            }
          })
        : () => {};

      return () => {
        live = false;
        stop();
      };
    }

    const release = () => {
      if (cancelTask) {
        cancelTask();
        cancelTask = null;
      }
      objectUrl = '';
      if (live) setUrl('');
    };

    const load = () => {
      if (objectUrl || !wanted) return;
      const taskKey = `${mangaId}:${mangaUpdatedAt}:${pagePath}:${lowQuality ? 'low' : 'full'}`;

      // Check LRU Object URL Pool first for instant scroll-back
      const cached = getObjectUrl(taskKey);
      if (cached) {
        objectUrl = cached;
        setUrl(cached);
        setError('');
        return;
      }

      const cancel = enqueueImage({
        key: taskKey,
        priority,
        run: async (signal) => {
          try {
            if (!live || !wanted || signal.aborted) return;
            assertImageDimensions(pageWidth, pageHeight);
            let blob: Blob = await fileFor(m, page);
            if (!live || !wanted || signal.aborted) return;

            if (
              lowQuality &&
              typeof matchMedia === 'function' &&
              matchMedia('(max-width:700px)').matches &&
              pageWidth > 1000 &&
              pageWidth * pageHeight <= limits.imagePixels &&
              Math.max(pageWidth, pageHeight) <= limits.imageSide
            ) {
              const targetHeight = Math.max(1, Math.round((pageHeight * 1000) / pageWidth));
              let handled = false;
              if (desktopAPI.isDesktop && desktopAPI.generateImageVariant && m.localPath) {
                try {
                  const absPath = `${m.localPath.replace(/[/\\]+$/, '')}/${page.path.replace(/^[/\\]+/, '')}`;
                  const variantRes = await desktopAPI.generateImageVariant(
                    absPath,
                    1000,
                    targetHeight,
                  );
                  if (variantRes?.url) {
                    if (live && wanted && !signal.aborted) {
                      setUrl(variantRes.url);
                      setError('');
                    }
                    handled = true;
                    return;
                  }
                } catch {
                  /* Fallback to downscaleImage */
                }
              }
              if (!handled) {
                try {
                  blob = await downscaleImage(blob, 1000, targetHeight, signal);
                } catch {
                  /* Use original unmodified blob if downscaling is unavailable or fails */
                }
              }
            }

            if (live && wanted && !signal.aborted) {
              objectUrl = URL.createObjectURL(blob);
              storeObjectUrl(taskKey, objectUrl);
              setUrl(objectUrl);
              setError('');
            }
          } catch (e) {
            if (live && wanted && !signal.aborted) {
              const message = errorMessage(e);
              setError(message);
              reportRef.current(message);
            }
          }
        },
      });

      if (!cancel) {
        const message = `Image queue is full (${limits.queuedJobs} waiting). Retry this page shortly.`;
        setError(message);
        reportRef.current(message);
        return;
      }
      cancelTask = cancel;
    };

    const stop = host.current
      ? observe(host.current, (v) => {
          wanted = v;
          if (v) load();
          else release();
        })
      : () => {};

    return () => {
      live = false;
      stop();
      release();
    };
  }, [
    mangaId,
    mangaUpdatedAt,
    mangaHandle,
    mangaLocalPath,
    pagePath,
    pageWidth,
    pageHeight,
    Boolean(dimensionsPending),
    lowQuality,
    retry,
    useBlobFallback,
  ]);

  return (
    <div
      ref={host}
      data-page={index}
      className="reader-page"
      style={
        {
          aspectRatio: `${page.width}/${page.height}`,
          '--native-width': page.width + 'px',
          '--page-ratio': page.width / page.height,
        } as CSSProperties
      }
    >
      {page.dimensionsPending ? (
        <button className="page-retry" onClick={retryPreparation}>
          Page {index + 1}: Dimensions unavailable. Retry preparation.
        </button>
      ) : error ? (
        <button
          className="page-retry"
          onClick={() => {
            setError('');
            setUseBlobFallback(false);
            setRetry((x) => x + 1);
          }}
        >
          Page {index + 1}: {error} Tap to retry.
        </button>
      ) : url ? (
        <img
          src={url}
          alt={`Page ${index + 1}: ${page.name}`}
          draggable={false}
          decoding="async"
          onError={() => {
            if (!useBlobFallback && desktopAPI.isDesktop && mangaLocalPath) {
              // Gracefully fall back to the blob IPC path before showing an error
              setUseBlobFallback(true);
              return;
            }
            const message = `Page ${index + 1} (${page.name}): This browser could not decode the image. It may be damaged, unsupported, or too large for this device. Try another browser or a smaller copy of this image.`;
            setError(message);
            reportRef.current(message);
          }}
        />
      ) : (
        <span className="page-number-placeholder">{index + 1}</span>
      )}
    </div>
  );
}

function arePropsEqual(prev: PageImageProps, next: PageImageProps): boolean {
  const prevNear = Math.abs(prev.index - (prev.activePage ?? prev.index)) <= 1;
  const nextNear = Math.abs(next.index - (next.activePage ?? next.index)) <= 1;

  return (
    prev.index === next.index &&
    prevNear === nextNear &&
    prev.lowQuality === next.lowQuality &&
    prev.m.id === next.m.id &&
    prev.m.updatedAt === next.m.updatedAt &&
    prev.m.handle === next.m.handle &&
    prev.m.localPath === next.m.localPath &&
    prev.page.path === next.page.path &&
    prev.page.width === next.page.width &&
    prev.page.height === next.page.height &&
    prev.page.name === next.page.name &&
    Boolean(prev.page.dimensionsPending) === Boolean(next.page.dimensionsPending)
  );
}

export default memo(PageImage, arePropsEqual);
