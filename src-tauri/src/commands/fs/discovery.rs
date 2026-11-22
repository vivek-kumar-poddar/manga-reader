use rayon::prelude::*;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use super::roots::{AllowedRoots, save_persisted_roots};
use super::scanner::{ScanHandle, ScanManager, parse_image_dimensions};
use super::sorting::natural_order;
use super::types::{
    ALLOWED_IMAGE_EXTENSIONS, CandidateEntry, DiscoveredChapter, DiscoveredPage, DiscoveredTitle,
    DiscoveryState, FolderEntry, FsError, IGNORED_FOLDER_NAMES, LibraryDiscovery,
    MAX_DEPTH, MAX_FILE_READ_BYTES, MAX_SCAN_FILES, SCAN_BATCH_SIZE, ScanProgressPayload,
};

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

    let has_nested_titles = false;
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
