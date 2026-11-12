use fast_image_resize as fr;
use fast_image_resize::PixelType;
use fast_image_resize::images::Image;
use image::{DynamicImage, ImageFormat, RgbaImage};
use std::io::Cursor;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;
use tauri::{AppHandle, Manager};

pub const MAX_IMAGE_PIXELS: u64 = 16_000_000; // 16M pixels
pub const MAX_IMAGE_SIDE: u32 = 32_768; // 32,768 per side
pub const MAX_IMAGE_JOB_MEMORY_BYTES: u64 = 64 * 1024 * 1024; // 64 MiB total job memory budget
pub const THUMBNAIL_MAX_WIDTH: u32 = 160;
pub const THUMBNAIL_MAX_HEIGHT: u32 = 320;
pub const IMAGE_ENCODER_VERSION: &str = "v1";

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageFormatCapabilities {
    pub extension: &'static str,
    pub recognized_extension: bool,
    pub header_readable: bool,
    pub webview_displayable: bool,
    pub rust_decodable: bool,
}

pub const FORMAT_MATRIX: &[ImageFormatCapabilities] = &[
    ImageFormatCapabilities {
        extension: "jpg",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "jpeg",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "png",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "webp",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "gif",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "bmp",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: true,
    },
    ImageFormatCapabilities {
        extension: "avif",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "svg",
        recognized_extension: true,
        header_readable: false,
        webview_displayable: true,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "ico",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: true,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "heic",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: false,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "heif",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: false,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "tif",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: false,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "tiff",
        recognized_extension: true,
        header_readable: true,
        webview_displayable: false,
        rust_decodable: false,
    },
    ImageFormatCapabilities {
        extension: "jxl",
        recognized_extension: true,
        header_readable: false,
        webview_displayable: false,
        rust_decodable: false,
    },
];

pub fn get_format_capabilities(ext: &str) -> ImageFormatCapabilities {
    let clean = ext.trim_start_matches('.').to_ascii_lowercase();
    FORMAT_MATRIX
        .iter()
        .find(|f| f.extension == clean)
        .copied()
        .unwrap_or(ImageFormatCapabilities {
            extension: "unknown",
            recognized_extension: false,
            header_readable: false,
            webview_displayable: false,
            rust_decodable: false,
        })
}

pub fn calculate_fitted_dimensions(src_w: u32, src_h: u32, max_w: u32, max_h: u32) -> (u32, u32) {
    if src_w == 0 || src_h == 0 || max_w == 0 || max_h == 0 {
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
    if target_width == 0 || target_height == 0 {
        return Err("Target dimensions must be greater than zero".into());
    }
    if target_width > MAX_IMAGE_SIDE || target_height > MAX_IMAGE_SIDE {
        return Err("Target dimensions exceed maximum allowed image side".into());
    }
    let target_area = (target_width as u64) * (target_height as u64);
    if target_area > MAX_IMAGE_PIXELS {
        return Err("Target pixel area exceeds limit".into());
    }
    if target_area * 4 > MAX_IMAGE_JOB_MEMORY_BYTES {
        return Err("Target buffer exceeds job memory budget".into());
    }

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

    // Fail WebP encoding explicitly rather than writing JPEG bytes into a .webp file
    dyn_dst
        .write_to(&mut cursor, ImageFormat::WebP)
        .map_err(|e| format!("Failed to encode resized image to WebP: {e}"))?;

    Ok(out)
}

/// Creates a neutral placeholder image in WebP format when requested.
/// Strictly validates width, height, pixel area, and memory budget before allocation.
pub fn create_placeholder_webp(width: u32, height: u32) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("Placeholder dimensions must be greater than zero".into());
    }
    if width > MAX_IMAGE_SIDE || height > MAX_IMAGE_SIDE {
        return Err(format!(
            "Placeholder dimensions ({width}x{height}) exceed maximum allowed side of {MAX_IMAGE_SIDE}"
        ));
    }
    let pixel_area = (width as u64) * (height as u64);
    if pixel_area > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Placeholder pixel area ({pixel_area}) exceeds limit of {MAX_IMAGE_PIXELS}"
        ));
    }
    let estimated_bytes = pixel_area
        .checked_mul(4)
        .ok_or_else(|| "Estimated bytes overflow".to_string())?;
    if estimated_bytes > MAX_IMAGE_JOB_MEMORY_BYTES {
        return Err(format!(
            "Placeholder estimated memory ({estimated_bytes} bytes) exceeds job budget of {MAX_IMAGE_JOB_MEMORY_BYTES} bytes"
        ));
    }

    let img = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
        width,
        height,
        image::Rgba([39, 39, 42, 255]), // #27272a neutral gray
    ));
    let mut out = Vec::new();
    let mut cursor = Cursor::new(&mut out);
    img.write_to(&mut cursor, ImageFormat::WebP)
        .map_err(|e| format!("Failed to encode placeholder to WebP: {e}"))?;
    Ok(out)
}

