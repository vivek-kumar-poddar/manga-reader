use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

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
pub struct PageHeader {
    pub path: String,
    pub width: u32,
    pub height: u32,
    pub size: u64,
    pub modified: f64,
    pub checksum: Option<String>,
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

pub fn natural_order(a: &str, b: &str) -> std::cmp::Ordering {
    fn category(s: &str) -> i32 {
        let trimmed = s.trim_start();
        let lower = trimmed.to_lowercase();
        if lower.starts_with("prologue") || lower.starts_with("opening") {
            -1
        } else if lower.starts_with("extra")
            || lower.starts_with("bonus")
            || lower.starts_with("special")
            || lower.starts_with("epilogue")
        {
            1
        } else {
            0
        }
    }

    let cat_a = category(a);
    let cat_b = category(b);
    if cat_a != cat_b {
        return cat_a.cmp(&cat_b);
    }

    #[derive(Debug, PartialEq)]
    enum Token<'a> {
        Num(f64),
        Str(&'a str),
    }

    fn extract_tokens(s: &str) -> Vec<Token<'_>> {
        let mut tokens = Vec::new();
        let mut start = 0;
        let mut in_num = false;
        let bytes = s.as_bytes();
        let len = bytes.len();

        let mut i = 0;
        while i < len {
            let c = bytes[i];
            let is_digit = c.is_ascii_digit();
            if is_digit != in_num {
                if i > start {
                    let slice = &s[start..i];
                    if in_num {
                        if let Ok(n) = slice.parse::<f64>() {
                            tokens.push(Token::Num(n));
                        } else {
                            tokens.push(Token::Str(slice));
                        }
                    } else {
                        tokens.push(Token::Str(slice));
                    }
                }
                start = i;
                in_num = is_digit;
            }
            i += 1;
        }

        if start < len {
            let slice = &s[start..len];
            if in_num {
                if let Ok(n) = slice.parse::<f64>() {
                    tokens.push(Token::Num(n));
                } else {
                    tokens.push(Token::Str(slice));
                }
            } else {
                tokens.push(Token::Str(slice));
            }
        }

        tokens
    }

    let lower_a = a.to_lowercase();
    let lower_b = b.to_lowercase();

    let tokens_a = extract_tokens(&lower_a);
    let tokens_b = extract_tokens(&lower_b);

    for (x, y) in tokens_a.iter().zip(tokens_b.iter()) {
        match (x, y) {
            (Token::Num(nx), Token::Num(ny)) => {
                if let Some(ord) = nx.partial_cmp(ny) {
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
            }
            (Token::Str(sx), Token::Str(sy)) => {
                let ord = sx.cmp(sy);
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Token::Num(_), Token::Str(_)) => return std::cmp::Ordering::Less,
            (Token::Str(_), Token::Num(_)) => return std::cmp::Ordering::Greater,
        }
    }

    tokens_a.len().cmp(&tokens_b.len()).then_with(|| a.cmp(b))
}

#[tauri::command]
pub fn natural_sort_paths(mut paths: Vec<String>) -> Vec<String> {
    paths.sort_by(|a, b| natural_order(a, b));
    paths
}

#[tauri::command]
pub async fn prepare_chapter_headers(
    app: AppHandle,
    paths: Vec<String>,
) -> Result<Vec<PageHeader>, FsError> {
    let allowed_set = {
        let allowed = app.state::<AllowedRoots>();
        allowed.0.read().unwrap().clone()
    };

    // Parallel extraction with Rayon off main thread
    let results: Vec<PageHeader> = tokio::task::spawn_blocking(move || {
        paths
            .into_par_iter()
            .filter_map(|p_str| {
                let trimmed = p_str.trim();
                let path = Path::new(trimmed);
                let resolved = dunce::canonicalize(path).ok()?;
                if !allowed_set.is_empty() && !allowed_set.iter().any(|r| resolved.starts_with(r)) {
                    return None;
                }
                let ext = resolved.extension()?.to_str()?.to_lowercase();
                if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                    return None;
                }
                let metadata = std::fs::metadata(&resolved).ok()?;
                if !metadata.is_file() || metadata.len() > MAX_FILE_READ_BYTES {
                    return None;
                }
                let (w, h) = parse_image_dimensions(&resolved);
                let width = w.unwrap_or(800);
                let height = h.unwrap_or(1200);

                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as f64)
                    .unwrap_or(0.0);

                // Lightweight checksum: FNV-1a of size + modified + first 512 bytes
                let mut hash: u64 = 0xcbf29ce484222325;
                let size = metadata.len();
                for b in size.to_le_bytes() {
                    hash = (hash ^ (b as u64)).wrapping_mul(0x100000001b3);
                }
                for b in (modified as u64).to_le_bytes() {
                    hash = (hash ^ (b as u64)).wrapping_mul(0x100000001b3);
                }
                if let Ok(mut f) = File::open(&resolved) {
                    let mut sample = [0u8; 512];
                    if let Ok(n) = f.read(&mut sample) {
                        for &b in &sample[..n] {
                            hash = (hash ^ (b as u64)).wrapping_mul(0x100000001b3);
                        }
                    }
                }
                let checksum = Some(format!("{:016x}", hash));

                Some(PageHeader {
                    path: p_str,
                    width,
                    height,
                    size,
                    modified,
                    checksum,
                })
            })
            .collect()
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))?;

    Ok(results)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressPayload {
    pub scan_id: Option<String>,
    pub done: usize,
    pub total: usize,
}

