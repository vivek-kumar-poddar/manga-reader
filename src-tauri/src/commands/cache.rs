use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

const MAX_THUMBNAIL_BYTES: usize = 10 * 1024 * 1024; // 10 MiB safety cap

pub fn percent_decode(input: &str) -> String {
    let mut bytes = Vec::with_capacity(input.len());
    let mut chars = input.bytes();
    while let Some(b) = chars.next() {
        if b == b'%' {
            let h1 = chars.next();
            let h2 = chars.next();
            match (h1, h2) {
                (Some(c1), Some(c2)) => {
                    let hex_str = [c1, c2];
                    if let Ok(s) = std::str::from_utf8(&hex_str) {
                        if let Ok(val) = u8::from_str_radix(s, 16) {
                            bytes.push(val);
                            continue;
                        }
                    }
                    bytes.push(b'%');
                    bytes.push(c1);
                    bytes.push(c2);
                }
                (Some(c1), None) => {
                    bytes.push(b'%');
                    bytes.push(c1);
                }
                _ => {
                    bytes.push(b'%');
                }
            }
        } else {
            bytes.push(b);
        }
    }
    String::from_utf8(bytes).unwrap_or_else(|_| input.to_string())
}

/// Sanitizes thumbnail ID to prevent path traversal attacks, namespace collisions,
/// and Windows reserved device name collisions (e.g. CON, PRN, AUX, NUL).
/// Always hashes with an explicit "thumb_v1:" domain separator and "t_" prefix.
pub fn sanitize_id(id: &str) -> String {
    if id.is_empty() {
        return String::new();
    }
    let mut hasher = Sha256::new();
    hasher.update(b"thumb_v1:");
    hasher.update(id.as_bytes());
    format!("t_{:x}", hasher.finalize())
}

/// Generates a collision-resistant SHA-256 hash for variant cache keys with an explicit namespace.
pub fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"variant_v1:");
    hasher.update(key.as_bytes());
    format!("v_{:x}", hasher.finalize())
}

pub fn get_thumbnail_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() {
        return Err("Thumbnail ID cannot be empty".into());
    }

    let safe_id = sanitize_id(id);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve cache dir: {e}"))?;

    let thumb_dir = cache_dir.join("thumbnails");
    if !thumb_dir.exists() {
        let _ = std::fs::create_dir_all(&thumb_dir);
    }

    Ok(thumb_dir.join(format!("{}.webp", safe_id)))
}

pub fn get_variant_path(
    app: &AppHandle,
    key: &str,
    width: u32,
    height: u32,
) -> Result<PathBuf, String> {
    let hash = hash_key(key);
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve cache dir: {e}"))?;

    let var_dir = cache_dir.join("variants");
    if !var_dir.exists() {
        let _ = std::fs::create_dir_all(&var_dir);
    }

    Ok(var_dir.join(format!("{}_{}x{}.webp", hash, width, height)))
}

