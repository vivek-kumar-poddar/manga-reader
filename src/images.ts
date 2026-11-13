import { headerDimensions } from './imageDimensions';
import { limits, assertImageDimensions, withinTime } from './limits';

export const imageFile = (f: Pick<File, 'name' | 'type'>): boolean =>
  f.type.startsWith('image/') ||
  /\.(jpe?g|png|webp|avif|gif|bmp|svg|ico|heic|heif|tiff?)$/i.test(f.name);

export async function dimensions(
  f: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number }> {
  signal?.throwIfAborted();
  const header = await headerDimensions(f);
  signal?.throwIfAborted();
  if (header) return header;

  const url = URL.createObjectURL(f);
  try {
    return await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const im = new Image();
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        im.onload = null;
        im.onerror = null;
        try {
          if (error) reject(error);
          else {
            assertImageDimensions(im.naturalWidth, im.naturalHeight);
            resolve({ width: im.naturalWidth, height: im.naturalHeight });
          }
        } catch (e) {
          reject(e);
        } finally {
          im.src = '';
        }
      };
      const abort = () => finish(new DOMException('Import cancelled', 'AbortError'));
      const timer = setTimeout(
        () => finish(new Error('Image took too long to read. Retry this file.')),
        limits.imageTimeoutMs,
      );
      signal?.addEventListener('abort', abort, { once: true });
      im.onload = () => finish();
      im.onerror = () =>
        finish(new Error('Corrupt image or a format this browser cannot display.'));
      im.src = url;
      if (signal?.aborted) abort();
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function thumbnail(
  file: File,
  signal?: AbortSignal,
  quality = 0.65,
): Promise<Blob | undefined> {
  signal?.throwIfAborted();
  const size = await headerDimensions(file);
  signal?.throwIfAborted();
  if (
    size &&
    (size.width * size.height > limits.imagePixels ||
      Math.max(size.width, size.height) > limits.imageSide)
  ) {
    return undefined;
  }

  const url = URL.createObjectURL(file);
  try {
    const im = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const finish = (error?: Error, result?: HTMLImageElement) => {
        if (settled) return;
        settled = true;
        clearTimeout(t);
        signal?.removeEventListener('abort', onAbort);
        img.onload = null;
        img.onerror = null;
        if (error) {
          img.src = '';
          reject(error);
        } else if (result) {
          resolve(result);
        }
      };
      const onAbort = () => finish(new DOMException('Cover decode aborted', 'AbortError'));
      const t = setTimeout(() => finish(new Error('Cover timed out')), limits.coverTimeoutMs);
      signal?.addEventListener('abort', onAbort, { once: true });
      img.onload = () => finish(undefined, img);
      img.onerror = () => finish(new Error('Cover unavailable'));
      img.src = url;
      if (signal?.aborted) onAbort();
    });

    try {
      assertImageDimensions(im.naturalWidth, im.naturalHeight);
      const c = document.createElement('canvas');
      try {
        const scale = Math.min(160 / im.naturalWidth, 320 / im.naturalHeight);
        c.width = Math.max(1, Math.round(im.naturalWidth * scale));
        c.height = Math.max(1, Math.round(im.naturalHeight * scale));
        const ctx = c.getContext('2d');
        if (!ctx) return undefined;
        ctx.drawImage(im, 0, 0, c.width, c.height);
        return await withinTime(
          new Promise<Blob | undefined>((r) =>
            c.toBlob((b) => r(b ?? undefined), 'image/webp', quality),
          ),
          limits.coverTimeoutMs,
          'Encoding cover',
        );
      } finally {
        c.width = 0;
        c.height = 0;
      }
    } finally {
      im.src = '';
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downscaleImage(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
  signal?: AbortSignal,
): Promise<Blob> {
  signal?.throwIfAborted();
  if (typeof window === 'undefined' || !('createImageBitmap' in window)) {
    return blob;
  }

  let expired = false;
  const isConstrained =
    typeof navigator !== 'undefined' &&
    (Boolean(navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) ||
      Boolean(
        (navigator as unknown as { deviceMemory?: number }).deviceMemory &&
        (navigator as unknown as { deviceMemory?: number }).deviceMemory! <= 4,
      ));
  const resizeQuality: ResizeQuality = isConstrained ? 'low' : 'medium';

  const task = createImageBitmap(blob, {
    resizeWidth: targetWidth,
    resizeHeight: targetHeight,
    resizeQuality,
  });

  void task.then(
    (bitmap) => {
      if (expired || signal?.aborted) {
        bitmap.close();
      }
    },
    () => { },
  );

  const onAbort = () => {
    expired = true;
  };
  signal?.addEventListener('abort', onAbort, { once: true });

  let bitmap: ImageBitmap;
  try {
    bitmap = await withinTime(task, limits.imageTimeoutMs, 'Resizing image');
  } catch (error) {
    expired = true;
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }

  if (signal?.aborted) {
    bitmap.close();
    throw new DOMException('Image resize aborted', 'AbortError');
  }

  const canvas = document.createElement('canvas');
  try {
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Image resizing canvas context is unavailable.');
    }
    context.drawImage(bitmap, 0, 0);
  } finally {
    bitmap.close();
  }

  try {
    return await withinTime(
      new Promise<Blob>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException('Image encoding aborted', 'AbortError'));
          return;
        }
        canvas.toBlob(
          (result) => {
            if (signal?.aborted) {
              reject(new DOMException('Image encoding aborted', 'AbortError'));
            } else {
              resolve(result || blob);
            }
          },
          'image/webp',
          0.8,
        );
      }),
      limits.imageTimeoutMs,
      'Encoding image',
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}