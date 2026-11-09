// Read small headers for common manga formats; other formats use the browser decoder.
import { limits, assertImageDimensions, withinTime } from './limits';
export async function headerDimensions(file: File) {
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
  if (b.length >= 24 && v.getUint32(0) === 0x89504e47 && v.getUint32(4) === 0x0d0a1a0a) {
    width = v.getUint32(16);
    height = v.getUint32(20);
  } else if (b.length >= 10 && String.fromCharCode(...b.slice(0, 6)).match(/^GIF8[79]a$/)) {
    width = v.getUint16(6, true);
    height = v.getUint16(8, true);
  } else if (b.length > 4 && b[0] === 255 && b[1] === 216) {
    let i = 2;
    while (i + 3 < b.length) {
      if (b[i++] !== 255) break;
      while (i < b.length && b[i] === 255) i++;
      const marker = b[i++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xe1) return undefined;
      if (marker === 1 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (i + 2 > b.length) break;
      const length = v.getUint16(i);
      if (length < 2 || i + length > b.length) break;
      if (
        [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
          marker,
        ) &&
        length >= 7
      ) {
        height = v.getUint16(i + 3);
        width = v.getUint16(i + 5);
        break;
      }
      i += length;
    }
  }
  if (width > 0 && height > 0) {
    assertImageDimensions(width, height);
    return { width, height };
  }
  return undefined;
}
