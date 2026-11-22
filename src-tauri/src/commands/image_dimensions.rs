use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::sync::{LazyLock, Mutex};

use crate::commands::cache::percent_decode;
use crate::commands::image::{MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE};

pub const MAX_DIMENSION_CACHE: usize = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeaderDimensions {
    pub width: u32,
    pub height: u32,
}

struct DimensionCache {
    map: HashMap<String, HeaderDimensions>,
    order: VecDeque<String>,
}

impl DimensionCache {
    fn new() -> Self {
        Self {
            map: HashMap::with_capacity(MAX_DIMENSION_CACHE),
            order: VecDeque::with_capacity(MAX_DIMENSION_CACHE),
        }
    }

    fn get(&self, key: &str) -> Option<HeaderDimensions> {
        self.map.get(key).copied()
    }

    #[allow(clippy::map_entry)]
    fn insert(&mut self, key: String, val: HeaderDimensions) {
        if self.map.contains_key(&key) {
            self.map.insert(key, val);
            return;
        }
        if self.map.len() >= MAX_DIMENSION_CACHE {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            }
        }
        self.order.push_back(key.clone());
        self.map.insert(key, val);
    }

    fn clear(&mut self) {
        self.map.clear();
        self.order.clear();
    }
}

static DIMENSION_CACHE: LazyLock<Mutex<DimensionCache>> =
    LazyLock::new(|| Mutex::new(DimensionCache::new()));

fn read_u16_be(b: &[u8], offset: usize) -> u16 {
    u16::from_be_bytes([b[offset], b[offset + 1]])
}

fn read_u16_le(b: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes([b[offset], b[offset + 1]])
}

fn read_u16_endian(b: &[u8], offset: usize, le: bool) -> u16 {
    if le {
        read_u16_le(b, offset)
    } else {
        read_u16_be(b, offset)
    }
}

fn read_u32_be(b: &[u8], offset: usize) -> u32 {
    u32::from_be_bytes([b[offset], b[offset + 1], b[offset + 2], b[offset + 3]])
}

fn read_u32_le(b: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes([b[offset], b[offset + 1], b[offset + 2], b[offset + 3]])
}

fn read_u32_endian(b: &[u8], offset: usize, le: bool) -> u32 {
    if le {
        read_u32_le(b, offset)
    } else {
        read_u32_be(b, offset)
    }
}

