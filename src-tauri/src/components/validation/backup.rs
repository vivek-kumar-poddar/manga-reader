use std::collections::HashSet;

use super::types::{BackupPayload, LIMIT_BACKUP_BYTES, LIMIT_BACKUP_PAGES, LIMIT_TITLES};
use super::validators::validate_manga;

pub fn validate_backup_json(json_str: &str) -> Result<BackupPayload, String> {
    if json_str.len() > LIMIT_BACKUP_BYTES {
        return Err(format!(
            "Backup size (bytes) exceeds the limit of {LIMIT_BACKUP_BYTES}. Use a smaller selection."
        ));
    }

    let mut payload: BackupPayload = serde_json::from_str(json_str)
        .map_err(|e| format!("Invalid backup JSON structure: {e}"))?;

    if payload.version != 1 && payload.version != 2 {
        return Err("Invalid backup version. Supported versions: 1, 2.".to_string());
    }

    if payload.manga.len() > LIMIT_TITLES {
        return Err(format!(
            "Backup titles exceeds the limit of {LIMIT_TITLES}. Use a smaller selection."
        ));
    }

    let mut seen_ids = HashSet::new();
    let mut total_backup_pages = 0;

    for manga in payload.manga.iter_mut() {
        manga.local_path = None;
        manga.handle = None;
        manga.cover = None;
        let pages = validate_manga(manga, &mut seen_ids)?;
        total_backup_pages += pages;
        if total_backup_pages > LIMIT_BACKUP_PAGES {
            return Err(format!(
                "Backup pages exceeds the limit of {LIMIT_BACKUP_PAGES}. Use a smaller selection."
            ));
        }
    }

    Ok(payload)
}
