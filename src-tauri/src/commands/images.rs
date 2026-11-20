use fast_image_resize as fr;
use fast_image_resize::PixelType;
use fast_image_resize::images::{Image, ImageRef};
use image::{DynamicImage, RgbaImage};
use std::io::Cursor;

use crate::commands::fs::{ALLOWED_IMAGE_EXTENSIONS, MAX_FILE_READ_BYTES};
use crate::commands::image::{
    IMAGE_RESIZE_POOL, MAX_IMAGE_JOB_MEMORY_BYTES, MAX_IMAGE_PIXELS, MAX_IMAGE_SIDE,
    calculate_fitted_dimensions,
};
use crate::commands::image_dimensions::{HeaderDimensions, parse_header_bytes};

pub const THUMBNAIL_MAX_SIDE: u32 = 1024;
pub const THUMBNAIL_MAX_PIXELS: u64 = 16_000_000;

/// Checks whether a file name or MIME type represents a supported image.
pub fn is_image_file_meta(name: &str, mime_type: &str) -> bool {
    if mime_type.trim().to_ascii_lowercase().starts_with("image/") {
        return true;
    }
    let ext = std::path::Path::new(name)
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase());

    match ext {
        Some(e) => ALLOWED_IMAGE_EXTENSIONS.contains(&e.as_str()),
        None => false,
    }
}

fn validate_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Image dimensions must be positive integer pixels.".into());
    }
    if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
        return Err(format!(
            "Image dimensions ({width}x{height}) exceed maximum side of {MAX_IMAGE_SIDE}."
        ));
    }
    let area = (width as u64)
        .checked_mul(height as u64)
        .ok_or_else(|| "Image area overflow.".to_string())?;
    if area > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Image pixel area ({area}) exceeds limit of {MAX_IMAGE_PIXELS}."
        ));
    }
    let raw_bytes = area
        .checked_mul(4)
        .ok_or_else(|| "Estimated RGBA buffer size overflow.".to_string())?;
    if raw_bytes > MAX_IMAGE_JOB_MEMORY_BYTES {
        return Err(format!(
            "Estimated uncompressed RGBA image memory ({raw_bytes} bytes) exceeds job budget of {MAX_IMAGE_JOB_MEMORY_BYTES} bytes."
        ));
    }
    Ok(())
}

fn safe_decode_bytes(bytes: &[u8]) -> Result<DynamicImage, String> {
    if bytes.is_empty() {
        return Err("Empty file.".into());
    }
    if (bytes.len() as u64) > MAX_FILE_READ_BYTES {
        return Err(format!(
            "Image size ({} bytes) exceeds safety limit of {MAX_FILE_READ_BYTES} bytes.",
            bytes.len()
        ));
    }

    if let Some(header) = parse_header_bytes(bytes) {
        validate_dimensions(header.width, header.height)?;
    }

    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_IMAGE_JOB_MEMORY_BYTES);
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);

    let mut reader = image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to determine image format: {e}"))?;
    reader.limits(limits);

    let decoded = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reader.decode()));

    match decoded {
        Ok(Ok(img)) => {
            validate_dimensions(img.width(), img.height())?;
            Ok(img)
        }
        Ok(Err(e)) => Err(format!("Corrupt image or unsupported format: {e}")),
        Err(_) => Err("Image decoder panicked during decoding.".into()),
    }
}

fn encode_resized_webp(
    src_img: DynamicImage,
    target_width: u32,
    target_height: u32,
    quality: f32,
) -> Result<Vec<u8>, String> {
    validate_dimensions(target_width, target_height)?;

    let safe_quality = if quality.is_finite() {
        let scaled = if quality <= 1.0 {
            quality * 100.0
        } else {
            quality
        };
        scaled.clamp(1.0, 100.0)
    } else {
        80.0
    };

    let rgba = src_img.to_rgba8();
    let (src_w, src_h) = (rgba.width(), rgba.height());

    if src_w == target_width && src_h == target_height {
        let out = webp::Encoder::from_rgba(rgba.as_raw(), target_width, target_height)
            .encode(safe_quality)
            .to_vec();
        return Ok(out);
    }

    let src = ImageRef::new(src_w, src_h, rgba.as_raw(), PixelType::U8x4)
        .map_err(|e| format!("Failed to create source image buffer: {e}"))?;

    let mut dst = Image::new(target_width, target_height, PixelType::U8x4);
    let mut resizer = fr::Resizer::new();
    resizer
        .resize(&src, &mut dst, None)
        .map_err(|e| format!("Image resize failed: {e}"))?;

    let dst_rgba = RgbaImage::from_raw(target_width, target_height, dst.into_vec())
        .ok_or_else(|| "Failed to construct destination RgbaImage".to_string())?;

    let out = webp::Encoder::from_rgba(dst_rgba.as_raw(), target_width, target_height)
        .encode(safe_quality)
        .to_vec();

    Ok(out)
}

