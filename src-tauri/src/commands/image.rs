use fast_image_resize as fr;
use fast_image_resize::images::Image;
use fast_image_resize::PixelType;
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Manager};

pub const MAX_IMAGE_PIXELS: u64 = 16_000_000; // 16M pixels
pub const MAX_IMAGE_SIDE: u32 = 32_768; // 32,768 per side
pub const THUMBNAIL_MAX_WIDTH: u32 = 160;
pub const THUMBNAIL_MAX_HEIGHT: u32 = 320;

pub fn calculate_fitted_dimensions(
    src_w: u32,
    src_h: u32,
    max_w: u32,
    max_h: u32,
) -> (u32, u32) {
    if src_w == 0 || src_h == 0 {
        return (1, 1);
    }
    let scale = (max_w as f64 / src_w as f64)
        .min(max_h as f64 / src_h as f64)
        .min(1.0);
    let target_w = (src_w as f64 * scale).round().max(1.0) as u32;
    let target_h = (src_h as f64 * scale).round().max(1.0) as u32;
    (target_w, target_h)
}

pub static IMAGE_RESIZE_POOL: LazyLock<rayon::ThreadPool> = LazyLock::new(|| {
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(2, 6);
    rayon::ThreadPoolBuilder::new()
        .num_threads(threads)
        .thread_name(|idx| format!("image-resize-{}", idx))
        .build()
        .expect("Failed to initialize bounded image thread pool")
});

pub fn resize_image_fir(
    src_img: DynamicImage,
    target_width: u32,
    target_height: u32,
) -> Result<Vec<u8>, String> {
    let rgba = src_img.to_rgba8();
    let (src_w, src_h) = (rgba.width(), rgba.height());

    let src = Image::from_vec_u8(src_w, src_h, rgba.into_raw(), PixelType::U8x4)
        .map_err(|e| format!("Failed to create source image buffer: {e}"))?;

    let mut dst = Image::new(target_width, target_height, PixelType::U8x4);
    let mut resizer = fr::Resizer::new();
    resizer
        .resize(&src, &mut dst, None)
        .map_err(|e| format!("Image resize failed: {e}"))?;

    let dst_rgba = RgbaImage::from_raw(target_width, target_height, dst.into_vec())
        .ok_or_else(|| "Failed to construct destination RgbaImage".to_string())?;

    let dyn_dst = DynamicImage::ImageRgba8(dst_rgba);
    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);

    // Try WebP first; fallback to JPEG if WebP encoding fails
    if dyn_dst.write_to(&mut cursor, ImageFormat::WebP).is_err() {
        out.clear();
        let rgb_img = dyn_dst.to_rgb8();
        let mut cursor = Cursor::new(&mut out);
        DynamicImage::ImageRgb8(rgb_img)
            .write_to(&mut cursor, ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode image to JPEG: {e}"))?;
    }

    Ok(out)
}

/// Creates a neutral placeholder image in WebP format when decoding is unsupported
/// (e.g. AVIF, JXL, HEIC, SVG) or when image data is corrupted.
pub fn create_placeholder_webp(width: u32, height: u32) -> Result<Vec<u8>, String> {
    let w = width.clamp(1, MAX_IMAGE_SIDE);
    let h = height.clamp(1, MAX_IMAGE_SIDE);
    let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        w,
        h,
        image::Rgba([39, 39, 42, 255]), // #27272a neutral gray
    ));
    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    if img.write_to(&mut cursor, ImageFormat::WebP).is_err() {
        out.clear();
        let rgb_img = img.to_rgb8();
        let mut cursor = Cursor::new(&mut out);
        DynamicImage::ImageRgb8(rgb_img)
            .write_to(&mut cursor, ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to encode placeholder to JPEG: {e}"))?;
    }
    Ok(out)
}

