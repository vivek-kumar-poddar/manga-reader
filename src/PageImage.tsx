import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { fileFor, errorMessage, type Manga, type Page } from './data';
import { limits, assertImageDimensions } from './limits';
import { enqueueImage, reprioritizeImage, type CancelHandle } from './imageQueue';
import { downscaleImage } from './images';
import { getObjectUrl, storeObjectUrl } from './objectUrlPool';

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
              try {
                blob = await downscaleImage(
                  blob,
                  1000,
                  Math.max(1, Math.round((pageHeight * 1000) / pageWidth)),
                  signal,
                );
              } catch {
                /* Use original unmodified blob if downscaling is unavailable or fails */
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
