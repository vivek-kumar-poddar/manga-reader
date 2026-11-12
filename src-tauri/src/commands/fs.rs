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

#[derive(Debug, Clone)]
pub struct DiscoverySnapshot {
    pub root_path: PathBuf,
    pub created_at: std::time::Instant,
    pub candidates: Vec<DiscoveredPage>,
}

#[derive(Default)]
pub struct DiscoveryState {
    snapshots: std::sync::Mutex<std::collections::HashMap<PathBuf, DiscoverySnapshot>>,
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
        Num(u128, usize),
        BigNum(&'a str),
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
                        if let Ok(n) = slice.parse::<u128>() {
                            tokens.push(Token::Num(n, slice.len()));
                        } else {
                            tokens.push(Token::BigNum(slice));
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
                if let Ok(n) = slice.parse::<u128>() {
                    tokens.push(Token::Num(n, slice.len()));
                } else {
                    tokens.push(Token::BigNum(slice));
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
            (Token::Num(nx, lx), Token::Num(ny, ly)) => {
                let ord = nx.cmp(ny);
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
                if lx != ly {
                    return lx.cmp(ly);
                }
            }
            (Token::BigNum(bx), Token::BigNum(by)) => {
                let tx = bx.trim_start_matches('0');
                let ty = by.trim_start_matches('0');
                let ord = tx.len().cmp(&ty.len()).then_with(|| tx.cmp(ty));
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
                if bx.len() != by.len() {
                    return bx.len().cmp(&by.len());
                }
            }
            (Token::Num(nx, _), Token::BigNum(by)) => {
                let ty = by.trim_start_matches('0');
                if ty.len() > 38 {
                    return std::cmp::Ordering::Less;
                }
                if let Ok(ny) = ty.parse::<u128>() {
                    let ord = nx.cmp(&ny);
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                return std::cmp::Ordering::Less;
            }
            (Token::BigNum(bx), Token::Num(ny, _)) => {
                let tx = bx.trim_start_matches('0');
                if tx.len() > 38 {
                    return std::cmp::Ordering::Greater;
                }
                if let Ok(nx) = tx.parse::<u128>() {
                    let ord = nx.cmp(ny);
                    if ord != std::cmp::Ordering::Equal {
                        return ord;
                    }
                }
                return std::cmp::Ordering::Greater;
            }
            (Token::Str(sx), Token::Str(sy)) => {
                let ord = sx.chars().cmp(sy.chars());
                if ord != std::cmp::Ordering::Equal {
                    return ord;
                }
            }
            (Token::Num(_, _) | Token::BigNum(_), Token::Str(_)) => {
                return std::cmp::Ordering::Less;
            }
            (Token::Str(_), Token::Num(_, _) | Token::BigNum(_)) => {
                return std::cmp::Ordering::Greater;
            }
        }
    }

    tokens_a.len().cmp(&tokens_b.len()).then_with(|| a.cmp(b))
}

#[tauri::command(async)]
pub fn natural_sort_paths(mut paths: Vec<String>) -> Vec<String> {
    paths.sort_by(|a, b| natural_order(a, b));
    paths
}

pub fn resolve_relative_path(base_dir: &Path, rel_path: &str) -> Result<PathBuf, FsError> {
    let trimmed = rel_path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err(FsError::NotFound("Empty relative path".to_string()));
    }
    let rel = Path::new(&trimmed);

    // Prevent parent directory traversal
    if rel
        .components()
        .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(FsError::PathNotAllowed(format!(
            "Path contains illegal parent directory traversal: '{rel_path}'"
        )));
    }

    // Prevent absolute paths from escaping base_dir
    #[cfg(windows)]
    if trimmed.starts_with('/') || (trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':') {
        return Err(FsError::PathNotAllowed(format!(
            "Path must be relative to root: '{rel_path}'"
        )));
    }
    #[cfg(not(windows))]
    if rel.is_absolute() {
        return Err(FsError::PathNotAllowed(format!(
            "Path must be relative to root: '{rel_path}'"
        )));
    }