/// Decodes image dimensions from raw bytes: fast header parse first, full decode fallback second.
pub fn decode_dimensions_from_bytes(bytes: &[u8]) -> Result<Option<HeaderDimensions>, String> {
    if bytes.is_empty() {
        return Err("Empty file.".into());
    }
    if (bytes.len() as u64) > MAX_FILE_READ_BYTES {
        return Err(format!(
            "Image size ({} bytes) exceeds safety limit of {MAX_FILE_READ_BYTES} bytes.",
            bytes.len()
        ));
    }

    if let Some(dim) = parse_header_bytes(bytes) {
        return Ok(Some(dim));
    }

    match safe_decode_bytes(bytes) {
        Ok(img) => Ok(Some(HeaderDimensions {
            width: img.width(),
            height: img.height(),
        })),
        Err(_) => Ok(None),
    }
}

/// Generates a fitted WebP thumbnail (max 1024x1024) from raw image bytes.
/// Returns `Ok(None)` if header dimensions exceed thumbnail pixel/side limits.
pub fn thumbnail_from_bytes_internal(bytes: &[u8], quality: f32) -> Result<Option<Vec<u8>>, String> {
    if bytes.is_empty() {
        return Err("Empty file.".into());
    }
    if (bytes.len() as u64) > MAX_FILE_READ_BYTES {
        return Err("Cover file exceeds maximum allowed size.".into());
    }

    if let Some(size) = parse_header_bytes(bytes) {
        let area = (size.width as u64).saturating_mul(size.height as u64);
        if area > THUMBNAIL_MAX_PIXELS || size.width.max(size.height) > MAX_IMAGE_SIDE {
            return Ok(None);
        }
    }

    let decoded = safe_decode_bytes(bytes)?;
    let (src_w, src_h) = (decoded.width(), decoded.height());
    let area = (src_w as u64).saturating_mul(src_h as u64);
    if area > THUMBNAIL_MAX_PIXELS || src_w.max(src_h) > MAX_IMAGE_SIDE {
        return Ok(None);
    }

    let (target_w, target_h) =
        calculate_fitted_dimensions(src_w, src_h, THUMBNAIL_MAX_SIDE, THUMBNAIL_MAX_SIDE);
    let encoded = encode_resized_webp(decoded, target_w, target_h, quality)?;
    Ok(Some(encoded))
}

/// Downscales an image from raw bytes to exact target dimensions and encodes as WebP.
pub fn downscale_bytes_internal(
    bytes: &[u8],
    target_width: u32,
    target_height: u32,
    quality: f32,
) -> Result<Vec<u8>, String> {
    validate_dimensions(target_width, target_height)?;
    let decoded = safe_decode_bytes(bytes)?;
    encode_resized_webp(decoded, target_width, target_height, quality)
}

fn extract_raw_or_json_bytes(request: &tauri::ipc::Request<'_>) -> Result<Vec<u8>, String> {
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(raw) => raw.to_vec(),
        tauri::ipc::InvokeBody::Json(json) => {
            if let Some(arr) = json.get("bytes").and_then(|v| v.as_array()) {
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
                return Err("Expected raw binary body or JSON 'bytes' array".into());
            }
        }
    };

    if (bytes.len() as u64) > MAX_FILE_READ_BYTES {
        return Err(format!(
            "Image payload ({} bytes) exceeds maximum allowed size of {MAX_FILE_READ_BYTES} bytes.",
            bytes.len()
        ));
    }

    Ok(bytes)
}

fn header_f32(request: &tauri::ipc::Request<'_>, header_name: &str, json_key: &str) -> Option<f32> {
    if let Some(val) = request
        .headers()
        .get(header_name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<f32>().ok())
    {
        return Some(val);
    }
    if let tauri::ipc::InvokeBody::Json(json) = request.body() {
        if let Some(val) = json.get(json_key).and_then(|v| v.as_f64()) {
            return Some(val as f32);
        }
    }
    None
}

