use sha2::{Digest, Sha256};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

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

/// Sanitizes thumbnail ID to prevent path traversal attacks and collisions.
/// Alphanumeric, hyphen, and underscore characters up to 64 bytes are kept as-is.
/// Any string with special characters or exceeding 64 bytes is hashed with SHA-256.
pub fn sanitize_id(id: &str) -> String {
    if id.is_empty() {
        return String::new();
    }
    if id.len() <= 64
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return id.to_string();
    }

    let mut hasher = Sha256::new();
    hasher.update(id.as_bytes());
    format!("{:x}", hasher.finalize())
}

/// Generates a collision-resistant SHA-256 hash for variant cache keys.
pub fn hash_key(key: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(key.as_bytes());
    format!("{:x}", hasher.finalize())
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
                arr.iter()
                    .filter_map(|n| n.as_u64().map(|b| b as u8))
                    .collect()
            } else {
                return Err("expected raw body or json bytes array".into());
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
    tauri::async_runtime::spawn_blocking(move || crate::commands::fs::write_atomic(&path, &bytes))
        .await
        .map_err(|e| format!("Failed to spawn blocking write: {e}"))?
        .map_err(|e| format!("Failed to write thumbnail to disk: {e}"))?;

    Ok(())
}

#[tauri::command]
pub async fn read_thumbnail(
    app: AppHandle,
    id: String,
) -> Result<tauri::ipc::Response, String> {
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
pub async fn get_thumbnail_url(
    app: AppHandle,
    id: String,
) -> Result<Option<String>, String> {
    let path = get_thumbnail_path(&app, &id)?;
    if path.exists() && path.is_file() {
        Ok(Some(crate::protocol::path_to_mangaimg_url(&path)))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn delete_thumbnail(app: AppHandle, id: String) -> Result<(), String> {
    let path = get_thumbnail_path(&app, &id)?;
    if path.exists() {
        let _ = tokio::fs::remove_file(&path).await;
    }
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
        assert_eq!(sanitize_id("manga-123_abc"), "manga-123_abc");
        assert_eq!(sanitize_id("simple"), "simple");

        // Traversal attempts must NOT stay as ../
        let traversal = sanitize_id("../../etc/passwd");
        assert!(!traversal.contains(".."));
        assert!(!traversal.contains('/'));
        assert!(!traversal.contains('\\'));
        assert_eq!(traversal.len(), 64);

        // Special characters get hashed with SHA-256
        let special = sanitize_id("manga:vol1?foo=bar");
        assert!(!special.contains(':'));
        assert!(!special.contains('?'));
        assert!(!special.contains('='));
        assert_eq!(special.len(), 64);

        // Long string exceeding 64 characters gets hashed without truncation collision
        let long_id_1 = "a".repeat(150);
        let long_id_2 = format!("{}b", "a".repeat(149));
        let hash_id_1 = sanitize_id(&long_id_1);
        let hash_id_2 = sanitize_id(&long_id_2);
        assert_ne!(hash_id_1, hash_id_2);
        assert_eq!(hash_id_1.len(), 64);

        // Empty string
        let empty = sanitize_id("");
        assert!(empty.is_empty());
    }

    #[test]
    fn test_hash_key() {
        let hash1 = hash_key("path/to/image.png");
        let hash2 = hash_key("path/to/image.png");
        assert_eq!(hash1, hash2, "Identical inputs must produce identical hashes");

        let hash3 = hash_key("path/to/image2.png");
        assert_ne!(hash1, hash3, "Different inputs must produce different hashes");

        assert_eq!(hash1.len(), 64, "Hash key must be 64-hex-digit SHA-256 string");
        assert!(hash1.chars().all(|c| c.is_ascii_hexdigit()));
    }
}
