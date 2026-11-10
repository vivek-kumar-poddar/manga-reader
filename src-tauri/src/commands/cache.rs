use std::path::PathBuf;
use tauri::{AppHandle, Manager};

const MAX_THUMBNAIL_BYTES: usize = 10 * 1024 * 1024; // 10 MiB safety cap

/// Sanitizes thumbnail ID to prevent path traversal attacks.
/// Alphanumeric, hyphen, and underscore characters are kept as-is.
/// Any other character or oversized string is hex-encoded.
fn sanitize_id(id: &str) -> String {
    if !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
    {
        return id.to_string();
    }

    let mut hex = String::with_capacity(id.len() * 2);
    for b in id.as_bytes() {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    if hex.len() > 128 {
        hex.truncate(128);
    }
    hex
}

fn get_thumbnail_path(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
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

#[tauri::command]
pub async fn save_thumbnail(app: AppHandle, id: String, bytes: Vec<u8>) -> Result<(), String> {
    if bytes.len() > MAX_THUMBNAIL_BYTES {
        return Err(format!(
            "Thumbnail exceeds maximum size of {} bytes",
            MAX_THUMBNAIL_BYTES
        ));
    }

    let path = get_thumbnail_path(&app, &id)?;
    tokio::fs::write(&path, &bytes)
        .await
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
    Ok(())
}