/// Parses image dimensions from header bytes (PNG, GIF, WebP, JPEG with EXIF orientation swap,
/// plus fallback to `imagesize::blob_size` for additional formats).
pub fn parse_header_bytes(b: &[u8]) -> Option<HeaderDimensions> {
    let mut width: u32 = 0;
    let mut height: u32 = 0;

    // 1. PNG
    if b.len() >= 24 && read_u32_be(b, 0) == 0x8950_4e47 && read_u32_be(b, 4) == 0x0d0a_1a0a {
        width = read_u32_be(b, 16);
        height = read_u32_be(b, 20);
    }
    // 2. GIF (GIF87a / GIF89a)
    else if b.len() >= 10 && (&b[0..6] == b"GIF87a" || &b[0..6] == b"GIF89a") {
        width = read_u16_le(b, 6) as u32;
        height = read_u16_le(b, 8) as u32;
    }
    // 3. WebP (RIFF....WEBP)
    else if b.len() >= 25 && read_u32_be(b, 0) == 0x5249_4646 && read_u32_be(b, 8) == 0x5745_4250
    {
        let chunk_type = read_u32_be(b, 12);
        if b.len() >= 30
            && chunk_type == 0x5650_3820
            && b[23] == 0x9d
            && b[24] == 0x01
            && b[25] == 0x2a
        {
            width = (read_u16_le(b, 26) & 0x3fff) as u32;
            height = (read_u16_le(b, 28) & 0x3fff) as u32;
        } else if chunk_type == 0x5650_384c && b[20] == 0x2f {
            let bits = read_u32_le(b, 21);
            width = (bits & 0x3fff) + 1;
            height = ((bits >> 14) & 0x3fff) + 1;
        } else if b.len() >= 30 && chunk_type == 0x5650_3858 {
            width = 1 + ((b[24] as u32) | ((b[25] as u32) << 8) | ((b[26] as u32) << 16));
            height = 1 + ((b[27] as u32) | ((b[28] as u32) << 8) | ((b[29] as u32) << 16));
        }
    }
    // 4. JPEG (with EXIF orientation 5..=8 dimension swap)
    else if b.len() > 4 && b[0] == 0xff && b[1] == 0xd8 {
        let mut i = 2usize;
        let mut swap_for_exif = false;

        while i + 3 < b.len() {
            if b[i] != 0xff {
                break;
            }
            i += 1;
            while i < b.len() && b[i] == 0xff {
                i += 1;
            }
            if i >= b.len() {
                break;
            }
            let marker = b[i];
            i += 1;

            if marker == 0xda || marker == 0xd9 {
                break;
            }
            if marker == 0x01 || (0xd0..=0xd7).contains(&marker) {
                continue;
            }
            if i + 2 > b.len() {
                break;
            }
            let length = read_u16_be(b, i) as usize;
            if length < 2 || i + length > b.len() {
                break;
            }

            // EXIF APP1 marker
            if marker == 0xe1
                && length >= 14
                && b[i + 2] == 0x45
                && b[i + 3] == 0x78
                && b[i + 4] == 0x69
                && b[i + 5] == 0x66
                && b[i + 6] == 0
                && b[i + 7] == 0
            {
                let tiff = i + 8;
                if tiff + 8 <= b.len() {
                    let le = read_u16_be(b, tiff) == 0x4949;
                    if read_u16_endian(b, tiff + 2, le) == 0x002a {
                        let ifd_offset = read_u32_endian(b, tiff + 4, le) as usize;
                        if let Some(ifd0) = tiff.checked_add(ifd_offset) {
                            if ifd0 + 2 <= b.len() {
                                let entries = read_u16_endian(b, ifd0, le) as usize;
                                for k in 0..entries {
                                    let entry = ifd0 + 2 + k * 12;
                                    if entry + 12 > b.len() {
                                        break;
                                    }
                                    if read_u16_endian(b, entry, le) == 0x0112 {
                                        let orientation = read_u16_endian(b, entry + 8, le);
                                        if (5..=8).contains(&orientation) {
                                            swap_for_exif = true;
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // SOF markers
            if matches!(
                marker,
                0xc0 | 0xc1
                    | 0xc2
                    | 0xc3
                    | 0xc5
                    | 0xc6
                    | 0xc7
                    | 0xc9
                    | 0xca
                    | 0xcb
                    | 0xcd
                    | 0xce
                    | 0xcf
            ) && length >= 7
            {
                height = read_u16_be(b, i + 3) as u32;
                width = read_u16_be(b, i + 5) as u32;
                if swap_for_exif {
                    std::mem::swap(&mut width, &mut height);
                }
                break;
            }

            i += length;
        }
    }

    // 5. Fallback to imagesize for any other header formats (BMP, AVIF, TIFF, HEIC, etc.)
    if width == 0 || height == 0 {
        if let Ok(dim) = imagesize::blob_size(b) {
            if dim.width <= u32::MAX as usize && dim.height <= u32::MAX as usize {
                width = dim.width as u32;
                height = dim.height as u32;
            }
        }
    }

    if width > 0 && height > 0 && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE {
        let area = (width as u64).checked_mul(height as u64)?;
        if area > 0 && area <= MAX_IMAGE_PIXELS {
            return Some(HeaderDimensions { width, height });
        }
    }

    None
}

#[tauri::command]
pub async fn get_header_dimensions(
    request: tauri::ipc::Request<'_>,
) -> Result<Option<HeaderDimensions>, String> {
    let (cache_key, bytes) = match request.body() {
        tauri::ipc::InvokeBody::Raw(raw_bytes) => {
            let key = request
                .headers()
                .get("x-cache-key")
                .and_then(|v| v.to_str().ok())
                .map(percent_decode)
                .unwrap_or_default();
            if !key.is_empty() {
                if let Ok(cache) = DIMENSION_CACHE.lock() {
                    if let Some(cached) = cache.get(&key) {
                        return Ok(Some(cached));
                    }
                }
            }
            (key, raw_bytes.to_vec())
        }
        tauri::ipc::InvokeBody::Json(json) => {
            let key = json
                .get("cacheKey")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            if !key.is_empty() {
                if let Ok(cache) = DIMENSION_CACHE.lock() {
                    if let Some(cached) = cache.get(&key) {
                        return Ok(Some(cached));
                    }
                }
            }
            let bytes = if let Some(arr) = json.get("bytes").and_then(|v| v.as_array()) {
                let mut vec = Vec::with_capacity(arr.len());
                for item in arr {
                    let val = item
                        .as_u64()
                        .ok_or_else(|| "Invalid byte in bytes array".to_string())?;
                    if val > 255 {
                        return Err("Byte value out of range".to_string());
                    }
                    vec.push(val as u8);
                }
                vec
            } else {
                return Err("Expected raw body or JSON 'bytes' array".to_string());
            };
            (key, bytes)
        }
    };

    let parsed = parse_header_bytes(&bytes);
    if let Some(dim) = parsed {
        if !cache_key.is_empty() {
            if let Ok(mut cache) = DIMENSION_CACHE.lock() {
                cache.insert(cache_key, dim);
            }
        }
    }

    Ok(parsed)
}

#[tauri::command]
pub fn clear_dimension_cache() -> Result<(), String> {
    if let Ok(mut cache) = DIMENSION_CACHE.lock() {
        cache.clear();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_png_header() {
        let png = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x03, 0x20, // width = 800
            0x00, 0x00, 0x04, 0xb0, // height = 1200
        ];
        assert_eq!(
            parse_header_bytes(&png),
            Some(HeaderDimensions {
                width: 800,
                height: 1200
            })
        );
    }

    #[test]
    fn test_parse_gif_header() {
        let gif = [
            b'G', b'I', b'F', b'8', b'9', b'a', 0x90, 0x01, // width = 400
            0x58, 0x02, // height = 600
        ];
        assert_eq!(
            parse_header_bytes(&gif),
            Some(HeaderDimensions {
                width: 400,
                height: 600
            })
        );
    }

    #[test]
    fn test_dimension_cache_eviction() {
        let mut cache = DimensionCache::new();
        for i in 0..MAX_DIMENSION_CACHE {
            cache.insert(
                format!("k-{i}"),
                HeaderDimensions {
                    width: 100,
                    height: 200,
                },
            );
        }
        assert_eq!(cache.map.len(), MAX_DIMENSION_CACHE);
        cache.insert(
            "k-overflow".to_string(),
            HeaderDimensions {
                width: 300,
                height: 400,
            },
        );
        assert_eq!(cache.map.len(), MAX_DIMENSION_CACHE);
        assert!(cache.get("k-0").is_none());
        assert_eq!(
            cache.get("k-overflow"),
            Some(HeaderDimensions {
                width: 300,
                height: 400
            })
        );
    }
}