    let combined = base_dir.join(rel);
    let canonical = dunce::canonicalize(&combined).map_err(|e| {
        FsError::NotFound(format!(
            "Failed to resolve path '{}' under '{}': {e}",
            rel_path,
            base_dir.display()
        ))
    })?;

    let canonical_base = dunce::canonicalize(base_dir).unwrap_or_else(|_| base_dir.to_path_buf());
    if !canonical.starts_with(&canonical_base) {
        return Err(FsError::PathNotAllowed(format!(
            "Path '{}' escapes base directory '{}'",
            rel_path,
            base_dir.display()
        )));
    }

    Ok(canonical)
}

#[tauri::command]
pub async fn resolve_manga_path(
    app: AppHandle,
    manga_id: Option<String>,
    relative_path: String,
    local_path: Option<String>,
) -> Result<String, FsError> {
    let base_str = if let Some(ref lp) = local_path {
        if !lp.trim().is_empty() {
            Some(lp.trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    let base_str = match base_str {
        Some(s) => s,
        None => {
            if let Some(ref id) = manga_id {
                if let Some(db) = app.try_state::<crate::db::DbState>() {
                    db.get_local_path(id).await.ok_or_else(|| {
                        FsError::NotFound(format!("Manga '{id}' has no localPath recorded"))
                    })?
                } else {
                    return Err(FsError::NotFound(
                        "Database state not initialized".to_string(),
                    ));
                }
            } else {
                return Err(FsError::NotFound(
                    "Neither manga_id nor local_path provided".to_string(),
                ));
            }
        }
    };

    let base_dir = PathBuf::from(base_str);
    let resolved = resolve_relative_path(&base_dir, &relative_path)?;

    let allowed = app.state::<AllowedRoots>();
    if !allowed.is_allowed(&resolved) {
        return Err(FsError::PathNotAllowed(format!(
            "Resolved path '{}' is not under an allowed root",
            resolved.display()
        )));
    }

    Ok(resolved.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn check_access(
    app: AppHandle,
    manga_id: Option<String>,
    local_path: Option<String>,
) -> Result<bool, FsError> {
    let target_path = if let Some(ref lp) = local_path {
        if !lp.trim().is_empty() {
            Some(lp.trim().to_string())
        } else {
            None
        }
    } else {
        None
    };

    let target_path = match target_path {
        Some(p) => p,
        None => {
            if let Some(ref id) = manga_id {
                if let Some(db) = app.try_state::<crate::db::DbState>() {
                    match db.get_local_path(id).await {
                        Some(p) => p,
                        None => return Ok(false),
                    }
                } else {
                    return Ok(false);
                }
            } else {
                return Ok(false);
            }
        }
    };

    let trimmed = target_path.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }

    let pb = Path::new(trimmed);
    let canonical = match dunce::canonicalize(pb) {
        Ok(c) => c,
        Err(_) => return Ok(false),
    };

    if !canonical.is_dir() {
        return Ok(false);
    }

    let allowed = app.state::<AllowedRoots>();
    Ok(allowed.is_allowed(&canonical))
}

#[tauri::command]
pub async fn prepare_chapter_headers(
    app: AppHandle,
    paths: Vec<String>,
    manga_id: Option<String>,
) -> Result<Vec<PageHeader>, FsError> {
    let allowed_set = {
        let allowed = app.state::<AllowedRoots>();
        allowed.get_active_roots()
    };

    let base_dir: Option<PathBuf> = if let Some(ref id) = manga_id {
        if let Some(db) = app.try_state::<crate::db::DbState>() {
            db.get_local_path(id).await.map(PathBuf::from)
        } else {
            None
        }
    } else {
        None
    };

    // Parallel extraction with Rayon off main thread
    let results: Vec<PageHeader> = tauri::async_runtime::spawn_blocking(move || {
        paths
            .into_par_iter()
            .filter_map(|p_str| {
                let trimmed = p_str.trim();
                let path = Path::new(trimmed);

                let resolved = if path.is_relative() {
                    if let Some(ref base) = base_dir {
                        resolve_relative_path(base, trimmed).ok()?
                    } else {
                        dunce::canonicalize(path).ok()?
                    }
                } else {
                    dunce::canonicalize(path).ok()?
                };

                if allowed_set.is_empty() || !allowed_set.iter().any(|r| resolved.starts_with(r)) {
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
                let (width, height) = match parse_image_dimensions(&resolved) {
                    (Some(w), Some(h)) => (w, h),
                    _ => return None,
                };

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
pub struct AllowedRoots {
    pub active: RwLock<HashSet<PathBuf>>,
    pub unavailable: RwLock<HashSet<PathBuf>>,
}

pub fn resolve_canonical_path(path: &Path) -> Option<PathBuf> {
    if let Ok(c) = dunce::canonicalize(path) {
        return Some(c);
    }
    // If the leaf does not exist on disk, canonicalize its closest existing ancestor
    let mut remaining = Vec::new();
    let mut current = path;
    while let Some(parent) = current.parent() {
        if let Some(file_name) = current.file_name() {
            remaining.push(file_name);
        }
        if let Ok(c) = dunce::canonicalize(parent) {
            let mut resolved = c;
            for comp in remaining.into_iter().rev() {
                resolved.push(comp);
            }
            return Some(resolved);
        }
        current = parent;
    }
    None
}

impl AllowedRoots {
    pub fn new(active: HashSet<PathBuf>, unavailable: HashSet<PathBuf>) -> Self {
        Self {
            active: RwLock::new(active),
            unavailable: RwLock::new(unavailable),
        }
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        // Fail closed if path cannot be canonicalized to an existing ancestor
        let canonical = match resolve_canonical_path(path) {
            Some(c) => c,
            None => return false,
        };
        if canonical
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return false;
        }

        // 1. Check currently active canonical roots
        {
            let active = self.active.read().unwrap();
            if !active.is_empty() && active.iter().any(|root| canonical.starts_with(root)) {
                return true;
            }
        }

        // 2. Check if an unavailable root (e.g. re-attached drive) has become reachable
        let mut promoted = false;
        {
            let mut unavail = self.unavailable.write().unwrap();
            let mut to_promote = Vec::new();
            for unavail_root in unavail.iter() {
                if let Ok(c_root) = dunce::canonicalize(unavail_root) {
                    if canonical.starts_with(&c_root) {
                        to_promote.push((unavail_root.clone(), c_root));
                    }
                }
            }
            for (u, c) in to_promote {
                unavail.remove(&u);
                self.active.write().unwrap().insert(c);
                promoted = true;
            }
        }
        promoted
    }

    pub fn add_root(&self, path: PathBuf) {
        if let Ok(canonical) = dunce::canonicalize(&path) {
            self.active.write().unwrap().insert(canonical);
        } else {
            // Fail closed for active authorization; preserve separately for relinking
            self.unavailable.write().unwrap().insert(path);
        }
    }

    pub fn revoke_root(&self, path: &Path) -> bool {
        let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let mut active = self.active.write().unwrap();
        let mut unavail = self.unavailable.write().unwrap();

        let removed_active = active.remove(&canonical);
        let removed_unavail = unavail.remove(path) || unavail.remove(&canonical);

        let to_remove_active: Vec<PathBuf> = active
            .iter()
            .filter(|r| **r == canonical || r.starts_with(&canonical) || canonical.starts_with(r))
            .cloned()
            .collect();
        for r in to_remove_active {
            active.remove(&r);
        }

        let to_remove_unavail: Vec<PathBuf> = unavail
            .iter()
            .filter(|r| **r == canonical || r.starts_with(&canonical) || canonical.starts_with(r))
            .cloned()
            .collect();
        for r in to_remove_unavail {
            unavail.remove(&r);
        }

        removed_active || removed_unavail
    }

    pub fn get_roots(&self) -> Vec<PathBuf> {
        let mut all: Vec<PathBuf> = self.active.read().unwrap().iter().cloned().collect();
        for unavail in self.unavailable.read().unwrap().iter() {
            if !all.contains(unavail) {
                all.push(unavail.clone());
            }
        }
        all
    }

    pub fn get_active_roots(&self) -> HashSet<PathBuf> {
        self.active.read().unwrap().clone()
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

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

static ATOMIC_WRITE_COUNTER: AtomicU64 = AtomicU64::new(1);
static DESTINATION_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_destination_lock(path: &Path) -> Arc<Mutex<()>> {
    let key = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut locks = DESTINATION_LOCKS.lock().unwrap();
    locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Atomically writes data to path using a unique same-directory temporary file
/// serialized per destination, syncing to disk before renaming over the target.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let dest_lock = get_destination_lock(path);
    let _guard = dest_lock.lock().unwrap();

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;

    let file_stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("atomic");
    let pid = std::process::id();
    let counter = ATOMIC_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{file_stem}_{pid}_{counter}.tmp"));

    let res = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);

        #[cfg(target_os = "windows")]
        {
            if path.exists() {
                let mut attempts = 0;
                loop {
                    match std::fs::rename(&tmp, path) {
                        Ok(()) => return Ok(()),
                        Err(_e) if attempts < 3 => {
                            attempts += 1;
                            std::thread::sleep(std::time::Duration::from_millis(15));
                        }
                        Err(e) => return Err(e),
                    }
                }
            } else {
                std::fs::rename(&tmp, path)?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            std::fs::rename(&tmp, path)?;
        }

        Ok(())
    })();

    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

pub fn load_persisted_roots(app: &AppHandle) -> (HashSet<PathBuf>, HashSet<PathBuf>) {
    let mut active = HashSet::new();
    let mut unavailable = HashSet::new();
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
                                active.insert(canonical);
                            } else {
                                // Unavailable at startup (e.g. disconnected drive), preserve separately
                                unavailable.insert(pb);
                            }
                        }
                        if !active.is_empty() || !unavailable.is_empty() {
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
    (active, unavailable)
}

pub fn save_persisted_roots(app: &AppHandle, allowed: &AllowedRoots) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_dir);
        let file_path = app_dir.join("allowed_roots.json");
        let list: Vec<String> = allowed
            .get_roots()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if let Ok(data) = serde_json::to_string(&list) {
            let _ = write_atomic(&file_path, data.as_bytes());
        }
    }
}

pub fn init_allowed_roots(app: &AppHandle) -> AllowedRoots {
    let (active, unavailable) = load_persisted_roots(app);
    AllowedRoots::new(active, unavailable)
}

pub struct ScanHandle {
    pub receiver: tokio::sync::watch::Receiver<bool>,
    pub flag: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

type ActiveScanEntry = (
    tokio::sync::watch::Sender<bool>,
    std::sync::Arc<std::sync::atomic::AtomicBool>,
);
type ActiveScanMap = std::collections::HashMap<String, ActiveScanEntry>;

#[derive(Default)]
pub struct ScanManager {
    active_scans: std::sync::Mutex<ActiveScanMap>,
}

impl ScanManager {
    pub fn register(&self, id: &str) -> ScanHandle {
        let (tx, rx) = tokio::sync::watch::channel(false);
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.active_scans
            .lock()
            .unwrap()
            .insert(id.to_string(), (tx, std::sync::Arc::clone(&flag)));
        ScanHandle { receiver: rx, flag }
    }

    pub fn unregister(&self, id: &str) {
        self.active_scans.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some((tx, flag)) = self.active_scans.lock().unwrap().get(id) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            let _ = tx.send(true);
            true
        } else {
            false
        }
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        if let Some((_, flag)) = self.active_scans.lock().unwrap().get(id) {
            flag.load(std::sync::atomic::Ordering::Relaxed)
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
    let app_clone = app.clone();
    let folder = tokio::task::spawn_blocking(move || app_clone.dialog().file().blocking_pick_folder())
        .await
        .map_err(|e| FsError::Io(format!("Dialog task join error: {e}")))?;
    if let Some(ref path) = folder {
        let pb = PathBuf::from(path.to_string());
        let allowed = app.state::<AllowedRoots>();
        allowed.add_root(pb);
        save_persisted_roots(&app, &allowed);
    }
    Ok(folder.map(|p| p.to_string()))
}

#[tauri::command(async)]
pub fn cancel_scan(app: AppHandle, scan_id: String) -> Result<bool, FsError> {
    let scan_mgr = app.state::<ScanManager>();
    Ok(scan_mgr.cancel(&scan_id))
}

#[tauri::command(async)]
pub fn is_same_path(path_a: String, path_b: String) -> bool {
    let pa = Path::new(path_a.trim());
    let pb = Path::new(path_b.trim());
    if let (Ok(ca), Ok(cb)) = (dunce::canonicalize(pa), dunce::canonicalize(pb)) {
        return ca == cb;
    }
    let norm_a = path_a
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase();
    let norm_b = path_b
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase();
    norm_a == norm_b
}

#[tauri::command(async)]
pub fn revoke_root(app: AppHandle, root_path: String) -> Result<bool, FsError> {
    let trimmed = root_path.trim();
    if trimmed.is_empty() {
        return Ok(false);
    }
    let pb = PathBuf::from(trimmed);
    let allowed = app.state::<AllowedRoots>();
    let removed = allowed.revoke_root(&pb);
    if removed {
        save_persisted_roots(&app, &allowed);
        // Also remove from last_opened_roots in AppConfig if present
        if let Some(config_state) = app.try_state::<crate::commands::config::AppConfigState>() {
            let _ = config_state.update(&app, |cfg| {
                cfg.last_opened_roots.retain(|r| {
                    if let (Ok(cr), Ok(cp)) =
                        (dunce::canonicalize(Path::new(r)), dunce::canonicalize(&pb))
                    {
                        cr != cp
                    } else {
                        r != trimmed
                    }
                });
            });
        }
    }
    Ok(removed)
}

#[tauri::command(async)]
pub fn get_authorized_roots(app: AppHandle) -> Result<Vec<String>, FsError> {
    let allowed = app.state::<AllowedRoots>();
    let roots = allowed.get_roots();
    Ok(roots
        .into_iter()
        .map(|p| p.to_string_lossy().to_string())
        .collect())
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
    let handle = scan_id.as_deref().map(|id| scan_mgr.register(id));
    let cancel_flag = handle.as_ref().map(|h| std::sync::Arc::clone(&h.flag));

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

    let check_cancelled = |handle: Option<&ScanHandle>| -> Result<(), FsError> {
        if let Some(h) = handle {
            if h.flag.load(std::sync::atomic::Ordering::Relaxed) || *h.receiver.borrow() {
                return Err(FsError::Cancelled);
            }
        }
        Ok(())
    };

    check_cancelled(handle.as_ref())?;

    // Collect candidates off the main thread
    let root_clone = root.clone();
    let candidates = tauri::async_runtime::spawn_blocking(move || {
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
            if let Some(ref cf) = cancel_flag {
                if cf.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
            }
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

    check_cancelled(handle.as_ref())?;

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
        check_cancelled(handle.as_ref())?;

        let chunk_vec: Vec<CandidateEntry> = chunk.to_vec();
        let batch_results: Vec<FolderEntry> = tauri::async_runtime::spawn_blocking(move || {
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

    check_cancelled(handle.as_ref())?;

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
    let handle = scan_id.as_deref().map(|id| scan_mgr.register(id));
    let cancel_flag = handle.as_ref().map(|h| std::sync::Arc::clone(&h.flag));

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

    let check_cancelled = |handle: Option<&ScanHandle>| -> Result<(), FsError> {
        if let Some(h) = handle {
            if h.flag.load(std::sync::atomic::Ordering::Relaxed) || *h.receiver.borrow() {
                return Err(FsError::Cancelled);
            }
        }
        Ok(())
    };

    check_cancelled(handle.as_ref())?;

    // Collect candidates off the main thread
    let root_clone = root.clone();
    let candidates = tauri::async_runtime::spawn_blocking(move || {
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
            if let Some(ref cf) = cancel_flag {
                if cf.load(std::sync::atomic::Ordering::Relaxed) {
                    break;
                }
            }
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

    check_cancelled(handle.as_ref())?;

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

    let has_nested_titles = candidates
        .iter()
        .any(|c| c.rel_path.split('/').count() >= 3);
    let root_folder_name = root
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Library".to_string());

    let mut measured_candidates: Vec<(CandidateEntry, Option<u32>, Option<u32>)> =
        Vec::with_capacity(total_files);
    let mut done = 0;

    for chunk in candidates.chunks(SCAN_BATCH_SIZE) {
        check_cancelled(handle.as_ref())?;

        let chunk_vec: Vec<CandidateEntry> = chunk.to_vec();
        let batch: Vec<(CandidateEntry, Option<u32>, Option<u32>)> =
            tauri::async_runtime::spawn_blocking(move || {
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

    check_cancelled(handle.as_ref())?;

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

        let root_pages_label = format!("{} — root pages", root_folder_name);
        let title_root = if has_nested_titles && title_name != root_pages_label {
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

    let all_pages: Vec<DiscoveredPage> = titles
        .iter()
        .flat_map(|t| t.chapters.iter().flat_map(|c| c.pages.clone()))
        .collect();

    if let Some(state) = app.try_state::<DiscoveryState>() {
        state.store(root.clone(), all_pages);
    }

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

    // Open file directly - holding the descriptor prevents TOCTOU junction / link substitution
    let mut file = tokio::fs::File::open(&resolved)
        .await
        .map_err(|e| FsError::Io(format!("Failed to open file: {e}")))?;

    let metadata = file
        .metadata()
        .await
        .map_err(|e| FsError::Io(format!("Failed to read metadata: {e}")))?;

    if !metadata.is_file() {
        return Err(FsError::NotFound(
            "Target path is not a regular file".into(),
        ));
    }

    if metadata.len() > MAX_FILE_READ_BYTES {
        return Err(FsError::TooLarge(format!(
            "File size ({} bytes) exceeds safety cap of {} bytes",
            metadata.len(),
            MAX_FILE_READ_BYTES
        )));
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    tokio::io::AsyncReadExt::read_to_end(&mut file, &mut bytes)
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

        // Long digit string precision (> 18 digits)
        assert_eq!(
            natural_order(
                "item_100000000000000000000001",
                "item_100000000000000000000002"
            ),
            Ordering::Less
        );
        assert_eq!(
            natural_order(
                "item_100000000000000000000002",
                "item_100000000000000000000001"
            ),
            Ordering::Greater
        );
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
            assert!(
                is_image_file(Path::new(&filename)),
                "Extension .{} should be allowed",
                ext
            );
            let uppercase = format!("cover.{}", ext.to_uppercase());
            assert!(
                is_image_file(Path::new(&uppercase)),
                "Uppercase .{} should be allowed",
                ext
            );
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
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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

        // Test concurrent writers to the same destination
        let mut handles = Vec::new();
        for i in 0..8 {
            let target_clone = target.clone();
            handles.push(std::thread::spawn(move || {
                let data = format!("{{\"worker\":{i}}}");
                write_atomic(&target_clone, data.as_bytes()).unwrap();
            }));
        }
        for h in handles {
            h.join().unwrap();
        }
        assert!(target.exists());
        let final_content = std::fs::read_to_string(&target).unwrap();
        assert!(final_content.starts_with("{\"worker\":"));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_parse_image_dimensions() {
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_dim_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);

        // 1x1 transparent PNG
        let png_bytes = [
            0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48,
            0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00,
            0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78,
            0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
            0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
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
        // Empty roots denies all
        assert!(!allowed.is_allowed(Path::new("C:\\Any\\Path")));

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
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_dim_corrupt_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
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
            0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff,
            0xff, 0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00,
            0x3b,
        ];
        let gif_file = temp_dir.join("test.gif");
        std::fs::write(&gif_file, gif_bytes).unwrap();
        let (gw, gh) = parse_image_dimensions(&gif_file);
        assert_eq!(gw, Some(1));
        assert_eq!(gh, Some(1));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_is_same_path() {
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_same_path_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);

        let sub_dir = temp_dir.join("subfolder");
        let _ = std::fs::create_dir_all(&sub_dir);

        let p1 = sub_dir.to_string_lossy().to_string();
        let p2 = format!("{}/", p1.replace('\\', "/"));
        assert!(is_same_path(p1.clone(), p2));

        let non_existent_1 = "C:/test/path/b".to_string();
        let non_existent_2 = "C:\\test\\path\\b".to_string();
        // Fallback normalized comparison handles case/slash differences
        assert!(is_same_path(non_existent_1, non_existent_2));

        let different = temp_dir.to_string_lossy().to_string();
        assert!(!is_same_path(p1, different));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_scan_manager_atomic_cancellation() {
        let mgr = ScanManager::default();
        let handle = mgr.register("scan-123");
        assert!(!handle.flag.load(std::sync::atomic::Ordering::Relaxed));
        assert!(!*handle.receiver.borrow());

        assert!(mgr.cancel("scan-123"));
        assert!(handle.flag.load(std::sync::atomic::Ordering::Relaxed));
        assert!(*handle.receiver.borrow());
        assert!(mgr.is_cancelled("scan-123"));

        mgr.unregister("scan-123");
        assert!(!mgr.cancel("scan-123"));
    }

    #[test]
    fn test_resolve_relative_path_safety() {
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_resolve_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);

        let ch1 = temp_dir.join("Chapter 1");
        let _ = std::fs::create_dir_all(&ch1);
        let page1 = ch1.join("01.jpg");
        std::fs::write(&page1, b"fake image").unwrap();

        // 1. Valid resolution
        let resolved = resolve_relative_path(&temp_dir, "Chapter 1/01.jpg").unwrap();
        assert_eq!(
            dunce::canonicalize(&page1).unwrap(),
            dunce::canonicalize(resolved).unwrap()
        );

        // 2. Traversal rejection
        assert!(matches!(
            resolve_relative_path(&temp_dir, "../secret.txt"),
            Err(FsError::PathNotAllowed(_))
        ));
        assert!(matches!(
            resolve_relative_path(&temp_dir, "Chapter 1/../../secret.txt"),
            Err(FsError::PathNotAllowed(_))
        ));

        // 3. Absolute path rejection
        #[cfg(windows)]
        {
            assert!(matches!(
                resolve_relative_path(&temp_dir, "C:/Windows/System32/cmd.exe"),
                Err(FsError::PathNotAllowed(_))
            ));
            assert!(matches!(
                resolve_relative_path(&temp_dir, "/Windows/System32"),
                Err(FsError::PathNotAllowed(_))
            ));
        }

        // 4. Non-existent file error
        assert!(matches!(
            resolve_relative_path(&temp_dir, "Chapter 1/does_not_exist.jpg"),
            Err(FsError::NotFound(_))
        ));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_revoke_root_and_get_authorized_roots() {
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_roots_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);

        let allowed = AllowedRoots::default();
        assert_eq!(allowed.get_roots().len(), 0);

        allowed.add_root(temp_dir.clone());
        assert!(allowed.is_allowed(&temp_dir));
        assert_eq!(allowed.get_roots().len(), 1);

        // Revoke root
        assert!(allowed.revoke_root(&temp_dir));
        assert!(!allowed.is_allowed(&temp_dir));
        assert_eq!(allowed.get_roots().len(), 0);

        // Revoking already revoked root returns false
        assert!(!allowed.revoke_root(&temp_dir));

        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