#[tauri::command]
pub async fn save_thumbnail(
    app: AppHandle,
    request: tauri::ipc::Request<'_>,
) -> Result<(), String> {
    let (id, bytes) = match request.body() {
        tauri::ipc::InvokeBody::Raw(raw_bytes) => {
            let id_header = request
                .headers()
                .get("x-id")
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "missing x-id header".to_string())?;
            (percent_decode(id_header), raw_bytes.to_vec())
        }
        tauri::ipc::InvokeBody::Json(json) => {
            let id = json
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let bytes = if let Some(arr) = json.get("bytes").and_then(|v| v.as_array()) {
                let mut byte_vec = Vec::with_capacity(arr.len());
                for (idx, item) in arr.iter().enumerate() {
                    let val = item.as_u64().ok_or_else(|| {
                        format!("Invalid byte entry at index {idx}: expected unsigned integer")
                    })?;
                    if val > 255 {
                        return Err(format!(
                            "Byte value {val} at index {idx} exceeds 255 (valid byte range 0..=255)"
                        ));
                    }
                    byte_vec.push(val as u8);
                }
                byte_vec
            } else {
                return Err("Expected raw body or JSON 'bytes' array".into());
            };
            (id, bytes)
        }
    };

    if id.is_empty() {
        return Err("Thumbnail ID cannot be empty".into());
    }

    if bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err(format!(
            "Thumbnail exceeds maximum size of {} bytes",
            MAX_THUMBNAIL_BYTES
        ));
    }

    let path = get_thumbnail_path(&app, &id)?;
    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        crate::commands::fs::write_atomic(&path, &bytes).map_err(|e| format!("{e}"))?;
        if !path.exists() {
            return Err("Failed to verify thumbnail file existence on disk".to_string());
        }
        Ok(())
    })
    .await
    .map_err(|e| format!("Failed to spawn blocking write: {e}"))?
    .map_err(|e| format!("Failed to write thumbnail to disk: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn read_thumbnail(app: AppHandle, id: String) -> Result<tauri::ipc::Response, String> {
    let path = get_thumbnail_path(&app, &id)?;
    if !path.exists() || !path.is_file() {
        return Ok(tauri::ipc::Response::new(Vec::new()));
    }

    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read thumbnail: {e}"))?;

    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub async fn get_thumbnail_url(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let path = get_thumbnail_path(&app, &id)?;
    if path.exists() && path.is_file() {
        Ok(Some(crate::protocol::path_to_mangaimg_url(&path)))
    } else {
        Ok(None)
    }
}

/// Prunes image variants cache directory if size exceeds 500 MiB or 1,000 files.
pub fn prune_cache(app: &AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve cache dir: {e}"))?;
    let var_dir = cache_dir.join("variants");
    if !var_dir.exists() {
        return Ok(());
    }

    if let Ok(entries) = std::fs::read_dir(&var_dir) {
        let mut files: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
        for entry in entries.flatten() {
            if let Ok(meta) = entry.metadata() {
                if meta.is_file() {
                    let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                    files.push((entry.path(), mtime, meta.len()));
                }
            }
        }

        let mut total_size: u64 = files.iter().map(|f| f.2).sum();
        let mut remaining = files.len();
        if total_size > 500 * 1024 * 1024 || remaining > 1000 {
            files.sort_by_key(|f| f.1); // oldest first
            for (p, _, len) in files {
                if total_size <= 400 * 1024 * 1024 && remaining <= 800 {
                    break;
                }
                if std::fs::remove_file(p).is_ok() {
                    total_size = total_size.saturating_sub(len);
                    remaining = remaining.saturating_sub(1);
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn delete_thumbnail(app: AppHandle, id: String) -> Result<(), String> {
    let path = get_thumbnail_path(&app, &id)?;
    if path.exists() {
        let _ = tokio::fs::remove_file(&path).await;
    }
    let app_clone = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let _ = prune_cache(&app_clone);
    })
    .await;
    Ok(())
}

#[tauri::command]
pub async fn clear_thumbnails(app: AppHandle) -> Result<(), String> {
    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Failed to resolve cache dir: {e}"))?;

    let thumb_dir = cache_dir.join("thumbnails");
    if thumb_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&thumb_dir).await;
    }
    let var_dir = cache_dir.join("variants");
    if var_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&var_dir).await;
    }
    Ok(())
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct StorageStats {
    pub db_bytes: u64,
    pub cache_bytes: u64,
    pub total_bytes: u64,
}

fn dir_size(path: &Path) -> u64 {
    let mut total = 0;
    if let Ok(entries) = std::fs::read_dir(path) {
        for entry in entries.flatten() {
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    total += dir_size(&entry.path());
                } else {
                    total += metadata.len();
                }
            }
        }
    }
    total
}