fn header_u32(request: &tauri::ipc::Request<'_>, header_name: &str, json_key: &str) -> Option<u32> {
    if let Some(val) = request
        .headers()
        .get(header_name)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u32>().ok())
    {
        return Some(val);
    }
    if let tauri::ipc::InvokeBody::Json(json) = request.body() {
        if let Some(val) = json.get(json_key).and_then(|v| v.as_u64()) {
            if val <= u32::MAX as u64 {
                return Some(val as u32);
            }
        }
    }
    None
}

#[tauri::command]
pub fn is_image_file(name: String, mime_type: String) -> bool {
    is_image_file_meta(&name, &mime_type)
}

#[tauri::command]
pub async fn decode_image_dimensions(
    request: tauri::ipc::Request<'_>,
) -> Result<Option<HeaderDimensions>, String> {
    let bytes = extract_raw_or_json_bytes(&request)?;
    tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| decode_dimensions_from_bytes(&bytes))
    })
    .await
    .map_err(|e| format!("Dimension decode task join error: {e}"))?
}

#[tauri::command]
pub async fn generate_thumbnail_from_bytes(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = extract_raw_or_json_bytes(&request)?;
    let quality = header_f32(&request, "x-quality", "quality").unwrap_or(0.65);

    let encoded_opt = tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| thumbnail_from_bytes_internal(&bytes, quality))
    })
    .await
    .map_err(|e| format!("Thumbnail task join error: {e}"))??;

    Ok(tauri::ipc::Response::new(encoded_opt.unwrap_or_default()))
}

#[tauri::command]
pub async fn downscale_image_bytes(
    request: tauri::ipc::Request<'_>,
) -> Result<tauri::ipc::Response, String> {
    let bytes = extract_raw_or_json_bytes(&request)?;
    let target_width = header_u32(&request, "x-target-width", "targetWidth")
        .ok_or_else(|| "Missing x-target-width header".to_string())?;
    let target_height = header_u32(&request, "x-target-height", "targetHeight")
        .ok_or_else(|| "Missing x-target-height header".to_string())?;
    let quality = header_f32(&request, "x-quality", "quality").unwrap_or(0.8);

    let encoded = tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| {
            downscale_bytes_internal(&bytes, target_width, target_height, quality)
        })
    })
    .await
    .map_err(|e| format!("Downscale task join error: {e}"))??;

    Ok(tauri::ipc::Response::new(encoded))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_png_bytes(width: u32, height: u32) -> Vec<u8> {
        let img = DynamicImage::ImageRgba8(RgbaImage::from_fn(width, height, |_, _| {
            image::Rgba([64, 128, 192, 255])
        }));
        let mut out = Cursor::new(Vec::new());
        img.write_to(&mut out, image::ImageFormat::Png)
            .expect("Must encode test PNG");
        out.into_inner()
    }

    #[test]
    fn test_is_image_file_meta() {
        assert!(is_image_file_meta("001.jpg", ""));
        assert!(is_image_file_meta("cover.WEBP", ""));
        assert!(is_image_file_meta("no_ext", "image/png"));
        assert!(!is_image_file_meta("archive.zip", "application/zip"));
        assert!(!is_image_file_meta("notes.txt", "text/plain"));
    }

    #[test]
    fn test_decode_dimensions_from_bytes() {
        let png = make_png_bytes(120, 240);
        let dim = decode_dimensions_from_bytes(&png)
            .expect("Must succeed")
            .expect("Must parse PNG dimensions");
        assert_eq!(dim.width, 120);
        assert_eq!(dim.height, 240);

        assert!(decode_dimensions_from_bytes(&[]).is_err());
        assert_eq!(decode_dimensions_from_bytes(b"not an image").unwrap(), None);
    }

    #[test]
    fn test_thumbnail_from_bytes_internal() {
        let png = make_png_bytes(2048, 1024);
        let thumb_bytes = thumbnail_from_bytes_internal(&png, 0.65)
            .expect("Thumbnail must succeed")
            .expect("Thumbnail must be generated");
        let decoded = image::load_from_memory(&thumb_bytes).expect("Must decode WebP thumbnail");
        assert_eq!(decoded.width(), 1024);
        assert_eq!(decoded.height(), 512);
    }

    #[test]
    fn test_downscale_bytes_internal() {
        let png = make_png_bytes(800, 1200);
        let scaled = downscale_bytes_internal(&png, 400, 600, 0.8).expect("Downscale must succeed");
        let decoded = image::load_from_memory(&scaled).expect("Must decode WebP output");
        assert_eq!(decoded.width(), 400);
        assert_eq!(decoded.height(), 600);

        // Zero dimensions rejected
        assert!(downscale_bytes_internal(&png, 0, 600, 0.8).is_err());
    }
}