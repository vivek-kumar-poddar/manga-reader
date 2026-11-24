use super::error::{DbError, DbResult};
use super::models::MangaRecord;
use super::queries::{get_manga, get_settings, list_library};
use super::schema::insert_or_replace_manga;
use rusqlite::Connection;

pub fn export_backup_json(conn: &Connection) -> DbResult<String> {
    let summaries = list_library(conn)?;
    let mut manga_list = Vec::with_capacity(summaries.len());
    for s in summaries {
        if let Some(m) = get_manga(conn, &s.id)? {
            manga_list.push(m);
        }
    }

    let settings = get_settings(conn, "global")?.unwrap_or_else(|| {
        serde_json::json!({
            "theme": "system",
            "mode": "continuous",
            "layout": "max",
            "maxWidth": 920,
            "seconds": 3.0,
            "advance": true,
            "reduced": false,
            "lowQuality": false,
            "customSeconds": false,
            "autoHideBars": true,
            "resumeDelay": 1.8,
            "direction": "ltr",
            "spread": false,
            "singleCover": true,
            "endAction": "next",
            "fontSizeTitle": 15,
            "fontSizeUi": 15,
            "fontSizeButton": 15,
            "confirmDelete": false
        })
    });

    let payload = serde_json::json!({
        "version": 2,
        "manga": manga_list,
        "settings": settings,
    });

    serde_json::to_string(&payload).map_err(DbError::from)
}

pub fn restore_backup_tx(
    conn: &mut Connection,
    payload: &crate::validation::BackupPayload,
) -> DbResult<serde_json::Value> {
    let tx = conn.transaction()?;

    // Load existing local_path and slug for preservation
    let mut existing_info: std::collections::HashMap<String, (Option<String>, String)> =
        std::collections::HashMap::new();
    {
        let mut stmt = tx.prepare("SELECT id, local_path, slug FROM manga")?;
        let rows = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?;
        for (id, local_path, slug) in rows.flatten() {
            existing_info.insert(id, (local_path, slug));
        }
    }

    for valid_m in &payload.manga {
        let mut m_rec = MangaRecord::from(valid_m.clone());
        if let Some((existing_path, existing_slug)) = existing_info.get(&m_rec.id) {
            if m_rec.local_path.is_none() && existing_path.is_some() {
                m_rec.local_path = existing_path.clone();
            }
            if m_rec.slug.is_none() {
                m_rec.slug = Some(existing_slug.clone());
            }
        }
        insert_or_replace_manga(&tx, &m_rec)?;
    }

    let norm_settings = crate::validation::normalize_settings(&payload.settings);
    let settings_str = serde_json::to_string(&norm_settings)?;
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('global', ?1)",
        rusqlite::params![settings_str],
    )?;

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated', '1')",
        rusqlite::params![],
    )?;

    tx.commit()?;

    Ok(norm_settings)
}
