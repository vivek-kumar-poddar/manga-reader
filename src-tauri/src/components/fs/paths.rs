use super::roots::AllowedRoots;
use super::types::FsError;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

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