#[derive(Clone)]
struct CandidateEntry {
    rel_path: String,
    abs_path: PathBuf,
    size: u64,
    modified: f64,
}

#[derive(Default)]
pub struct AllowedRoots(pub RwLock<HashSet<PathBuf>>);

impl AllowedRoots {
    pub fn is_allowed(&self, path: &Path) -> bool {
        let roots = self.0.read().unwrap();
        if roots.is_empty() {
            return true;
        }
        let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        if canonical.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
            return false;
        }
        roots.iter().any(|root| canonical.starts_with(root))
    }

    pub fn add_root(&self, path: PathBuf) {
        let canonical = dunce::canonicalize(&path).unwrap_or(path);
        self.0.write().unwrap().insert(canonical);
    }
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

/// Atomically writes data to path by writing to a temporary file (*.tmp) first
/// and then renaming it over the destination path.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, data)?;
    if let Err(e) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(e);
    }
    Ok(())
}

pub fn load_persisted_roots(app: &AppHandle) -> HashSet<PathBuf> {
    let mut set = HashSet::new();
    if let Ok(app_dir) = app.path().app_data_dir() {
        let file_path = app_dir.join("allowed_roots.json");
        let candidates = [file_path.clone(), file_path.with_extension("tmp")];
        for candidate in &candidates {
            if candidate.exists() {
                if let Ok(data) = std::fs::read_to_string(candidate) {
                    if let Ok(paths) = serde_json::from_str::<Vec<String>>(&data) {
                        for p in paths {
                            let pb = PathBuf::from(p);
                            if let Ok(canonical) = dunce::canonicalize(&pb) {
                                set.insert(canonical);
                            } else {
                                set.insert(pb);
                            }
                        }
                        if !set.is_empty() {
                            if candidate != &file_path {
                                let _ = std::fs::rename(candidate, &file_path);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
    set
}

pub fn save_persisted_roots(app: &AppHandle, roots: &HashSet<PathBuf>) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_dir);
        let file_path = app_dir.join("allowed_roots.json");
        let list: Vec<String> = roots.iter().map(|p| p.to_string_lossy().to_string()).collect();
        if let Ok(data) = serde_json::to_string(&list) {
            let _ = write_atomic(&file_path, data.as_bytes());
        }
    }
}

pub fn init_allowed_roots(app: &AppHandle) -> AllowedRoots {
    let loaded = load_persisted_roots(app);
    AllowedRoots(RwLock::new(loaded))
}

#[derive(Default)]
pub struct ScanManager {
    active_scans:
        std::sync::Mutex<std::collections::HashMap<String, tokio::sync::watch::Sender<bool>>>,
}

impl ScanManager {
    pub fn register(&self, id: &str) -> tokio::sync::watch::Receiver<bool> {
        let (tx, rx) = tokio::sync::watch::channel(false);
        self.active_scans.lock().unwrap().insert(id.to_string(), tx);
        rx
    }

    pub fn unregister(&self, id: &str) {
        self.active_scans.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some(tx) = self.active_scans.lock().unwrap().get(id) {
            let _ = tx.send(true);
            true
        } else {
            false
        }
    }
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
                    if w <= u32::MAX as u64
                        && h <= u32::MAX as u64
                        && w.saturating_mul(h) < (1u64 << 40)
                    {
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
pub async fn select_folder(app: AppHandle) -> Result<Option<String>, FsError> {
    let folder = app.dialog().file().blocking_pick_folder();
    if let Some(ref path) = folder {
        let pb = PathBuf::from(path.to_string());
        let allowed = app.state::<AllowedRoots>();
        allowed.add_root(pb);
        save_persisted_roots(&app, &allowed.0.read().unwrap());
    }
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command]
pub fn cancel_scan(app: AppHandle, scan_id: String) -> Result<bool, FsError> {
    let scan_mgr = app.state::<ScanManager>();
    Ok(scan_mgr.cancel(&scan_id))
}

#[tauri::command]
pub fn get_image_dimensions(
    app: AppHandle,
    absolute_path: String,
) -> Result<Option<(u32, u32)>, FsError> {
    let path = Path::new(&absolute_path);
    if let Ok(resolved) = dunce::canonicalize(path) {
        let allowed = app.state::<AllowedRoots>();
        if !allowed.is_allowed(&resolved) {
            return Err(FsError::PathNotAllowed(format!(
                "Path '{}' is not under an allowed library root",
                resolved.display()
            )));
        }
        let (w, h) = parse_image_dimensions(&resolved);
        match (w, h) {
            (Some(width), Some(height)) => Ok(Some((width, height))),
            _ => Ok(None),
        }
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn list_folder(
    app: AppHandle,
    folder_path: String,
    scan_id: Option<String>,
) -> Result<Vec<FolderEntry>, FsError> {
    let raw_path = std::path::Path::new(folder_path.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Ok(Vec::new());
    }

    let root = dunce::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf());

    // Verify root is under an allowed library root (added via select_folder or drag-and-drop)
    let allowed = app.state::<AllowedRoots>();
    if !allowed.is_allowed(&root) {
        return Err(FsError::PathNotAllowed(format!(
            "Path '{}' is not under an allowed library root",
            root.display()
        )));
    }

    // Setup cancellation receiver if scan_id provided
    let scan_mgr = app.state::<ScanManager>();
    let rx = scan_id.as_deref().map(|id| scan_mgr.register(id));

    struct ScanGuard<'a> {
        mgr: &'a ScanManager,
        id: Option<&'a str>,
    }
    impl<'a> Drop for ScanGuard<'a> {
        fn drop(&mut self) {
            if let Some(id) = self.id {
                self.mgr.unregister(id);
            }
        }
    }
    let _guard = ScanGuard {
        mgr: &scan_mgr,
        id: scan_id.as_deref(),
    };

    let check_cancelled = |rx: Option<&tokio::sync::watch::Receiver<bool>>| -> Result<(), FsError> {
        if let Some(receiver) = rx {
            if *receiver.borrow() {
                return Err(FsError::Cancelled);
            }
        }
        Ok(())
    };

    check_cancelled(rx.as_ref())?;

    // Collect candidates off the main thread
    let root_clone = root.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        let mut list = Vec::new();
        let walker = walkdir::WalkDir::new(&root_clone)
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
            if list.len() >= MAX_SCAN_FILES {
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

            let rel_path = match file_path.strip_prefix(&root_clone) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);

            list.push(CandidateEntry {
                rel_path,
                abs_path: file_path.to_path_buf(),
                size: metadata.len(),
                modified,
            });
        }
        list
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))?;

    check_cancelled(rx.as_ref())?;

    let total = candidates.len();
    let _ = app.emit(
        "scan-progress",
        ScanProgressPayload {
            scan_id: scan_id.clone(),
            done: 0,
            total,
        },
    );

    if total == 0 {
        return Ok(Vec::new());
    }

    // Process dimensions in chunks with Rayon parallelism and progress emission
    let mut results = Vec::with_capacity(total);
    let mut done = 0;

    for chunk in candidates.chunks(SCAN_BATCH_SIZE) {
        check_cancelled(rx.as_ref())?;

        let chunk_vec: Vec<CandidateEntry> = chunk.to_vec();
        let batch_results: Vec<FolderEntry> = tokio::task::spawn_blocking(move || {
            chunk_vec
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
                .collect()
        })
        .await
        .map_err(|e| FsError::Io(e.to_string()))?;

        done += batch_results.len();
        results.extend(batch_results);

        let _ = app.emit(
            "scan-progress",
            ScanProgressPayload {
                scan_id: scan_id.clone(),
                done,
                total,
            },
        );

        tokio::task::yield_now().await;
    }

    check_cancelled(rx.as_ref())?;

    Ok(results)
}

#[tauri::command]
pub async fn discover_library(
    app: AppHandle,
    folder_path: String,
    scan_id: Option<String>,
) -> Result<LibraryDiscovery, FsError> {
    let raw_path = std::path::Path::new(folder_path.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Ok(LibraryDiscovery {
            root_path: folder_path,
            titles: Vec::new(),
            total_files: 0,
        });
    }

    let root = dunce::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf());

    // Verify root is under an allowed library root (added via select_folder or drag-and-drop)
    let allowed = app.state::<AllowedRoots>();
    if !allowed.is_allowed(&root) {
        return Err(FsError::PathNotAllowed(format!(
            "Path '{}' is not under an allowed library root",
            root.display()
        )));
    }

    let scan_mgr = app.state::<ScanManager>();
    let rx = scan_id.as_deref().map(|id| scan_mgr.register(id));

    struct ScanGuard<'a> {
        mgr: &'a ScanManager,
        id: Option<&'a str>,
    }
    impl<'a> Drop for ScanGuard<'a> {
        fn drop(&mut self) {
            if let Some(id) = self.id {
                self.mgr.unregister(id);
            }
        }
    }
    let _guard = ScanGuard {
        mgr: &scan_mgr,
        id: scan_id.as_deref(),
    };

    let check_cancelled = |rx: Option<&tokio::sync::watch::Receiver<bool>>| -> Result<(), FsError> {
        if let Some(receiver) = rx {
            if *receiver.borrow() {
                return Err(FsError::Cancelled);
            }
        }
        Ok(())
    };

    check_cancelled(rx.as_ref())?;

    // Collect candidates off the main thread
    let root_clone = root.clone();
    let candidates = tokio::task::spawn_blocking(move || {
        let mut list = Vec::new();
        let walker = walkdir::WalkDir::new(&root_clone)
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
            if list.len() >= MAX_SCAN_FILES {
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

            let rel_path = match file_path.strip_prefix(&root_clone) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);

            list.push(CandidateEntry {
                rel_path,
                abs_path: file_path.to_path_buf(),
                size: metadata.len(),
                modified,
            });
        }
        list
    })
    .await
    .map_err(|e| FsError::Io(e.to_string()))?;

    check_cancelled(rx.as_ref())?;

    let total_files = candidates.len();
    let _ = app.emit(
        "scan-progress",
        ScanProgressPayload {
            scan_id: scan_id.clone(),
            done: 0,
            total: total_files,
        },
    );

    if total_files == 0 {
        return Ok(LibraryDiscovery {
            root_path: root.to_string_lossy().to_string(),
            titles: Vec::new(),
            total_files: 0,
        });
    }

    let has_nested_titles = candidates.iter().any(|c| c.rel_path.split('/').count() >= 3);
    let root_folder_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Library".to_string());

    let mut measured_candidates: Vec<(CandidateEntry, Option<u32>, Option<u32>)> =
        Vec::with_capacity(total_files);
    let mut done = 0;

    for chunk in candidates.chunks(SCAN_BATCH_SIZE) {
        check_cancelled(rx.as_ref())?;

        let chunk_vec: Vec<CandidateEntry> = chunk.to_vec();
        let batch: Vec<(CandidateEntry, Option<u32>, Option<u32>)> =
            tokio::task::spawn_blocking(move || {
                chunk_vec
                    .into_par_iter()
                    .map(|entry| {
                        let (w, h) = parse_image_dimensions(&entry.abs_path);
                        (entry, w, h)
                    })
                    .collect()
            })
            .await
            .map_err(|e| FsError::Io(e.to_string()))?;

        done += batch.len();
        measured_candidates.extend(batch);

        let _ = app.emit(
            "scan-progress",
            ScanProgressPayload {
                scan_id: scan_id.clone(),
                done,
                total: total_files,
            },
        );

        tokio::task::yield_now().await;
    }

    check_cancelled(rx.as_ref())?;

    use std::collections::BTreeMap;
    let mut title_map: BTreeMap<String, BTreeMap<String, Vec<DiscoveredPage>>> = BTreeMap::new();
    let mut title_covers: BTreeMap<String, Option<String>> = BTreeMap::new();

    for (entry, width, height) in measured_candidates {
        let parts: Vec<&str> = entry.rel_path.split('/').collect();
        let (title_name, rel_to_title) = if has_nested_titles {
            if parts.len() > 1 {
                (parts[0].to_string(), parts[1..].join("/"))
            } else {
                (
                    format!("{} — root pages", root_folder_name),
                    parts[0].to_string(),
                )
            }
        } else {
            (root_folder_name.clone(), entry.rel_path.clone())
        };

        let title_parts: Vec<&str> = rel_to_title.split('/').collect();
        let page_file_name = title_parts
            .last()
            .copied()
            .unwrap_or(&rel_to_title)
            .to_string();

        let is_root_file = title_parts.len() == 1;
        let is_cover_name = is_root_file
            && (page_file_name.to_lowercase().starts_with("cover.")
                || page_file_name.to_lowercase().starts_with("thumbnail."));

        if is_cover_name {
            title_covers.insert(
                title_name.clone(),
                Some(entry.abs_path.to_string_lossy().to_string()),
            );
        }

        let chapter_name = if is_root_file {
            "Root pages".to_string()
        } else {
            title_parts[..title_parts.len() - 1].join(" / ")
        };

        let page = DiscoveredPage {
            name: page_file_name,
            relative_path: rel_to_title,
            absolute_path: entry.abs_path.to_string_lossy().to_string(),
            width,
            height,
            size: entry.size,
            modified: entry.modified,
        };

        title_map
            .entry(title_name.clone())
            .or_default()
            .entry(chapter_name)
            .or_default()
            .push(page);
    }

    let mut titles = Vec::new();
    for (title_name, chapters_map) in title_map {
        let mut chapters = Vec::new();
        let mut title_images = 0;

        for (chapter_name, mut pages) in chapters_map {
            pages.sort_by(|a, b| natural_order(&a.name, &b.name));
            title_images += pages.len();
            chapters.push(DiscoveredChapter {
                name: chapter_name,
                pages,
            });
        }

        chapters.sort_by(|a, b| natural_order(&a.name, &b.name));

        let cover_path = title_covers
            .get(&title_name)
            .cloned()
            .flatten()
            .or_else(|| {
                chapters
                    .first()
                    .and_then(|c| c.pages.first())
                    .map(|p| p.absolute_path.clone())
            });

        let title_root = if has_nested_titles {
            root.join(&title_name).to_string_lossy().to_string()
        } else {
            root.to_string_lossy().to_string()
        };

        titles.push(DiscoveredTitle {
            title: title_name,
            root_path: title_root,
            chapters,
            total_images: title_images,
            cover_path,
        });
    }

    titles.sort_by(|a, b| natural_order(&a.title, &b.title));

    Ok(LibraryDiscovery {
        root_path: root.to_string_lossy().to_string(),
        titles,
        total_files,
    })
}