/// Safely decodes an image with strict memory limits and catch_unwind protection
/// against decoder panics.
pub fn safe_decode_image(path: &Path) -> Result<DynamicImage, String> {
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(64 * 1024 * 1024); // 64 MiB allocation ceiling
    limits.max_image_width = Some(MAX_IMAGE_SIDE);
    limits.max_image_height = Some(MAX_IMAGE_SIDE);

    let mut reader = image::ImageReader::open(path)
        .map_err(|e| format!("Failed to open image file: {e}"))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to determine image format: {e}"))?;

    reader.limits(limits);

    let decode_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| reader.decode()));

    match decode_result {
        Ok(Ok(img)) => {
            let (w, h) = (img.width(), img.height());
            if w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE || (w as u64 * h as u64) > MAX_IMAGE_PIXELS {
                return Err("Decoded image exceeds size or pixel limits".into());
            }
            Ok(img)
        }
        Ok(Err(e)) => Err(format!("Failed to decode image: {e}")),
        Err(_) => Err("Image decoder panicked during decoding".into()),
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CachedImageResult {
    pub path: String,
    pub url: String,
}

#[tauri::command]
pub async fn generate_thumbnail(
    app: AppHandle,
    file_path: String,
    id: String,
) -> Result<CachedImageResult, String> {
    let trimmed = file_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }

    let resolved = dunce::canonicalize(&trimmed)
        .map_err(|e| format!("Failed to resolve image path '{trimmed}': {e}"))?;

    let allowed = app.state::<crate::commands::fs::AllowedRoots>();
    if !allowed.is_allowed(&resolved) {
        return Err(format!(
            "Path '{}' is not under an allowed library root",
            resolved.display()
        ));
    }

    // Check header dimensions first to respect limits before decoding
    let (w, h) = crate::commands::fs::parse_image_dimensions(&resolved);
    if let (Some(width), Some(height)) = (w, h) {
        if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
            return Err(format!(
                "Image dimensions ({width}x{height}) exceed maximum allowed side of {MAX_IMAGE_SIDE}"
            ));
        }
        if (width as u64 * height as u64) > MAX_IMAGE_PIXELS {
            return Err("Image pixel area exceeds 16M pixel limit".into());
        }
    }

    let thumb_path = crate::commands::cache::get_thumbnail_path(&app, &id)?;

    if thumb_path.exists() {
        return Ok(CachedImageResult {
            path: thumb_path.to_string_lossy().to_string(),
            url: crate::protocol::path_to_mangaimg_url(&thumb_path),
        });
    }

    let thumb_path_clone = thumb_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
            let bytes = match safe_decode_image(&resolved) {
                Ok(decoded) => {
                    let (src_w, src_h) = (decoded.width(), decoded.height());
                    let (target_w, target_h) = calculate_fitted_dimensions(
                        src_w,
                        src_h,
                        THUMBNAIL_MAX_WIDTH,
                        THUMBNAIL_MAX_HEIGHT,
                    );
                    resize_image_fir(decoded, target_w, target_h)?
                }
                Err(_) => {
                    // Fall back to clean placeholder for unsupported codecs (avif, jxl, heic) or decode errors
                    create_placeholder_webp(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT)?
                }
            };

            if let Some(parent) = thumb_path_clone.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            crate::commands::fs::write_atomic(&thumb_path_clone, &bytes)
                .map_err(|e| format!("Failed to write thumbnail: {e}"))?;

            Ok(())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(CachedImageResult {
        path: thumb_path.to_string_lossy().to_string(),
        url: crate::protocol::path_to_mangaimg_url(&thumb_path),
    })
}

pub fn generate_thumbnail_direct(
    app: &AppHandle,
    resolved: &Path,
    id: &str,
) -> Result<PathBuf, String> {
    let (w, h) = crate::commands::fs::parse_image_dimensions(resolved);
    if let (Some(width), Some(height)) = (w, h) {
        if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
            return Err(format!(
                "Image dimensions ({width}x{height}) exceed maximum allowed side of {MAX_IMAGE_SIDE}"
            ));
        }
        if (width as u64 * height as u64) > MAX_IMAGE_PIXELS {
            return Err("Image pixel area exceeds 16M pixel limit".into());
        }
    }

    let thumb_path = crate::commands::cache::get_thumbnail_path(app, id)?;

    IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
        let bytes = match safe_decode_image(resolved) {
            Ok(decoded) => {
                let (src_w, src_h) = (decoded.width(), decoded.height());
                let (target_w, target_h) = calculate_fitted_dimensions(
                    src_w,
                    src_h,
                    THUMBNAIL_MAX_WIDTH,
                    THUMBNAIL_MAX_HEIGHT,
                );
                resize_image_fir(decoded, target_w, target_h)?
            }
            Err(_) => {
                create_placeholder_webp(THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT)?
            }
        };

        if let Some(parent) = thumb_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let _ = crate::commands::fs::write_atomic(&thumb_path, &bytes);

        Ok(())
    })?;

    Ok(thumb_path)
}