/// Safely decodes an image with total job memory budget enforcement and catch_unwind
/// protection against decoder panics.
pub fn safe_decode_image(path: &Path) -> Result<DynamicImage, String> {
    let ext = path.extension().and_then(|s| s.to_str()).unwrap_or("");
    let caps = get_format_capabilities(ext);
    if !caps.rust_decodable {
        return Err(format!(
            "Format '.{}' is recognized by library allowlist but not decodable in native Rust pipeline (WebView displayable: {}, header readable: {})",
            ext, caps.webview_displayable, caps.header_readable
        ));
    }

    // Check header dimensions before reading file body to enforce job budget
    if let (Some(w), Some(h)) = crate::commands::fs::parse_image_dimensions(path) {
        if w == 0 || h == 0 || w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE {
            return Err(format!("Image dimensions ({w}x{h}) exceed limits"));
        }
        let pixel_area = (w as u64) * (h as u64);
        if pixel_area > MAX_IMAGE_PIXELS {
            return Err(format!(
                "Image pixel area ({pixel_area}) exceeds limit of {MAX_IMAGE_PIXELS}"
            ));
        }
        let raw_bytes = pixel_area * 4;
        if raw_bytes > MAX_IMAGE_JOB_MEMORY_BYTES {
            return Err(format!(
                "Estimated uncompressed RGBA image memory ({raw_bytes} bytes) exceeds total job budget of {MAX_IMAGE_JOB_MEMORY_BYTES} bytes"
            ));
        }
    }

    let mut limits = image::Limits::default();
    limits.max_alloc = Some(MAX_IMAGE_JOB_MEMORY_BYTES);
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
            let pixel_area = (w as u64) * (h as u64);
            if w > MAX_IMAGE_SIDE || h > MAX_IMAGE_SIDE || pixel_area > MAX_IMAGE_PIXELS {
                return Err("Decoded image exceeds size or pixel limits".into());
            }
            if pixel_area * 4 > MAX_IMAGE_JOB_MEMORY_BYTES {
                return Err("Decoded image RGBA size exceeds job memory budget".into());
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
    #[serde(default)]
    pub is_placeholder: bool,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
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

    let thumb_path = crate::commands::cache::get_thumbnail_path(&app, &id)?;

    // Check if cached thumbnail exists and is still fresh compared to source file
    let should_regenerate = if thumb_path.exists() {
        match (std::fs::metadata(&resolved), std::fs::metadata(&thumb_path)) {
            (Ok(src_meta), Ok(thumb_meta)) => match (src_meta.modified(), thumb_meta.modified()) {
                (Ok(src_mtime), Ok(thumb_mtime)) => src_mtime > thumb_mtime,
                _ => false,
            },
            _ => true,
        }
    } else {
        true
    };

    if !should_regenerate {
        return Ok(CachedImageResult {
            path: thumb_path.to_string_lossy().to_string(),
            url: crate::protocol::path_to_mangaimg_url(&thumb_path),
            is_placeholder: false,
            status: "cached".into(),
            error: None,
        });
    }

    let thumb_path_clone = thumb_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
            let decoded = safe_decode_image(&resolved)?;
            let (src_w, src_h) = (decoded.width(), decoded.height());
            let (target_w, target_h) = calculate_fitted_dimensions(
                src_w,
                src_h,
                THUMBNAIL_MAX_WIDTH,
                THUMBNAIL_MAX_HEIGHT,
            );
            let bytes = resize_image_fir(decoded, target_w, target_h)?;

            if let Some(parent) = thumb_path_clone.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            crate::commands::fs::write_atomic(&thumb_path_clone, &bytes)
                .map_err(|e| format!("Failed to write thumbnail: {e}"))?;

            if !thumb_path_clone.exists() {
                return Err("Failed to verify thumbnail file on disk".into());
            }

            Ok(())
        })
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(CachedImageResult {
        path: thumb_path.to_string_lossy().to_string(),
        url: crate::protocol::path_to_mangaimg_url(&thumb_path),
        is_placeholder: false,
        status: "generated".into(),
        error: None,
    })
}

