// Read small headers for common manga formats; other formats use the browser decoder.
import { limits, assertImageDimensions, withinTime } from './limits';

const dimensionCache = new Map<string, { width: number; height: number }>();
const MAX_DIMENSION_CACHE = 1000;

export function clearDimensionCache(): void {
  dimensionCache.clear();
}

export async function headerDimensions(
  file: File,
): Promise<{ width: number; height: number } | undefined> {
  const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
  const cached = dimensionCache.get(cacheKey);
  if (cached) return cached;

  const b = new Uint8Array(
    await withinTime(
      file.slice(0, limits.headerBytes).arrayBuffer(),
      limits.ioTimeoutMs,
      'Reading image header',
    ),
  );
  const v = new DataView(b.buffer);
  let width = 0,
    height = 0;

  // 1. PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
    width = v.getUint32(16);
    height = v.getUint32(20);
  }
  // 2. GIF: GIF87a or GIF89a
  else if (b.length >= 10 && String.fromCharCode(...b.slice(0, 6)).match(/^GIF8[79]a$/)) {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
  }
  // 3. WebP: RIFF .... WEBP
  else if (
    b.length >= 25 &&
    v.getUint32(0) === 0x52494646 && // 'RIFF'
    v.getUint32(8) === 0x57454250 // 'WEBP'
  ) {
    const chunkType = v.getUint32(12);
    // VP8  (lossy) - requires at least 30 bytes
    if (
      b.length >= 30 &&
      chunkType === 0x56503820 &&
      b[23] === 0x9d &&
      b[24] === 0x01 &&
      b[25] === 0x2a
    ) {
      width = v.getUint16(26, true) & 0x3fff;
      height = v.getUint16(28, true) & 0x3fff;
    }
    // VP8L (lossless) - requires at least 25 bytes
    else if (chunkType === 0x5650384c && b[20] === 0x2f) {
      const bits = v.getUint32(21, true);
      width = (bits & 0x3fff) + 1;
      height = ((bits >> 14) & 0x3fff) + 1;
    }
    // VP8X (extended) - requires at least 30 bytes
    else if (b.length >= 30 && chunkType === 0x56503858) {
      width = 1 + (b[24] | (b[25] << 8) | (b[26] << 16));
      height = 1 + (b[27] | (b[28] << 8) | (b[29] << 16));
    }
  }
  // 4. JPEG: FF D8 ...
  else if (b.length > 4 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    let swapForExif = false;
    while (i + 3 < b.length) {
      if (b[i++] !== 255) break;
      while (i < b.length && b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xda || marker === 0xd9) break; // SOS / EOI
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const length = v.getUint16(i);
      if (length < 2 || i + length > b.length) break;

      // APP1 (EXIF): parse orientation tag to swap dimensions if image is rotated 90/270 deg
      if (
        marker === 0xe1 &&
        length >= 14 &&
        b[i + 2] === 0x45 &&
        b[i + 3] === 0x78 &&
        b[i + 4] === 0x69 &&
        b[i + 5] === 0x66 &&
        b[i + 6] === 0 &&
        b[i + 7] === 0
      ) {
        try {
          const tiff = i + 8;
          const le = v.getUint16(tiff) === 0x4949; // 'II' = little endian, 'MM' = big endian
          if (v.getUint16(tiff + 2, le) === 0x002a) {
            const ifdOffset = v.getUint32(tiff + 4, le);
            const ifd0 = tiff + ifdOffset;
            if (ifd0 + 2 <= b.length) {
              const entries = v.getUint16(ifd0, le);
              for (let k = 0; k < entries && ifd0 + 2 + (k + 1) * 12 <= b.length; k++) {
                const entry = ifd0 + 2 + k * 12;
                if (v.getUint16(entry, le) === 0x0112) {
                  // Orientation tag
                  const orientation = v.getUint16(entry + 8, le);
                  if (orientation >= 5 && orientation <= 8) {
                    swapForExif = true;
                  }
                  break;
                }
              }
            }
          }
        } catch {
          // If EXIF parse fails, continue with unswapped dimensions
        }
      }

      // SOF markers
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      ) {
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
        if (swapForExif) {
          const tmp = width;
          width = height;
          height = tmp;
        }
        break;
      }
      i += length;
    }
  }

  if (width > 0 && height > 0) {
    assertImageDimensions(width, height);
    const result = { width, height };
    if (dimensionCache.size >= MAX_DIMENSION_CACHE) {
      const oldest = dimensionCache.keys().next().value;
      if (oldest) dimensionCache.delete(oldest);
    }
    dimensionCache.set(cacheKey, result);
    return result;
  }
  return undefined;
}
