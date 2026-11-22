import { invoke } from '@tauri-apps/api/core';
import { limits, assertImageDimensions, withinTime } from '../limits';
import { invokeCommand } from './runtime';
import { parseFsError } from './errors';
import type { CachedImageResult } from './types';

export async function getImageDimensions(
  absolutePath: string,
): Promise<{ width: number; height: number } | null> {
  try {
    const dim = await invokeCommand('get_image_dimensions', {
      absolutePath,
    });
    if (dim && Array.isArray(dim) && dim.length === 2) {
      return { width: dim[0], height: dim[1] };
    }
    return null;
  } catch (err) {
    console.warn('Tauri getImageDimensions failed for', absolutePath, parseFsError(err) ?? err);
    return null;
  }
}

export async function getHeaderDimensions(
  file: File,
): Promise<{ width: number; height: number } | undefined> {
  try {
    const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
    const buffer = await withinTime(
      file.slice(0, limits.headerBytes).arrayBuffer(),
      limits.ioTimeoutMs,
      'Reading image header',
    );
    const res = await invoke<{ width: number; height: number } | null>(
      'get_header_dimensions',
      new Uint8Array(buffer),
      {
        headers: {
          'x-cache-key': encodeURIComponent(cacheKey),
        },
      },
    );
    if (res && res.width > 0 && res.height > 0) {
      assertImageDimensions(res.width, res.height);
      return res;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export async function decodeImageDimensions(
  file: File,
  signal?: AbortSignal,
): Promise<{ width: number; height: number } | undefined> {
  signal?.throwIfAborted();
  const buffer = await withinTime(
    file.arrayBuffer(),
    limits.ioTimeoutMs,
    'Reading image file',
    signal,
  );
  signal?.throwIfAborted();
  const res = await withinTime(
    invoke<{ width: number; height: number } | null>(
      'decode_image_dimensions',
      new Uint8Array(buffer),
    ),
    limits.imageTimeoutMs,
    'Decoding image dimensions',
    signal,
  );
  if (res && res.width > 0 && res.height > 0) {
    assertImageDimensions(res.width, res.height);
    return res;
  }
  return undefined;
}

export async function generateThumbnailFromBytes(
  file: File,
  quality = 0.65,
  signal?: AbortSignal,
): Promise<Blob | undefined> {
  signal?.throwIfAborted();
  const buffer = await withinTime(
    file.arrayBuffer(),
    limits.ioTimeoutMs,
    'Reading cover file',
    signal,
  );
  signal?.throwIfAborted();
  const res = await withinTime(
    invoke<ArrayBuffer | Uint8Array>('generate_thumbnail_from_bytes', new Uint8Array(buffer), {
      headers: {
        'x-quality': String(quality),
      },
    }),
    limits.coverTimeoutMs,
    'Encoding cover',
    signal,
  );
  const ab =
    res instanceof ArrayBuffer
      ? res
      : res instanceof Uint8Array
        ? (res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength) as ArrayBuffer)
        : null;
  if (!ab || ab.byteLength === 0) return undefined;
  return new Blob([ab], { type: 'image/webp' });
}

export async function downscaleImageBytes(
  blob: Blob,
  targetWidth: number,
  targetHeight: number,
  signal?: AbortSignal,
): Promise<Blob | null> {
  signal?.throwIfAborted();
  const buffer = await withinTime(blob.arrayBuffer(), limits.ioTimeoutMs, 'Reading image', signal);
  signal?.throwIfAborted();
  const res = await withinTime(
    invoke<ArrayBuffer | Uint8Array>('downscale_image_bytes', new Uint8Array(buffer), {
      headers: {
        'x-target-width': String(Math.max(1, Math.round(targetWidth))),
        'x-target-height': String(Math.max(1, Math.round(targetHeight))),
        'x-quality': '0.8',
      },
    }),
    limits.imageTimeoutMs,
    'Resizing image',
    signal,
  );
  const ab =
    res instanceof ArrayBuffer
      ? res
      : res instanceof Uint8Array
        ? (res.buffer.slice(res.byteOffset, res.byteOffset + res.byteLength) as ArrayBuffer)
        : null;
  if (!ab || ab.byteLength === 0) return null;
  return new Blob([ab], { type: 'image/webp' });
}

export async function clearDimensionCache(): Promise<void> {
  try {
    await invokeCommand('clear_dimension_cache');
  } catch {}
}

export async function saveThumbnail(
  id: string,
  buffer: ArrayBuffer | Uint8Array,
): Promise<boolean> {
  try {
    const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    await invoke('save_thumbnail', bytes, {
      headers: {
        'x-id': encodeURIComponent(id),
      },
    });
    return true;
  } catch (err) {
    console.warn('Tauri saveThumbnail failed for', id, parseFsError(err) ?? err);
    return false;
  }
}

export async function getThumbnailUrl(id: string, size?: number): Promise<string | null> {
  try {
    return await invokeCommand('get_thumbnail_url', { id, size: size ?? null });
  } catch (err) {
    console.warn('Tauri getThumbnailUrl failed for', id, parseFsError(err) ?? err);
    return null;
  }
}

export async function generateThumbnail(
  filePath: string,
  id: string,
  size?: number,
): Promise<CachedImageResult | null> {
  try {
    return await invokeCommand('generate_thumbnail', {
      filePath,
      id,
      size: size ?? null,
    });
  } catch (err) {
    console.warn('Tauri generateThumbnail failed for', filePath, id, parseFsError(err) ?? err);
    return null;
  }
}

export async function generateImageVariant(
  filePath: string,
  maxWidth: number,
  maxHeight: number,
): Promise<CachedImageResult | null> {
  try {
    return await invokeCommand('generate_image_variant', {
      filePath,
      maxWidth,
      maxHeight,
    });
  } catch (err) {
    console.warn('Tauri generateImageVariant failed for', filePath, parseFsError(err) ?? err);
    return null;
  }
}

export async function getThumbnail(id: string): Promise<ArrayBuffer | null> {
  try {
    const response = await invokeCommand('read_thumbnail', { id });
    if (response instanceof ArrayBuffer) {
      return response.byteLength > 0 ? response : null;
    }
    if (response instanceof Uint8Array) {
      return response.byteLength > 0
        ? (response.buffer.slice(
            response.byteOffset,
            response.byteOffset + response.byteLength,
          ) as ArrayBuffer)
        : null;
    }
    return null;
  } catch (err) {
    console.warn('Tauri getThumbnail failed for', id, parseFsError(err) ?? err);
    return null;
  }
}

export async function deleteThumbnail(id: string): Promise<void> {
  try {
    await invokeCommand('delete_thumbnail', { id });
  } catch (err) {
    console.warn('Tauri deleteThumbnail failed for', id, parseFsError(err) ?? err);
  }
}

export async function clearThumbnails(): Promise<void> {
  try {
    await invokeCommand('clear_thumbnails');
  } catch (err) {
    console.warn('Tauri clearThumbnails failed:', parseFsError(err) ?? err);
  }
}