pub fn generate_thumbnail_direct(
    app: &AppHandle,
    resolved: &Path,
    id: &str,
) -> Result<PathBuf, String> {
    let thumb_path = crate::commands::cache::get_thumbnail_path(app, id)?;

    let should_regenerate = if thumb_path.exists() {
        match (std::fs::metadata(resolved), std::fs::metadata(&thumb_path)) {
            (Ok(src_meta), Ok(thumb_meta)) => match (src_meta.modified(), thumb_meta.modified()) {
                (Ok(src_mtime), Ok(thumb_mtime)) => src_mtime > thumb_mtime,
                _ => false,
            },
            _ => true,
        }
    } else {
        true
    };

    if !should_regenerate {
        return Ok(thumb_path);
    }

    IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
        let decoded = safe_decode_image(resolved)?;
        let (src_w, src_h) = (decoded.width(), decoded.height());
        let (target_w, target_h) =
            calculate_fitted_dimensions(src_w, src_h, THUMBNAIL_MAX_WIDTH, THUMBNAIL_MAX_HEIGHT);
        let bytes = resize_image_fir(decoded, target_w, target_h)?;

        if let Some(parent) = thumb_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        crate::commands::fs::write_atomic(&thumb_path, &bytes)
            .map_err(|e| format!("Failed to write direct thumbnail: {e}"))?;

        if !thumb_path.exists() {
            return Err("Failed to verify direct thumbnail on disk".into());
        }

        Ok(())
    })?;

    Ok(thumb_path)
}

