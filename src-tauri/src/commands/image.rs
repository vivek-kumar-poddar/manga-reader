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

#[tauri::command]
pub async fn generate_thumbnail(
    app: AppHandle,
    file_path: String,
    id: String,
) -> Result<tauri::ipc::Response, String> {
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

    // Run decode, resize, and atomic write in bounded rayon pool off main/async thread
    let encoded_bytes = tokio::task::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| -> Result<Vec<u8>, String> {
            let reader = image::ImageReader::open(&resolved)
                .map_err(|e| format!("Failed to open image file: {e}"))?
                .with_guessed_format()
                .map_err(|e| format!("Failed to determine image format: {e}"))?;

            let decoded = reader
                .decode()
                .map_err(|e| format!("Failed to decode image: {e}"))?;

            let (src_w, src_h) = (decoded.width(), decoded.height());
            if src_w > MAX_IMAGE_SIDE
                || src_h > MAX_IMAGE_SIDE
                || (src_w as u64 * src_h as u64) > MAX_IMAGE_PIXELS
            {
                return Err("Decoded image exceeds 16M pixel limit".into());
            }

            let (target_w, target_h) = calculate_fitted_dimensions(
                src_w,
                src_h,
                THUMBNAIL_MAX_WIDTH,
                THUMBNAIL_MAX_HEIGHT,
            );

            let bytes = resize_image_fir(decoded, target_w, target_h)?;

            if let Some(parent) = thumb_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            // Save to native thumbnail cache atomically
            let _ = crate::commands::fs::write_atomic(&thumb_path, &bytes);

            Ok(bytes)
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(tauri::ipc::Response::new(encoded_bytes))
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
        let reader = image::ImageReader::open(resolved)
            .map_err(|e| format!("Failed to open image file: {e}"))?
            .with_guessed_format()
            .map_err(|e| format!("Failed to determine image format: {e}"))?;

        let decoded = reader
            .decode()
            .map_err(|e| format!("Failed to decode image: {e}"))?;

        let (src_w, src_h) = (decoded.width(), decoded.height());
        if src_w > MAX_IMAGE_SIDE
            || src_h > MAX_IMAGE_SIDE
            || (src_w as u64 * src_h as u64) > MAX_IMAGE_PIXELS
        {
            return Err("Decoded image exceeds 16M pixel limit".into());
        }

        let (target_w, target_h) = calculate_fitted_dimensions(
            src_w,
            src_h,
            THUMBNAIL_MAX_WIDTH,
            THUMBNAIL_MAX_HEIGHT,
        );

        let bytes = resize_image_fir(decoded, target_w, target_h)?;

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
) -> Result<tauri::ipc::Response, String> {
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
        if let Ok(bytes) = tokio::fs::read(&variant_cache_path).await {
            if !bytes.is_empty() {
                return Ok(tauri::ipc::Response::new(bytes));
            }
        }
    }

    let encoded_bytes = tokio::task::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| -> Result<Vec<u8>, String> {
            let reader = image::ImageReader::open(&resolved)
                .map_err(|e| format!("Failed to open image file: {e}"))?
                .with_guessed_format()
                .map_err(|e| format!("Failed to determine image format: {e}"))?;

            let decoded = reader
                .decode()
                .map_err(|e| format!("Failed to decode image: {e}"))?;

            let (src_w, src_h) = (decoded.width(), decoded.height());
            if src_w > MAX_IMAGE_SIDE
                || src_h > MAX_IMAGE_SIDE
                || (src_w as u64 * src_h as u64) > MAX_IMAGE_PIXELS
            {
                return Err("Decoded image exceeds 16M pixel limit".into());
            }

            let (target_w, target_h) = calculate_fitted_dimensions(
                src_w,
                src_h,
                max_width,
                max_height,
            );

            let bytes = resize_image_fir(decoded, target_w, target_h)?;

            let _ = crate::commands::fs::write_atomic(&variant_cache_path, &bytes);

            Ok(bytes)
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(tauri::ipc::Response::new(encoded_bytes))
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
}
