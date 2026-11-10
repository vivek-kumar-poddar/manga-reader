import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { fileFor, errorMessage, type Manga, type Page } from './data';
import { limits, assertImageDimensions } from './limits';
import { enqueueImage, type CancelHandle } from './imageQueue';
import { downscaleImage } from './images';

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

export default memo(function PageImage({
  m,
  page,
  index,
  lowQuality,
  report,
  retryPreparation,
}: {
  m: Manga;
  page: Page;
  index: number;
  lowQuality: boolean;
  report: (message: string) => void;
  retryPreparation: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const reportRef = useRef(report);
  reportRef.current = report;

  useEffect(() => {
    if (page.dimensionsPending) return;
    let live = true,
      wanted = false,
      cancelTask: CancelHandle | null = null,
      objectUrl = '';

    const release = () => {
      if (cancelTask) {
        cancelTask();
        cancelTask = null;
      }
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      if (live) setUrl('');
    };

    const load = () => {
      if (objectUrl || !wanted) return;
      const taskKey = `${m.id}:${m.updatedAt}:${page.path}:${lowQuality ? 'low' : 'full'}`;
      const cancel = enqueueImage({
        key: taskKey,
        priority: 10,
        run: async (signal) => {
          try {
            if (!live || !wanted || signal.aborted) return;
            assertImageDimensions(page.width, page.height);
            let blob: Blob = await fileFor(m, page);
            if (!live || !wanted || signal.aborted) return;

            if (
              lowQuality &&
              typeof matchMedia === 'function' &&
              matchMedia('(max-width:700px)').matches &&
              page.width > 1000 &&
              page.width * page.height <= limits.imagePixels &&
              Math.max(page.width, page.height) <= limits.imageSide
            ) {
              try {
                blob = await downscaleImage(
                  blob,
                  1000,
                  Math.max(1, Math.round((page.height * 1000) / page.width)),
                  signal,
                );
              } catch {
                /* Use original unmodified blob if downscaling is unavailable or fails */
              }
            }

            if (live && wanted && !signal.aborted) {
              objectUrl = URL.createObjectURL(blob);
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
  }, [m.id, m.updatedAt, m.handle, m.localPath, page, lowQuality, retry]);

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
});