#[tauri::command]
pub async fn get_storage_stats(app: AppHandle) -> Result<StorageStats, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut db_bytes = 0u64;
        if let Ok(data_dir) = app.path().app_data_dir() {
            for file_name in &["library.db", "library.db-wal", "library.db-shm"] {
                let p = data_dir.join(file_name);
                if let Ok(meta) = std::fs::metadata(&p) {
                    db_bytes += meta.len();
                }
            }
        }

        let mut cache_bytes = 0u64;
        if let Ok(cache_dir) = app.path().app_cache_dir() {
            cache_bytes += dir_size(&cache_dir.join("thumbnails"));
            cache_bytes += dir_size(&cache_dir.join("variants"));
        }

        let total_bytes = db_bytes + cache_bytes;
        Ok(StorageStats {
            db_bytes,
            cache_bytes,
            total_bytes,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn save_file_dialog(
    app: AppHandle,
    default_name: String,
    content: String,
) -> Result<bool, String> {
    let safe_default = Path::new(&default_name)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("export.txt")
        .to_string();

    let app_clone = app.clone();
    let path_opt = tokio::task::spawn_blocking(move || {
        let mut builder = app_clone.dialog().file();
        if !safe_default.is_empty() {
            builder = builder.set_file_name(&safe_default);
        }
        builder.blocking_save_file()
    })
    .await
    .map_err(|e| format!("Dialog task join error: {e}"))?;

    if let Some(file_path) = path_opt {
        let pb = file_path
            .into_path()
            .map_err(|e| format!("Invalid selected file path: {e}"))?;
        let ext = pb
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.to_ascii_lowercase())
            .unwrap_or_default();
        if ext != "json" && ext != "txt" {
            return Err("Only .json and .txt exports are permitted".to_string());
        }
        let bytes = content.into_bytes();
        tokio::task::spawn_blocking(move || crate::commands::fs::write_atomic(&pb, &bytes))
            .await
            .map_err(|e| format!("Write task join error: {e}"))?
            .map_err(|e| format!("Failed to write file: {e}"))?;
        Ok(true)
    } else {
        Ok(false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_percent_decode() {
        assert_eq!(percent_decode("hello"), "hello");
        assert_eq!(percent_decode("hello%20world"), "hello world");
        assert_eq!(percent_decode("%2Fpath%2Fto%2Ffile"), "/path/to/file");
        assert_eq!(percent_decode("special%3A%2B%3D"), "special:+=");
        assert_eq!(percent_decode("incomplete%2"), "incomplete%2");
    }

    #[test]
    fn test_sanitize_id() {
        let safe1 = sanitize_id("manga-123_abc");
        assert!(safe1.starts_with("t_"));
        assert_eq!(safe1.len(), 66);

        // Deterministic hashing
        assert_eq!(safe1, sanitize_id("manga-123_abc"));

        // Windows reserved device names cannot form raw filename
        let con_safe = sanitize_id("con");
        assert!(con_safe.starts_with("t_"));
        assert_ne!(con_safe, "con");
        assert_eq!(con_safe.len(), 66);

        let aux_safe = sanitize_id("aux");
        assert!(aux_safe.starts_with("t_"));
        assert_ne!(aux_safe, "aux");

        // Traversal attempts cannot escape or contain slashes
        let traversal = sanitize_id("../../etc/passwd");
        assert!(!traversal.contains(".."));
        assert!(!traversal.contains('/'));
        assert!(!traversal.contains('\\'));
        assert_eq!(traversal.len(), 66);

        // Different IDs produce different hashes
        assert_ne!(sanitize_id("manga-1"), sanitize_id("manga-2"));

        // Empty string returns empty
        assert_eq!(sanitize_id(""), "");
    }

    #[test]
    fn test_hash_key() {
        let hash1 = hash_key("path/to/image.png");
        let hash2 = hash_key("path/to/image.png");
        assert_eq!(
            hash1, hash2,
            "Identical inputs must produce identical hashes"
        );
        assert!(hash1.starts_with("v_"));

        let hash3 = hash_key("path/to/image2.png");
        assert_ne!(
            hash1, hash3,
            "Different inputs must produce different hashes"
        );

        assert_eq!(
            hash1.len(),
            66,
            "Hash key must be 66-char prefixed SHA-256 string"
        );
        assert!(hash1[2..].chars().all(|c| c.is_ascii_hexdigit()));
    }
}