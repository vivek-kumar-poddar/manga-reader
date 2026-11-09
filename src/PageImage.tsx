import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { fileFor, errorMessage, type Manga, type Page } from './data';
import { limits, assertImageDimensions, withinTime } from './limits';
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
const jobs: (() => Promise<void>)[] = [];
let active = 0;
function pump() {
  const limit = matchMedia('(max-width:700px)').matches
    ? limits.mobilePageConcurrency
    : limits.desktopPageConcurrency;
  while (active < limit && jobs.length) {
    active++;
    void jobs.shift()!().finally(() => {
      active--;
      pump();
    });
  }
}
function queue(task: () => Promise<void>) {
  if (jobs.length >= limits.queuedJobs) return false;
  jobs.push(task);
  pump();
  return true;
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
      loading = false,
      objectUrl = '';
    const release = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = '';
      if (live) setUrl('');
    };
    const load = () => {
      if (loading || objectUrl || !wanted) return;
      loading = true;
      const accepted = queue(async () => {
        try {
          if (!live || !wanted) return;
          assertImageDimensions(page.width, page.height);
          let blob: Blob = await fileFor(m, page);
          if (
            lowQuality &&
            matchMedia('(max-width:700px)').matches &&
            page.width > 1000 &&
            page.width * page.height <= limits.imagePixels &&
            Math.max(page.width, page.height) <= limits.imageSide &&
            'createImageBitmap' in window
          ) {
            try {
              let expired = false;
              const task = createImageBitmap(blob, {
                resizeWidth: 1000,
                resizeHeight: Math.max(1, Math.round((page.height * 1000) / page.width)),
                resizeQuality: 'medium',
              });
              // A timed-out decoder may still resolve; release its late bitmap.
              void task.then(
                (bitmap) => {
                  if (expired) bitmap.close();
                },
                () => {},
              );
              const bitmap = await withinTime(task, limits.imageTimeoutMs, 'Resizing image').catch(
                (error) => {
                  expired = true;
                  throw error;
                },
              );
              if (!live || !wanted) {
                bitmap.close();
                return;
              }
              const canvas = document.createElement('canvas');
              try {
                try {
                  canvas.width = bitmap.width;
                  canvas.height = bitmap.height;
                  const context = canvas.getContext('2d');
                  if (!context) throw new Error('Image resizing is unavailable.');
                  context.drawImage(bitmap, 0, 0);
                } finally {
                  bitmap.close();
                }
                blob = await withinTime(
                  new Promise<Blob>((r) => canvas.toBlob((b) => r(b || blob), 'image/webp', 0.8)),
                  limits.imageTimeoutMs,
                  'Encoding image',
                );
              } finally {
                canvas.width = 0;
                canvas.height = 0;
              }
            } catch {
              /* Use the unmodified original when resizing is unavailable. */
            }
          }
          if (live && wanted) {
            objectUrl = URL.createObjectURL(blob);
            setUrl(objectUrl);
            setError('');
          }
        } catch (e) {
          if (live && wanted) {
            const message = errorMessage(e);
            setError(message);
            reportRef.current(message);
          }
        } finally {
          loading = false;
        }
      });
      if (!accepted) {
        loading = false;
        const message = `Image queue is full (${limits.queuedJobs} waiting). Retry this page shortly.`;
        setError(message);
        reportRef.current(message);
      }
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
  }, [m.id, m.handle, m.localPath, page, lowQuality, retry]);
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