pub fn generate_image_variant_direct(
    app: &AppHandle,
    resolved: &Path,
    max_width: u32,
    max_height: u32,
) -> Result<PathBuf, String> {
    // 1. Validate output bounds upfront before cache lookup or decode
    if max_width == 0 || max_height == 0 {
        return Err("Target dimensions must be greater than zero".into());
    }
    if max_width > MAX_IMAGE_SIDE || max_height > MAX_IMAGE_SIDE {
        return Err(format!(
            "Target dimensions ({max_width}x{max_height}) exceed maximum allowed side of {MAX_IMAGE_SIDE}"
        ));
    }
    let target_area = (max_width as u64) * (max_height as u64);
    if target_area > MAX_IMAGE_PIXELS {
        return Err(format!(
            "Target pixel area ({target_area}) exceeds limit of {MAX_IMAGE_PIXELS}"
        ));
    }
    if target_area * 4 > MAX_IMAGE_JOB_MEMORY_BYTES {
        return Err("Target dimensions exceed job memory budget".into());
    }

    // 2. Include source identity, size, modification timestamp, transform parameters, and encoder version in cache key
    let metadata = std::fs::metadata(resolved)
        .map_err(|e| format!("Failed to read metadata for '{}': {e}", resolved.display()))?;
    let file_size = metadata.len();
    let mtime_millis = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let variant_cache_key = format!(
        "{}:{}:{}:fit_{}x{}:{}",
        resolved.to_string_lossy(),
        file_size,
        mtime_millis,
        max_width,
        max_height,
        IMAGE_ENCODER_VERSION
    );

    let variant_cache_path =
        crate::commands::cache::get_variant_path(app, &variant_cache_key, max_width, max_height)?;

    if variant_cache_path.exists() {
        return Ok(variant_cache_path);
    }

    let variant_cache_path_clone = variant_cache_path.clone();
    let resolved_clone = resolved.to_path_buf();
    IMAGE_RESIZE_POOL.install(|| -> Result<(), String> {
        let decoded = safe_decode_image(&resolved_clone)?;
        let (src_w, src_h) = (decoded.width(), decoded.height());
        let (target_w, target_h) = calculate_fitted_dimensions(src_w, src_h, max_width, max_height);
        let bytes = resize_image_fir(decoded, target_w, target_h)?;

        if let Some(parent) = variant_cache_path_clone.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        crate::commands::fs::write_atomic(&variant_cache_path_clone, &bytes)
            .map_err(|e| format!("Failed to write image variant: {e}"))?;

        if !variant_cache_path_clone.exists() {
            return Err("Failed to verify image variant file on disk".into());
        }

        Ok(())
    })?;

    Ok(variant_cache_path)
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

    let app_clone = app.clone();
    let resolved_clone = resolved.clone();
    let variant_cache_path = tauri::async_runtime::spawn_blocking(move || {
        generate_image_variant_direct(&app_clone, &resolved_clone, max_width, max_height)
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    Ok(CachedImageResult {
        path: variant_cache_path.to_string_lossy().to_string(),
        url: crate::protocol::path_to_mangaimg_url(&variant_cache_path),
        is_placeholder: false,
        status: "generated".into(),
        error: None,
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
        let img = DynamicImage::ImageRgba8(RgbaImage::from_fn(200, 200, |_, _| {
            image::Rgba([255, 0, 0, 255])
        }));

        let resized_bytes = resize_image_fir(img, 100, 100).expect("Image resize must succeed");
        assert!(
            !resized_bytes.is_empty(),
            "Resized image bytes must not be empty"
        );

        // Verify the decoded output has the target dimensions
        let decoded = image::load_from_memory(&resized_bytes)
            .expect("Output bytes must be valid image format");
        assert_eq!(decoded.width(), 100);
        assert_eq!(decoded.height(), 100);
    }

    #[test]
    fn test_create_placeholder_webp_limits() {
        // Valid placeholder within limits succeeds
        let bytes =
            create_placeholder_webp(160, 320).expect("Placeholder WebP must encode cleanly");
        assert!(!bytes.is_empty());
        let decoded = image::load_from_memory(&bytes).expect("Placeholder must be decodable");
        assert_eq!(decoded.width(), 160);
        assert_eq!(decoded.height(), 320);

        // Zero dimensions rejected
        assert!(create_placeholder_webp(0, 100).is_err());
        assert!(create_placeholder_webp(100, 0).is_err());

        // Extreme dimensions exceeding MAX_IMAGE_SIDE rejected
        assert!(create_placeholder_webp(32_769, 100).is_err());

        // Excessive pixel area exceeding memory budget rejected
        assert!(create_placeholder_webp(10_000, 10_000).is_err());
    }

    #[test]
    fn test_safe_decode_image_on_corrupt_or_missing() {
        let nonexistent = Path::new("nonexistent-image-path-12345.jpg");
        let result = safe_decode_image(nonexistent);
        assert!(result.is_err());
    }

    #[test]
    fn test_format_matrix_capabilities() {
        // Rust decodable raster formats
        for ext in &["jpg", "jpeg", "png", "webp", "gif", "bmp"] {
            let caps = get_format_capabilities(ext);
            assert!(caps.recognized_extension);
            assert!(caps.header_readable);
            assert!(caps.webview_displayable);
            assert!(
                caps.rust_decodable,
                "Format {} should be rust decodable",
                ext
            );
        }

        // AVIF: recognized, header readable, webview displayable, but NOT rust decodable
        let avif = get_format_capabilities("avif");
        assert!(avif.recognized_extension);
        assert!(avif.header_readable);
        assert!(avif.webview_displayable);
        assert!(!avif.rust_decodable);

        // SVG: recognized, vector (no fixed raster header), webview displayable, not rust decodable
        let svg = get_format_capabilities("svg");
        assert!(svg.recognized_extension);
        assert!(!svg.header_readable);
        assert!(svg.webview_displayable);
        assert!(!svg.rust_decodable);

        // HEIC / TIFF: recognized, header readable, but NOT natively webview displayable and NOT rust decodable
        let heic = get_format_capabilities("heic");
        assert!(heic.recognized_extension);
        assert!(heic.header_readable);
        assert!(!heic.webview_displayable);
        assert!(!heic.rust_decodable);

        let tiff = get_format_capabilities("tiff");
        assert!(tiff.recognized_extension);
        assert!(tiff.header_readable);
        assert!(!tiff.webview_displayable);
        assert!(!tiff.rust_decodable);

        // Unrecognized format
        let unknown = get_format_capabilities("xyz");
        assert!(!unknown.recognized_extension);
        assert!(!unknown.rust_decodable);
    }
}
