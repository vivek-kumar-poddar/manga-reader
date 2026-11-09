use serde::{Deserialize, Serialize};
use std::time::UNIX_EPOCH;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

pub const MAX_DEPTH: usize = 64;
pub const MAX_SCAN_FILES: usize = 100_000;
pub const MAX_FILE_READ_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB safety cap

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
}

#[tauri::command]
pub async fn select_folder(app: AppHandle) -> Result<Option<String>, String> {
    let folder = app.dialog().file().blocking_pick_folder();
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub fn list_folder(folder_path: String) -> Result<Vec<FolderEntry>, String> {
    let raw_path = std::path::Path::new(folder_path.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Ok(Vec::new());
    }

    let root = dunce::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf());

    let mut results = Vec::new();
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
        if results.len() >= MAX_SCAN_FILES {
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

        results.push(FolderEntry {
            relative_path: rel_path,
            absolute_path: file_path.to_string_lossy().to_string(),
            size: metadata.len(),
            modified,
        });
    }

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
