use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub const MAX_DEPTH: usize = 64;
pub const MAX_SCAN_FILES: usize = 100_000;
pub const MAX_FILE_READ_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB safety cap
pub const HEADER_READ_LIMIT: usize = 32 * 1024; // 32 KB header buffer

pub const ALLOWED_IMAGE_EXTENSIONS: &[&str] = &[
    "jpg", "jpeg", "png", "webp", "avif", "gif", "bmp", "svg", "ico", "heic", "heif", "tif",
    "tiff", "jxl",
];

pub const IGNORED_FOLDER_NAMES: &[&str] = &[
    ".git",
    ".svn",
    ".hg",
    "node_modules",
    "$recycle.bin",
    "system volume information",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderEntry {
    pub relative_path: String,
    pub absolute_path: String,
    pub size: u64,
    pub modified: f64,
    pub width: Option<u32>,
    pub height: Option<u32>,
}

struct CandidateEntry {
    rel_path: String,
    abs_path: std::path::PathBuf,
    size: u64,
    modified: f64,
}

/// Parses image dimensions (width, height) without decoding pixel buffers.
/// First reads up to 32 KB to parse headers via blob_size; falls back to size(path)
/// for large EXIF/TIFF headers.
pub fn parse_image_dimensions(path: &Path) -> (Option<u32>, Option<u32>) {
    // 1. Fast header parse: read first 32 KB
    if let Ok(mut file) = File::open(path) {
        let mut buf = vec![0u8; HEADER_READ_LIMIT];
        let mut total = 0;
        while total < HEADER_READ_LIMIT {
            match file.read(&mut buf[total..]) {
                Ok(0) => break,
                Ok(n) => total += n,
                Err(_) => break,
            }
        }
        buf.truncate(total);

        if !buf.is_empty() {
            if let Ok(dim) = imagesize::blob_size(&buf) {
                if dim.width > 0 && dim.height > 0 {
                    let w = dim.width as u64;
                    let h = dim.height as u64;
                    if w <= u32::MAX as u64 && h <= u32::MAX as u64 && w.saturating_mul(h) < (1u64 << 40) {
                        return (Some(dim.width as u32), Some(dim.height as u32));
                    }
                }
            }
        }
    }

    // 2. Fallback: stream through reader if metadata chunk is located past 32 KB
    if let Ok(dim) = imagesize::size(path) {
        if dim.width > 0 && dim.height > 0 {
            let w = dim.width as u64;
            let h = dim.height as u64;
            if w <= u32::MAX as u64 && h <= u32::MAX as u64 && w.saturating_mul(h) < (1u64 << 40) {
                return (Some(dim.width as u32), Some(dim.height as u32));
            }
        }
    }

    (None, None)
}

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub fn get_image_dimensions(absolute_path: String) -> Result<Option<(u32, u32)>, String> {
    let path = Path::new(&absolute_path);
    let (w, h) = parse_image_dimensions(path);
    match (w, h) {
        (Some(width), Some(height)) => Ok(Some((width, height))),
        _ => Ok(None),
    }
}

#[tauri::command]
pub fn list_folder(folder_path: String) -> Result<Vec<FolderEntry>, String> {
    let raw_path = std::path::Path::new(folder_path.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Ok(Vec::new());
    }

    let root = dunce::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf());

    let mut candidates = Vec::new();
    let walker = walkdir::WalkDir::new(&root)
        .max_depth(MAX_DEPTH)
        .follow_links(false)
        .into_iter()
        .filter_entry(|entry| {
            if entry.depth() == 0 {
                return true;
            }
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if entry.file_type().is_dir() {
                if name.starts_with('.') || IGNORED_FOLDER_NAMES.contains(&name.as_str()) {
                    return false;
                }
            }
            true
        });

    for entry_res in walker {
        if candidates.len() >= MAX_SCAN_FILES {
            break;
        }
        let entry = match entry_res {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_file() {
            continue;
        }

        let file_path = entry.path();
        let ext = match file_path.extension() {
            Some(e) => e.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(m) => m,
            Err(_) => continue,
        };

        let rel_path = match file_path.strip_prefix(&root) {
            Ok(p) => p.to_string_lossy().replace('\\', "/"),
            Err(_) => continue,
        };

        let modified = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as f64)
            .unwrap_or(0.0);

        candidates.push(CandidateEntry {
            rel_path,
            abs_path: file_path.to_path_buf(),
            size: metadata.len(),
            modified,
        });
    }

    // Parallel dimension extraction across Rayon worker threads
    let results: Vec<FolderEntry> = candidates
        .into_par_iter()
        .map(|entry| {
            let (width, height) = parse_image_dimensions(&entry.abs_path);
            FolderEntry {
                relative_path: entry.rel_path,
                absolute_path: entry.abs_path.to_string_lossy().to_string(),
                size: entry.size,
                modified: entry.modified,
                width,
                height,
            }
        })
        .collect();

    Ok(results)
}

#[tauri::command]
pub async fn read_file(absolute_path: String) -> Result<tauri::ipc::Response, String> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err("Path cannot be empty".into());
    }

    let path = std::path::Path::new(trimmed);
    let resolved = dunce::canonicalize(path).map_err(|e| format!("Failed to resolve path: {e}"))?;

    let ext = resolved
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or_else(|| "Missing file extension".to_string())?;

    if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(format!("File extension '.{ext}' is not an allowed image format"));
    }

    let metadata = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| format!("Failed to read metadata: {e}"))?;

    if !metadata.is_file() {
        return Err("Target path is not a regular file".into());
    }

    if metadata.len() > MAX_FILE_READ_BYTES {
        return Err(format!(
            "File size ({} bytes) exceeds safety cap of {} bytes",
            metadata.len(),
            MAX_FILE_READ_BYTES
        ));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| format!("Failed to read file bytes: {e}"))?;

    Ok(tauri::ipc::Response::new(bytes))
}
