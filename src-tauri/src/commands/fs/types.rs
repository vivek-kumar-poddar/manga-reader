use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

pub const MAX_DEPTH: usize = 64;
pub const MAX_SCAN_FILES: usize = 100_000;
pub const MAX_FILE_READ_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB safety cap
pub const HEADER_READ_LIMIT: usize = 32 * 1024; // 32 KB header buffer
pub const SCAN_BATCH_SIZE: usize = 128; // Batched Rayon dimension processing

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

#[derive(Debug, thiserror::Error, Serialize, Deserialize)]
#[serde(tag = "code", content = "message")]
pub enum FsError {
    #[error("Target path not found: {0}")]
    NotFound(String),

    #[error("File exceeds maximum allowed size: {0}")]
    TooLarge(String),

    #[error("Forbidden file extension: {0}")]
    ForbiddenExt(String),

    #[error("Path is not under an allowed root: {0}")]
    PathNotAllowed(String),

    #[error("Operation was cancelled")]
    Cancelled,

    #[error("IO error: {0}")]
    Io(String),
}

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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPage {
    pub name: String,
    pub relative_path: String,
    pub absolute_path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: u64,
    pub modified: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredChapter {
    pub name: String,
    pub pages: Vec<DiscoveredPage>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredTitle {
    pub title: String,
    pub root_path: String,
    pub chapters: Vec<DiscoveredChapter>,
    pub total_images: usize,
    pub cover_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDiscovery {
    pub root_path: String,
    pub titles: Vec<DiscoveredTitle>,
    pub total_files: usize,
}

#[derive(Debug, Clone)]
pub struct DiscoverySnapshot {
    pub root_path: PathBuf,
    pub created_at: std::time::Instant,
    pub candidates: Vec<DiscoveredPage>,
}

#[derive(Default)]
pub struct DiscoveryState {
    snapshots: Mutex<HashMap<PathBuf, DiscoverySnapshot>>,
}

impl DiscoveryState {
    pub fn store(&self, root_path: PathBuf, candidates: Vec<DiscoveredPage>) {
        if let Ok(mut map) = self.snapshots.lock() {
            let now = std::time::Instant::now();
            map.retain(|_, v| now.duration_since(v.created_at).as_secs() < 900);
            if map.len() >= 8 {
                if let Some(oldest) = map
                    .iter()
                    .min_by_key(|(_, v)| v.created_at)
                    .map(|(k, _)| k.clone())
                {
                    map.remove(&oldest);
                }
            }
            map.insert(
                root_path.clone(),
                DiscoverySnapshot {
                    root_path,
                    created_at: now,
                    candidates,
                },
            );
        }
    }

    pub fn get_for_path(&self, path: &Path) -> Option<DiscoverySnapshot> {
        if let Ok(map) = self.snapshots.lock() {
            if let Some(snap) = map.get(path) {
                return Some(snap.clone());
            }
            for (root, snap) in map.iter() {
                if path.starts_with(root) {
                    return Some(snap.clone());
                }
            }
        }
        None
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub scan_id: Option<String>,
    pub done: usize,
    pub total: usize,
}

#[derive(Clone)]
pub struct CandidateEntry {
    pub rel_path: String,
    pub abs_path: PathBuf,
    pub size: u64,
    pub modified: f64,
}

pub fn is_image_file(path: &Path) -> bool {
    path.extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .map(|ext| ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()))
        .unwrap_or(false)
}

pub fn is_ignored_directory(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("")
        .to_lowercase();
    name.starts_with('.') || IGNORED_FOLDER_NAMES.contains(&name.as_str())
}
