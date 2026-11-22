use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::commands::fs::ALLOWED_IMAGE_EXTENSIONS;

/// Verifies whether a path is an explicitly managed image artifact in the thumbnail or variant cache.
/// Prevents broad authorization of arbitrary files in the cache or data directory.
pub fn is_explicit_cache_artifact(app: &AppHandle, path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|f| f.to_str()) {
        Some(f) => f,
        None => return false,
    };

    if !file_name.ends_with(".webp") {
        return false;
    }
    let is_thumb_or_variant = file_name.starts_with("t_") || file_name.starts_with("v_");
    if !is_thumb_or_variant {
        return false;
    }

    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };
    let parent_name = match parent.file_name().and_then(|f| f.to_str()) {
        Some(p) => p,
        None => return false,
    };
    if parent_name != "thumbnails" && parent_name != "variants" {
        return false;
    }

    if let Ok(cache_dir) = app.path().app_cache_dir() {
        if let Ok(canonical_cache) = dunce::canonicalize(&cache_dir) {
            if parent.starts_with(&canonical_cache) || parent.starts_with(&cache_dir) {
                return true;
            }
        } else if parent.starts_with(&cache_dir) {
            return true;
        }
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let cache_dir = app_dir.join("cache");
        if let Ok(canonical_cache) = dunce::canonicalize(&cache_dir) {
            if parent.starts_with(&canonical_cache) || parent.starts_with(&cache_dir) {
                return true;
            }
        } else if parent.starts_with(&cache_dir) {
            return true;
        }
    }
    false
}

pub fn is_in_thumbnail_cache(app: &AppHandle, path: &Path) -> bool {
    is_explicit_cache_artifact(app, path)
}

pub fn try_find_and_generate_cover(
    app: &AppHandle,
    base_dir: &Path,
    manga_id: &str,
    size: u32,
) -> Result<PathBuf, String> {
    if !base_dir.is_dir() {
        return Err("Base directory does not exist".into());
    }

    // Common cover filenames
    for name in &[
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "thumbnail.jpg",
        "thumbnail.jpeg",
        "thumbnail.png",
        "thumbnail.webp",
        "folder.jpg",
    ] {
        let candidate = base_dir.join(name);
        if candidate.is_file() {
            return crate::commands::image::generate_sized_thumbnail_direct(app, &candidate, manga_id, size);
        }
    }

    if let Ok(entries) = std::fs::read_dir(base_dir) {
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        files.sort_by(|a, b| {
            crate::commands::fs::natural_order(&a.to_string_lossy(), &b.to_string_lossy())
        });
        for path in files {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ALLOWED_IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                    return crate::commands::image::generate_sized_thumbnail_direct(app, &path, manga_id, size);
                }
            }
        }
    }

    if let Ok(entries) = std::fs::read_dir(base_dir) {
        let mut subdirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir() && !crate::commands::fs::is_ignored_directory(p))
            .collect();
        subdirs.sort_by(|a, b| {
            crate::commands::fs::natural_order(&a.to_string_lossy(), &b.to_string_lossy())
        });
        for subdir in subdirs {
            if let Ok(sub_entries) = std::fs::read_dir(&subdir) {
                let mut files: Vec<PathBuf> = sub_entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file())
                    .collect();
                files.sort_by(|a, b| {
                    crate::commands::fs::natural_order(&a.to_string_lossy(), &b.to_string_lossy())
                });
                for f in files {
                    if let Some(ext) = f.extension().and_then(|e| e.to_str()) {
                        if ALLOWED_IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            return crate::commands::image::generate_sized_thumbnail_direct(
                                app, &f, manga_id, size,
                            );
                        }
                    }
                }
            }
        }
    }

    Err("No image found to generate cover".into())
}

pub fn safe_name(s: &str) -> bool {
    !s.is_empty() && !s.contains(['/', '\\', ':']) && !s.contains("..")
}