#[tauri::command]
pub async fn read_file(
    app: AppHandle,
    absolute_path: String,
) -> Result<tauri::ipc::Response, FsError> {
    let trimmed = absolute_path.trim();
    if trimmed.is_empty() {
        return Err(FsError::NotFound("Path cannot be empty".into()));
    }

    let path = std::path::Path::new(trimmed);
    let resolved = dunce::canonicalize(path)
        .map_err(|e| FsError::NotFound(format!("Failed to resolve path: {e}")))?;

    let allowed = app.state::<AllowedRoots>();
    if !allowed.is_allowed(&resolved) {
        return Err(FsError::PathNotAllowed(format!(
            "Path '{}' is not under an allowed library root",
            resolved.display()
        )));
    }

    let ext = resolved
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_lowercase())
        .ok_or_else(|| FsError::ForbiddenExt("Missing file extension".to_string()))?;

    if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return Err(FsError::ForbiddenExt(format!(
            "File extension '.{ext}' is not an allowed image format"
        )));
    }

    let metadata = tokio::fs::metadata(&resolved)
        .await
        .map_err(|e| FsError::Io(format!("Failed to read metadata: {e}")))?;

    if !metadata.is_file() {
        return Err(FsError::NotFound("Target path is not a regular file".into()));
    }

    if metadata.len() > MAX_FILE_READ_BYTES {
        return Err(FsError::TooLarge(format!(
            "File size ({} bytes) exceeds safety cap of {} bytes",
            metadata.len(),
            MAX_FILE_READ_BYTES
        )));
    }

    let bytes = tokio::fs::read(&resolved)
        .await
        .map_err(|e| FsError::Io(format!("Failed to read file bytes: {e}")))?;

    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cmp::Ordering;

    #[test]
    fn test_natural_order_chapters() {
        assert_eq!(natural_order("Chapter 1", "Chapter 2"), Ordering::Less);
        assert_eq!(natural_order("Chapter 2", "Chapter 10"), Ordering::Less);
        assert_eq!(natural_order("Chapter 10", "Chapter 2"), Ordering::Greater);
        assert_eq!(natural_order("Chapter 1.5", "Chapter 1"), Ordering::Greater);
        assert_eq!(natural_order("Chapter 1.5", "Chapter 2"), Ordering::Less);
        assert_eq!(natural_order("001.png", "2.png"), Ordering::Less);
        assert_eq!(natural_order("10.jpg", "2.jpg"), Ordering::Greater);
        assert_eq!(natural_order("same", "same"), Ordering::Equal);
    }

    #[test]
    fn test_natural_order_categories() {
        assert_eq!(natural_order("Prologue", "Chapter 1"), Ordering::Less);
        assert_eq!(natural_order("Opening", "Chapter 1"), Ordering::Less);
        assert_eq!(natural_order("Chapter 50", "Epilogue"), Ordering::Less);
        assert_eq!(natural_order("Chapter 50", "Extra 1"), Ordering::Less);
        assert_eq!(natural_order("Chapter 50", "Bonus 1"), Ordering::Less);
        assert_eq!(natural_order("Chapter 50", "Special"), Ordering::Less);
    }

    #[test]
    fn test_is_image_file() {
        for ext in ALLOWED_IMAGE_EXTENSIONS {
            let filename = format!("cover.{}", ext);
            assert!(is_image_file(Path::new(&filename)), "Extension .{} should be allowed", ext);
            let uppercase = format!("cover.{}", ext.to_uppercase());
            assert!(is_image_file(Path::new(&uppercase)), "Uppercase .{} should be allowed", ext);
        }

        assert!(!is_image_file(Path::new("document.pdf")));
        assert!(!is_image_file(Path::new("script.js")));
        assert!(!is_image_file(Path::new("archive.zip")));
        assert!(!is_image_file(Path::new(".gitignore")));
        assert!(!is_image_file(Path::new("noextension")));
    }

    #[test]
    fn test_is_ignored_directory() {
        assert!(is_ignored_directory(Path::new(".git")));
        assert!(is_ignored_directory(Path::new(".svn")));
        assert!(is_ignored_directory(Path::new(".cache")));
        assert!(is_ignored_directory(Path::new("node_modules")));
        assert!(is_ignored_directory(Path::new("$recycle.bin")));
        assert!(is_ignored_directory(Path::new("System Volume Information")));

        assert!(!is_ignored_directory(Path::new("Chapter 1")));
        assert!(!is_ignored_directory(Path::new("Volume 1")));
        assert!(!is_ignored_directory(Path::new("manga")));
    }

    #[test]
    fn test_write_atomic() {
        let temp_dir = std::env::temp_dir().join(format!("manga_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::create_dir_all(&temp_dir);
        let target = temp_dir.join("config.json");
        let tmp = target.with_extension("tmp");

        let content = b"{\"theme\":\"dark\"}";
        assert!(write_atomic(&target, content).is_ok());

        assert!(target.exists());
        assert!(!tmp.exists());
        assert_eq!(std::fs::read(&target).unwrap(), content);

        let updated = b"{\"theme\":\"light\"}";
        assert!(write_atomic(&target, updated).is_ok());
        assert_eq!(std::fs::read(&target).unwrap(), updated);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_parse_image_dimensions() {
        let temp_dir = std::env::temp_dir().join(format!("manga_dim_test_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::create_dir_all(&temp_dir);

        // 1x1 transparent PNG
        let png_bytes = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
            0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
            0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
            0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
            0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
            0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
        ];
        let png_path = temp_dir.join("test.png");
        std::fs::write(&png_path, png_bytes).unwrap();

        let (w, h) = parse_image_dimensions(&png_path);
        assert_eq!(w, Some(1));
        assert_eq!(h, Some(1));

        let invalid_path = temp_dir.join("invalid.txt");
        std::fs::write(&invalid_path, b"not an image").unwrap();
        let (inv_w, inv_h) = parse_image_dimensions(&invalid_path);
        assert_eq!(inv_w, None);
        assert_eq!(inv_h, None);

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_allowed_roots() {
        let allowed = AllowedRoots::default();
        // Empty roots allows all
        assert!(allowed.is_allowed(Path::new("C:\\Any\\Path")));

        let root = std::env::temp_dir().join("manga_root_test");
        let _ = std::fs::create_dir_all(&root);
        allowed.add_root(root.clone());

        let subfile = root.join("title").join("01.png");
        assert!(allowed.is_allowed(&subfile));

        let outside = std::env::temp_dir().join("other_folder_outside");
        assert!(!allowed.is_allowed(&outside));

        // Traversal path outside root rejected
        let traversal = root.join("..").join("outside.png");
        let canonical_traversal = dunce::canonicalize(&traversal).unwrap_or(traversal);
        assert!(!allowed.is_allowed(&canonical_traversal));

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn test_natural_order_fixture_parity() {
        let fixtures = vec![
            "001.jpg",
            "002.jpg",
            "010.jpg",
            "099.jpg",
            "100.jpg",
            "Chapter 1",
            "Chapter 1.5",
            "Chapter 2",
            "Chapter 3",
            "Chapter 9",
            "Chapter 10",
            "Chapter 10.1",
            "Chapter 10.2",
            "Chapter 11",
            "Chapter 100",
            "Vol. 1 Ch. 1",
            "Vol. 1 Ch. 2",
            "Volume 1/Chapter 1/01.jpg",
            "Volume 1/Chapter 2/01.jpg",
            "Vol. 2 Ch. 1",
            "Volume 2/Chapter 1/01.jpg",
            "Vol. 10 Ch. 1",
            "Volume 10/Chapter 1/01.jpg",
        ];

        let mut sorted = fixtures.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        sorted.sort_by(|a, b| natural_order(a, b));

        // Check canonical sorted order invariant
        assert_eq!(sorted[0], "001.jpg");
        assert_eq!(sorted[1], "002.jpg");
        assert_eq!(sorted[2], "010.jpg");
        assert_eq!(sorted[3], "099.jpg");
        assert_eq!(sorted[4], "100.jpg");
        assert_eq!(sorted[5], "Chapter 1");
        assert_eq!(sorted[6], "Chapter 1.5");
        assert_eq!(sorted[7], "Chapter 2");
        assert_eq!(sorted[8], "Chapter 3");
        assert_eq!(sorted[9], "Chapter 9");
        assert_eq!(sorted[10], "Chapter 10");
        assert_eq!(sorted[11], "Chapter 10.1");
        assert_eq!(sorted[12], "Chapter 10.2");
        assert_eq!(sorted[13], "Chapter 11");
        assert_eq!(sorted[14], "Chapter 100");
    }

    #[test]
    fn test_parse_image_dimensions_corrupted_headers() {
        let temp_dir = std::env::temp_dir().join(format!("manga_dim_corrupt_{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::create_dir_all(&temp_dir);

        // Truncated PNG header
        let trunc_png = temp_dir.join("trunc.png");
        std::fs::write(&trunc_png, [0x89, 0x50, 0x4e, 0x47]).unwrap();
        let (tw, th) = parse_image_dimensions(&trunc_png);
        assert_eq!(tw, None);
        assert_eq!(th, None);

        // Empty file
        let empty_file = temp_dir.join("empty.jpg");
        std::fs::write(&empty_file, b"").unwrap();
        let (ew, eh) = parse_image_dimensions(&empty_file);
        assert_eq!(ew, None);
        assert_eq!(eh, None);

        // Valid GIF 1x1
        let gif_bytes = [
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00,
            0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00,
            0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00,
            0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
        ];
        let gif_file = temp_dir.join("test.gif");
        std::fs::write(&gif_file, gif_bytes).unwrap();
        let (gw, gh) = parse_image_dimensions(&gif_file);
        assert_eq!(gw, Some(1));
        assert_eq!(gh, Some(1));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