#[tauri::command]
pub async fn generate_image_variant(
    app: AppHandle,
    file_path: String,
    max_width: u32,
    max_height: u32,
) -> Result<CachedImageResult, String> {
    let trimmed = file_path.trim().to_string();
    if trimmed.is_empty() {
        return Err("File path cannot be empty".into());
    }

    let resolved = dunce::canonicalize(&trimmed)
        .map_err(|e| format!("Failed to resolve image path '{trimmed}': {e}"))?;

    let allowed = app.state::<crate::commands::fs::AllowedRoots>();
    if !allowed.is_allowed(&resolved) {
        return Err(format!(
            "Path '{}' is not under an allowed library root",
            resolved.display()
        ));
    }

    // Check header dimensions first
    let (w, h) = crate::commands::fs::parse_image_dimensions(&resolved);
    if let (Some(width), Some(height)) = (w, h) {
        if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
            return Err("Image side exceeds limit".into());
        }
        if (width as u64 * height as u64) > MAX_IMAGE_PIXELS {
            return Err("Image pixel area exceeds 16M pixel limit".into());
        }
    }

    let variant_cache_path = crate::commands::cache::get_variant_path(
        &app,
        &resolved.to_string_lossy(),
        max_width,
        max_height,
    )?;

    // Check if variant already cached on disk
    if variant_cache_path.exists() {
        return Ok(CachedImageResult {
            path: variant_cache_path.to_string_lossy().to_string(),
            url: crate::protocol::path_to_mangaimg_url(&variant_cache_path),
        });
    }

    let variant_cache_path_clone = variant_cache_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
            let bytes = match safe_decode_image(&resolved) {
                Ok(decoded) => {
                    let (src_w, src_h) = (decoded.width(), decoded.height());
                    let (target_w, target_h) = calculate_fitted_dimensions(
                        src_w,
                        src_h,
                        max_width,
                        max_height,
                    );
                    resize_image_fir(decoded, target_w, target_h)?
                }
                Err(_) => {
                    create_placeholder_webp(max_width, max_height)?
                }
            };

            let _ = crate::commands::fs::write_atomic(&variant_cache_path_clone, &bytes);

            Ok(())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(CachedImageResult {
        path: variant_cache_path.to_string_lossy().to_string(),
        url: crate::protocol::path_to_mangaimg_url(&variant_cache_path),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_calculate_fitted_dimensions() {
        // Image smaller than target bounds is NOT upscaled (min 1.0 scale)
        let (w, h) = calculate_fitted_dimensions(100, 150, 200, 300);
        assert_eq!((w, h), (100, 150));

        // Aspect ratio preserved when scaled down
        let (w, h) = calculate_fitted_dimensions(800, 1600, 160, 320);
        assert_eq!((w, h), (160, 320));

        // Wide image bounded by width
        let (w, h) = calculate_fitted_dimensions(1000, 500, 200, 200);
        assert_eq!((w, h), (200, 100));

        // Tall image bounded by height
        let (w, h) = calculate_fitted_dimensions(500, 1000, 200, 200);
        assert_eq!((w, h), (100, 200));

        // Extreme bounds or 0 input
        let (w, h) = calculate_fitted_dimensions(0, 0, 100, 100);
        assert_eq!((w, h), (1, 1));
    }

    #[test]
    fn test_resize_image_fir() {
        // Create an in-memory 200x200 red RGBA image
        let img = DynamicImage::ImageRgba8(RgbaImage::from_fn(200, 200, |_, _| {
            image::Rgba([255, 0, 0, 255])
        }));

        let resized_bytes = resize_image_fir(img, 100, 100).expect("Image resize must succeed");
        assert!(!resized_bytes.is_empty(), "Resized image bytes must not be empty");

        // Verify the decoded output has the target dimensions
        let decoded = image::load_from_memory(&resized_bytes).expect("Output bytes must be valid image format");
        assert_eq!(decoded.width(), 100);
        assert_eq!(decoded.height(), 100);
    }

    #[test]
    fn test_create_placeholder_webp() {
        let bytes = create_placeholder_webp(160, 320).expect("Placeholder WebP must encode cleanly");
        assert!(!bytes.is_empty());
        let decoded = image::load_from_memory(&bytes).expect("Placeholder must be decodable");
        assert_eq!(decoded.width(), 160);
        assert_eq!(decoded.height(), 320);
    }

    #[test]
    fn test_safe_decode_image_on_corrupt_or_missing() {
        let nonexistent = Path::new("nonexistent-image-path-12345.jpg");
        let result = safe_decode_image(nonexistent);
        assert!(result.is_err());
    }
}
