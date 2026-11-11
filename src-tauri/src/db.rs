use rusqlite::{params, Connection, OptionalExtension, Result, Transaction};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::State;

pub struct DbState(pub Mutex<Connection>);

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageRecord {
    #[serde(default)]
    pub dimensions_pending: Option<bool>,
    pub name: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PositionRecord {
    pub page: u32,
    #[serde(default)]
    pub path: Option<String>,
    pub fraction: f64,
    #[serde(default)]
    pub manga_bookmark: Option<bool>,
    #[serde(default)]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterRecord {
    pub name: String,
    pub pages: Vec<PageRecord>,
    pub read: bool,
    #[serde(default)]
    pub position: Option<PositionRecord>,
    #[serde(default)]
    pub bookmarks: Option<Vec<PositionRecord>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MangaRecord {
    pub id: String,
    #[serde(default)]
    pub slug: Option<String>,
    pub title: String,
    pub chapters: Vec<ChapterRecord>,
    #[serde(default)]
    pub local_path: Option<String>,
    pub last_chapter: usize,
    pub added_at: f64,
    pub updated_at: f64,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryRecord {
    pub id: String,
    #[serde(default)]
    pub slug: Option<String>,
    pub title: String,
    #[serde(default)]
    pub local_path: Option<String>,
    pub last_chapter: usize,
    pub added_at: f64,
    pub updated_at: f64,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub sort: Option<String>,
    pub chapter_count: usize,
    pub chapters_read: usize,
    pub last_chapter_name: String,
    pub has_progress: bool,
    pub indexed_at: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkedIdsResponse {
    pub all_bookmarked_ids: Vec<String>,
    pub manga_bookmarked_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyBackupPayload {
    pub manga: Vec<MangaRecord>,
    pub settings: serde_json::Value,
}

pub fn init_db(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS manga (
            id TEXT PRIMARY KEY NOT NULL,
            title TEXT NOT NULL,
            slug TEXT NOT NULL,
            local_path TEXT,
            last_chapter INTEGER NOT NULL DEFAULT 0,
            added_at REAL NOT NULL,
            updated_at REAL NOT NULL,
            revision INTEGER NOT NULL DEFAULT 1,
            sort TEXT
        );

        CREATE TABLE IF NOT EXISTS chapters (
            manga_id TEXT NOT NULL,
            chapter_idx INTEGER NOT NULL,
            name TEXT NOT NULL,
            PRIMARY KEY (manga_id, chapter_idx),
            FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS pages (
            manga_id TEXT NOT NULL,
            chapter_idx INTEGER NOT NULL,
            idx INTEGER NOT NULL,
            name TEXT NOT NULL,
            path TEXT NOT NULL,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            modified REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (manga_id, chapter_idx, idx),
            FOREIGN KEY (manga_id, chapter_idx) REFERENCES chapters(manga_id, chapter_idx) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS progress (
            manga_id TEXT NOT NULL,
            chapter_name TEXT NOT NULL,
            read INTEGER NOT NULL DEFAULT 0,
            page INTEGER,
            path TEXT,
            fraction REAL,
            updated_at REAL NOT NULL DEFAULT 0,
            PRIMARY KEY (manga_id, chapter_name),
            FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS bookmarks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            manga_id TEXT NOT NULL,
            chapter_name TEXT NOT NULL,
            page INTEGER NOT NULL DEFAULT 0,
            path TEXT,
            fraction REAL NOT NULL DEFAULT 0,
            manga_bookmark INTEGER NOT NULL DEFAULT 0,
            timestamp REAL NOT NULL DEFAULT 0,
            FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY NOT NULL,
            value TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_chapters_manga ON chapters(manga_id);
        CREATE INDEX IF NOT EXISTS idx_pages_manga_chapter ON pages(manga_id, chapter_idx);
        CREATE INDEX IF NOT EXISTS idx_progress_manga ON progress(manga_id);
        CREATE INDEX IF NOT EXISTS idx_bookmarks_manga ON bookmarks(manga_id);
        CREATE INDEX IF NOT EXISTS idx_manga_updated ON manga(updated_at DESC);
        CREATE INDEX IF NOT EXISTS idx_manga_slug ON manga(slug);
        "#,
    )?;
    Ok(())
}

pub fn is_migrated(conn: &Connection) -> Result<bool> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = 'migrated' LIMIT 1")?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let val: String = row.get(0)?;
        Ok(val == "1" || val == "\"1\"" || val == "true")
    } else {
        Ok(false)
    }
}

pub fn set_migrated(conn: &mut Connection, migrated: bool) -> Result<()> {
    let val = if migrated { "1" } else { "0" };
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated', ?1)",
        params![val],
    )?;
    Ok(())
}

pub fn import_legacy_library_tx(conn: &mut Connection, payload: &LegacyBackupPayload) -> Result<()> {
    let tx = conn.transaction()?;

    for m in &payload.manga {
        insert_or_replace_manga(&tx, m)?;
    }

    let settings_json = serde_json::to_string(&payload.settings).unwrap_or_else(|_| "{}".to_string());
    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('global', ?1)",
        params![settings_json],
    )?;

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated', '1')",
        params![],
    )?;

    tx.commit()?;
    Ok(())
}

fn insert_or_replace_manga(tx: &Transaction<'_>, m: &MangaRecord) -> Result<()> {
    let slug = m.slug.clone().unwrap_or_else(|| m.title.to_lowercase().replace(' ', "-"));
    let revision = m.revision.unwrap_or(1);

    tx.execute(
        r#"
        INSERT OR REPLACE INTO manga (id, title, slug, local_path, last_chapter, added_at, updated_at, revision, sort)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        "#,
        params![
            m.id,
            m.title,
            slug,
            m.local_path,
            m.last_chapter as i64,
            m.added_at,
            m.updated_at,
            revision as i64,
            m.sort,
        ],
    )?;

    // Clear existing children for replacement
    tx.execute("DELETE FROM chapters WHERE manga_id = ?1", params![m.id])?;
    tx.execute("DELETE FROM progress WHERE manga_id = ?1", params![m.id])?;
    tx.execute("DELETE FROM bookmarks WHERE manga_id = ?1", params![m.id])?;

    for (c_idx, c) in m.chapters.iter().enumerate() {
        tx.execute(
            "INSERT INTO chapters (manga_id, chapter_idx, name) VALUES (?1, ?2, ?3)",
            params![m.id, c_idx as i64, c.name],
        )?;

        for (p_idx, p) in c.pages.iter().enumerate() {
            tx.execute(
                r#"
                INSERT INTO pages (manga_id, chapter_idx, idx, name, path, width, height, size, modified)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
                "#,
                params![
                    m.id,
                    c_idx as i64,
                    p_idx as i64,
                    p.name,
                    p.path,
                    p.width as i64,
                    p.height as i64,
                    p.size.unwrap_or(0) as i64,
                    p.modified.unwrap_or(0.0),
                ],
            )?;
        }

        // Insert progress if read or position exists
        let read_int = if c.read { 1 } else { 0 };
        let (pos_page, pos_path, pos_frac) = match &c.position {
            Some(pos) => (Some(pos.page as i64), pos.path.clone(), Some(pos.fraction)),
            None => (None, None, None),
        };

        if c.read || c.position.is_some() {
            tx.execute(
                r#"
                INSERT INTO progress (manga_id, chapter_name, read, page, path, fraction, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![m.id, c.name, read_int, pos_page, pos_path, pos_frac, m.updated_at],
            )?;
        }

        // Insert bookmarks
        if let Some(bookmarks) = &c.bookmarks {
            for bm in bookmarks {
                let is_manga_bm = if bm.manga_bookmark.unwrap_or(false) { 1 } else { 0 };
                tx.execute(
                    r#"
                    INSERT INTO bookmarks (manga_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
                    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                    "#,
                    params![
                        m.id,
                        c.name,
                        bm.page as i64,
                        bm.path,
                        bm.fraction,
                        is_manga_bm,
                        bm.timestamp.unwrap_or(0.0),
                    ],
                )?;
            }
        }
    }

    Ok(())
}

pub fn list_library(conn: &Connection) -> Result<Vec<SummaryRecord>> {
    let mut stmt = conn.prepare(
        r#"
        SELECT 
            m.id, m.slug, m.title, m.local_path, m.last_chapter, m.added_at, m.updated_at, m.revision, m.sort,
            (SELECT COUNT(*) FROM chapters c WHERE c.manga_id = m.id) AS chapter_count,
            (SELECT COUNT(*) FROM progress p WHERE p.manga_id = m.id AND p.read = 1) AS chapters_read,
            (SELECT c.name FROM chapters c WHERE c.manga_id = m.id AND c.chapter_idx = m.last_chapter LIMIT 1) AS last_chapter_name,
            (SELECT COUNT(*) FROM progress p WHERE p.manga_id = m.id AND (p.page IS NOT NULL OR p.read = 1)) AS progress_count
        FROM manga m
        ORDER BY m.updated_at DESC
        "#,
    )?;

    let rows = stmt.query_map([], |row| {
        let last_chapter_name: Option<String> = row.get(11)?;
        let progress_count: i64 = row.get(12)?;
        Ok(SummaryRecord {
            id: row.get(0)?,
            slug: row.get(1)?,
            title: row.get(2)?,
            local_path: row.get(3)?,
            last_chapter: row.get::<_, i64>(4)? as usize,
            added_at: row.get(5)?,
            updated_at: row.get(6)?,
            revision: Some(row.get::<_, i64>(7)? as u64),
            sort: row.get(8)?,
            chapter_count: row.get::<_, i64>(9)? as usize,
            chapters_read: row.get::<_, i64>(10)? as usize,
            last_chapter_name: last_chapter_name.unwrap_or_default(),
            has_progress: progress_count > 0,
            indexed_at: row.get(6)?,
        })
    })?;

    let mut summaries = Vec::new();
    for item in rows {
        summaries.push(item?);
    }
    Ok(summaries)
}

pub fn get_manga(conn: &Connection, id: &str) -> Result<Option<MangaRecord>> {
    let manga_row = conn
        .query_row(
            "SELECT id, slug, title, local_path, last_chapter, added_at, updated_at, revision, sort FROM manga WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, i64>(4)? as usize,
                    row.get::<_, f64>(5)?,
                    row.get::<_, f64>(6)?,
                    row.get::<_, i64>(7)? as u64,
                    row.get::<_, Option<String>>(8)?,
                ))
            },
        )
        .optional()?;

    let (m_id, slug, title, local_path, last_chapter, added_at, updated_at, revision, sort) = match manga_row {
        Some(tuple) => tuple,
        None => return Ok(None),
    };

    // Load progress indexed by chapter name
    let mut prog_map = std::collections::HashMap::new();
    {
        let mut p_stmt = conn.prepare("SELECT chapter_name, read, page, path, fraction FROM progress WHERE manga_id = ?1")?;
        let p_rows = p_stmt.query_map(params![id], |row| {
            let chapter_name: String = row.get(0)?;
            let read_int: i64 = row.get(1)?;
            let page: Option<i64> = row.get(2)?;
            let path: Option<String> = row.get(3)?;
            let fraction: Option<f64> = row.get(4)?;
            Ok((chapter_name, read_int == 1, page, path, fraction))
        })?;
        for r in p_rows {
            let (ch_name, read, page, path, fraction) = r?;
            prog_map.insert(ch_name, (read, page, path, fraction));
        }
    }

    // Load bookmarks indexed by chapter name
    let mut bm_map: std::collections::HashMap<String, Vec<PositionRecord>> = std::collections::HashMap::new();
    {
        let mut bm_stmt = conn.prepare(
            "SELECT chapter_name, page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 ORDER BY id ASC",
        )?;
        let bm_rows = bm_stmt.query_map(params![id], |row| {
            let chapter_name: String = row.get(0)?;
            let page: i64 = row.get(1)?;
            let path: Option<String> = row.get(2)?;
            let fraction: f64 = row.get(3)?;
            let manga_bm: i64 = row.get(4)?;
            let timestamp: f64 = row.get(5)?;
            Ok((
                chapter_name,
                PositionRecord {
                    page: page as u32,
                    path,
                    fraction,
                    manga_bookmark: Some(manga_bm == 1),
                    timestamp: Some(timestamp),
                },
            ))
        })?;
        for r in bm_rows {
            let (ch_name, pos) = r?;
            bm_map.entry(ch_name).or_default().push(pos);
        }
    }

    // Load chapters ordered by chapter_idx
    let mut chapters = Vec::new();
    let mut c_stmt = conn.prepare("SELECT chapter_idx, name FROM chapters WHERE manga_id = ?1 ORDER BY chapter_idx ASC")?;
    let c_rows = c_stmt.query_map(params![id], |row| {
        let c_idx: i64 = row.get(0)?;
        let c_name: String = row.get(1)?;
        Ok((c_idx, c_name))
    })?;

    for cr in c_rows {
        let (c_idx, c_name) = cr?;

        // Load pages for this chapter
        let mut pages = Vec::new();
        let mut p_stmt = conn.prepare(
            "SELECT name, path, width, height, size, modified FROM pages WHERE manga_id = ?1 AND chapter_idx = ?2 ORDER BY idx ASC",
        )?;
        let p_rows = p_stmt.query_map(params![id, c_idx], |row| {
            Ok(PageRecord {
                dimensions_pending: None,
                name: row.get(0)?,
                path: row.get(1)?,
                width: row.get::<_, i64>(2)? as u32,
                height: row.get::<_, i64>(3)? as u32,
                size: Some(row.get::<_, i64>(4)? as u64),
                modified: Some(row.get(5)?),
            })
        })?;
        for pr in p_rows {
            pages.push(pr?);
        }

        let (read, position) = match prog_map.get(&c_name) {
            Some(&(is_read, page_opt, ref path_opt, frac_opt)) => {
                let pos = page_opt.map(|p| PositionRecord {
                    page: p as u32,
                    path: path_opt.clone(),
                    fraction: frac_opt.unwrap_or(0.0),
                    manga_bookmark: None,
                    timestamp: None,
                });
                (is_read, pos)
            }
            None => (false, None),
        };

        let bookmarks = bm_map.remove(&c_name);

        chapters.push(ChapterRecord {
            name: c_name,
            pages,
            read,
            position,
            bookmarks,
        });
    }

    Ok(Some(MangaRecord {
        id: m_id,
        slug,
        title,
        chapters,
        local_path,
        last_chapter,
        added_at,
        updated_at,
        revision: Some(revision),
        sort,
    }))
}

pub fn save_manga(conn: &mut Connection, manga: &MangaRecord) -> Result<()> {
    let tx = conn.transaction()?;
    insert_or_replace_manga(&tx, manga)?;
    tx.commit()?;
    Ok(())
}

pub fn save_progress(
    conn: &mut Connection,
    manga_id: &str,
    chapter_index: usize,
    position: &PositionRecord,
    read: bool,
    bookmarks: Option<&[PositionRecord]>,
    update_last: bool,
    expected_revision: Option<u64>,
    expected_updated_at: Option<f64>,
) -> Result<String> {
    let tx = conn.transaction()?;

    let manga_info: Option<(f64, i64)> = tx
        .query_row(
            "SELECT updated_at, revision FROM manga WHERE id = ?1",
            params![manga_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let (cur_updated_at, cur_revision) = match manga_info {
        Some(t) => t,
        None => {
            tx.rollback()?;
            return Ok("missing".to_string());
        }
    };

    if let Some(exp_up) = expected_updated_at {
        if (exp_up - cur_updated_at).abs() > 0.001 {
            tx.rollback()?;
            return Ok("stale".to_string());
        }
    }
    if let Some(exp_rev) = expected_revision {
        if exp_rev != cur_revision as u64 {
            tx.rollback()?;
            return Ok("stale".to_string());
        }
    }

    let chapter_name: Option<String> = tx
        .query_row(
            "SELECT name FROM chapters WHERE manga_id = ?1 AND chapter_idx = ?2",
            params![manga_id, chapter_index as i64],
            |row| row.get(0),
        )
        .optional()?;

    let ch_name = match chapter_name {
        Some(n) => n,
        None => {
            tx.rollback()?;
            return Ok("missing".to_string());
        }
    };

    let existing_read: Option<i64> = tx
        .query_row(
            "SELECT read FROM progress WHERE manga_id = ?1 AND chapter_name = ?2",
            params![manga_id, ch_name],
            |row| row.get(0),
        )
        .optional()?;

    let is_read = if read || existing_read == Some(1) { 1 } else { 0 };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;

    tx.execute(
        r#"
        INSERT INTO progress (manga_id, chapter_name, read, page, path, fraction, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
        ON CONFLICT(manga_id, chapter_name) DO UPDATE SET
            read = excluded.read,
            page = excluded.page,
            path = excluded.path,
            fraction = excluded.fraction,
            updated_at = excluded.updated_at
        "#,
        params![
            manga_id,
            ch_name,
            is_read,
            position.page as i64,
            position.path,
            position.fraction,
            now,
        ],
    )?;

    if let Some(bms) = bookmarks {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2",
            params![manga_id, ch_name],
        )?;
        for bm in bms {
            let is_manga_bm = if bm.manga_bookmark.unwrap_or(false) { 1 } else { 0 };
            tx.execute(
                r#"
                INSERT INTO bookmarks (manga_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
                params![
                    manga_id,
                    ch_name,
                    bm.page as i64,
                    bm.path,
                    bm.fraction,
                    is_manga_bm,
                    bm.timestamp.unwrap_or(now),
                ],
            )?;
        }
    }

    if update_last {
        tx.execute(
            "UPDATE manga SET last_chapter = ?1, updated_at = ?2 WHERE id = ?3",
            params![chapter_index as i64, now, manga_id],
        )?;
    }

    tx.commit()?;
    Ok("saved".to_string())
}

pub fn add_bookmark(
    conn: &mut Connection,
    manga_id: &str,
    chapter_name: &str,
    position: &PositionRecord,
) -> Result<Vec<PositionRecord>> {
    let tx = conn.transaction()?;
    let is_manga_bm = if position.manga_bookmark.unwrap_or(false) { 1 } else { 0 };

    let exists: bool = if is_manga_bm == 1 {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND manga_bookmark = 1 LIMIT 1",
            params![manga_id, chapter_name],
            |_| Ok(true),
        )
        .unwrap_or(false)
    } else if let Some(path) = &position.path {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND path = ?3 LIMIT 1",
            params![manga_id, chapter_name, path],
            |_| Ok(true),
        )
        .unwrap_or(false)
    } else {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND page = ?3 LIMIT 1",
            params![manga_id, chapter_name, position.page as i64],
            |_| Ok(true),
        )
        .unwrap_or(false)
    };

    if !exists {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as f64;

        tx.execute(
            r#"
            INSERT INTO bookmarks (manga_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            "#,
            params![
                manga_id,
                chapter_name,
                position.page as i64,
                position.path,
                position.fraction,
                is_manga_bm,
                position.timestamp.unwrap_or(now),
            ],
        )?;
    }

    let mut result = Vec::new();
    {
        let mut stmt = tx.prepare(
            "SELECT page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![manga_id, chapter_name], |row| {
            let is_mb: i64 = row.get(3)?;
            Ok(PositionRecord {
                page: row.get::<_, i64>(0)? as u32,
                path: row.get(1)?,
                fraction: row.get(2)?,
                manga_bookmark: Some(is_mb == 1),
                timestamp: Some(row.get(4)?),
            })
        })?;

        for r in rows {
            result.push(r?);
        }
    }
    tx.commit()?;
    Ok(result)
}

pub fn remove_bookmark(
    conn: &mut Connection,
    manga_id: &str,
    chapter_name: &str,
    position: &PositionRecord,
) -> Result<Vec<PositionRecord>> {
    let tx = conn.transaction()?;
    let is_manga_bm = if position.manga_bookmark.unwrap_or(false) { 1 } else { 0 };

    if is_manga_bm == 1 {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND manga_bookmark = 1",
            params![manga_id, chapter_name],
        )?;
    } else if let Some(path) = &position.path {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND path = ?3",
            params![manga_id, chapter_name, path],
        )?;
    } else {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 AND page = ?3",
            params![manga_id, chapter_name, position.page as i64],
        )?;
    }

    let mut result = Vec::new();
    {
        let mut stmt = tx.prepare(
            "SELECT page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 AND chapter_name = ?2 ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![manga_id, chapter_name], |row| {
            let is_mb: i64 = row.get(3)?;
            Ok(PositionRecord {
                page: row.get::<_, i64>(0)? as u32,
                path: row.get(1)?,
                fraction: row.get(2)?,
                manga_bookmark: Some(is_mb == 1),
                timestamp: Some(row.get(4)?),
            })
        })?;

        for r in rows {
            result.push(r?);
        }
    }
    tx.commit()?;
    Ok(result)
}

pub fn get_bookmarked_ids(conn: &Connection) -> Result<BookmarkedIdsResponse> {
    let mut stmt = conn.prepare("SELECT DISTINCT manga_id, manga_bookmark FROM bookmarks")?;
    let rows = stmt.query_map([], |row| {
        let m_id: String = row.get(0)?;
        let is_mb: i64 = row.get(1)?;
        Ok((m_id, is_mb == 1))
    })?;

    let mut all_ids = std::collections::HashSet::new();
    let mut manga_ids = std::collections::HashSet::new();

    for r in rows {
        let (id, is_mb) = r?;
        all_ids.insert(id.clone());
        if is_mb {
            manga_ids.insert(id);
        }
    }

    Ok(BookmarkedIdsResponse {
        all_bookmarked_ids: all_ids.into_iter().collect(),
        manga_bookmarked_ids: manga_ids.into_iter().collect(),
    })
}

pub fn delete_manga(conn: &mut Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM manga WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_library(conn: &mut Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        DELETE FROM pages;
        DELETE FROM chapters;
        DELETE FROM progress;
        DELETE FROM bookmarks;
        DELETE FROM manga;
        "#,
    )?;
    Ok(())
}

pub fn reset_progress(conn: &mut Connection) -> Result<()> {
    let tx = conn.transaction()?;
    tx.execute("UPDATE progress SET read = 0, page = NULL, path = NULL, fraction = NULL", params![])?;
    tx.execute("UPDATE manga SET last_chapter = 0", params![])?;
    tx.commit()?;
    Ok(())
}

pub fn get_settings(conn: &Connection, key: &str) -> Result<Option<serde_json::Value>> {
    let val: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()?;

    match val {
        Some(s) => {
            let json = serde_json::from_str(&s).unwrap_or(serde_json::Value::Null);
            Ok(Some(json))
        }
        None => Ok(None),
    }
}

pub fn save_settings(conn: &mut Connection, key: &str, val: &serde_json::Value) -> Result<()> {
    let s = serde_json::to_string(val).unwrap_or_else(|_| "{}".to_string());
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, s],
    )?;
    Ok(())
}

// ==============================================================================
// Tauri Command Handlers
// ==============================================================================

#[tauri::command]
pub fn is_library_migrated(state: State<'_, DbState>) -> std::result::Result<bool, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    is_migrated(&conn).map_err(|e| format!("Failed to check migration status: {e}"))
}

#[tauri::command]
pub fn import_legacy_library(
    state: State<'_, DbState>,
    payload: LegacyBackupPayload,
) -> std::result::Result<bool, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    import_legacy_library_tx(&mut conn, &payload)
        .map(|_| true)
        .map_err(|e| format!("Failed to import legacy library: {e}"))
}

#[tauri::command]
pub fn sqlite_list_library(state: State<'_, DbState>) -> std::result::Result<Vec<SummaryRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    list_library(&conn).map_err(|e| format!("Failed to list library from SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_get_manga(
    state: State<'_, DbState>,
    id: String,
) -> std::result::Result<Option<MangaRecord>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_manga(&conn, &id).map_err(|e| format!("Failed to get manga from SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_save_manga(
    state: State<'_, DbState>,
    manga: MangaRecord,
) -> std::result::Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    save_manga(&mut conn, &manga).map_err(|e| format!("Failed to save manga to SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_save_progress(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_index: usize,
    position: PositionRecord,
    read: bool,
    bookmarks: Option<Vec<PositionRecord>>,
    update_last: bool,
    expected_revision: Option<u64>,
    expected_updated_at: Option<f64>,
) -> std::result::Result<String, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    save_progress(
        &mut conn,
        &manga_id,
        chapter_index,
        &position,
        read,
        bookmarks.as_deref(),
        update_last,
        expected_revision,
        expected_updated_at,
    )
    .map_err(|e| format!("Failed to save progress to SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_add_bookmark(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_name: String,
    position: PositionRecord,
) -> std::result::Result<Vec<PositionRecord>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    add_bookmark(&mut conn, &manga_id, &chapter_name, &position)
        .map_err(|e| format!("Failed to add bookmark in SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_remove_bookmark(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_name: String,
    position: PositionRecord,
) -> std::result::Result<Vec<PositionRecord>, String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    remove_bookmark(&mut conn, &manga_id, &chapter_name, &position)
        .map_err(|e| format!("Failed to remove bookmark in SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_get_bookmarked_manga_ids(
    state: State<'_, DbState>,
) -> std::result::Result<BookmarkedIdsResponse, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_bookmarked_ids(&conn).map_err(|e| format!("Failed to get bookmarked IDs from SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_delete_manga(state: State<'_, DbState>, id: String) -> std::result::Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    delete_manga(&mut conn, &id).map_err(|e| format!("Failed to delete manga from SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_clear_library(state: State<'_, DbState>) -> std::result::Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    clear_library(&mut conn).map_err(|e| format!("Failed to clear library in SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_reset_progress(state: State<'_, DbState>) -> std::result::Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    reset_progress(&mut conn).map_err(|e| format!("Failed to reset progress in SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_get_settings(
    state: State<'_, DbState>,
) -> std::result::Result<Option<serde_json::Value>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    get_settings(&conn, "global").map_err(|e| format!("Failed to get settings from SQLite: {e}"))
}

#[tauri::command]
pub fn sqlite_save_settings(
    state: State<'_, DbState>,
    settings: serde_json::Value,
) -> std::result::Result<(), String> {
    let mut conn = state.0.lock().map_err(|e| e.to_string())?;
    save_settings(&mut conn, "global", &settings)
        .map_err(|e| format!("Failed to save settings to SQLite: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn create_test_conn() -> Connection {
        let conn = Connection::open_in_memory().expect("Must open memory db");
        init_db(&conn).expect("Must init schema");
        conn
    }

    #[test]
    fn test_schema_init_and_migration_flag() {
        let mut conn = create_test_conn();
        assert!(!is_migrated(&conn).unwrap());

        set_migrated(&mut conn, true).unwrap();
        assert!(is_migrated(&conn).unwrap());

        set_migrated(&mut conn, false).unwrap();
        assert!(!is_migrated(&conn).unwrap());
    }

    #[test]
    fn test_save_and_get_manga() {
        let mut conn = create_test_conn();
        let manga = MangaRecord {
            id: "manga-1".into(),
            slug: Some("manga-one".into()),
            title: "Manga One".into(),
            local_path: Some("C:\\Manga\\One".into()),
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: Some("natural".into()),
            chapters: vec![
                ChapterRecord {
                    name: "Chapter 1".into(),
                    pages: vec![
                        PageRecord {
                            dimensions_pending: None,
                            name: "01.png".into(),
                            path: "Chapter 1/01.png".into(),
                            width: 800,
                            height: 1200,
                            size: Some(1024),
                            modified: Some(1500.0),
                        },
                    ],
                    read: true,
                    position: Some(PositionRecord {
                        page: 1,
                        path: Some("Chapter 1/01.png".into()),
                        fraction: 0.5,
                        manga_bookmark: None,
                        timestamp: None,
                    }),
                    bookmarks: Some(vec![
                        PositionRecord {
                            page: 1,
                            path: Some("Chapter 1/01.png".into()),
                            fraction: 0.5,
                            manga_bookmark: Some(false),
                            timestamp: Some(1234.0),
                        },
                    ]),
                },
            ],
        };

        save_manga(&mut conn, &manga).unwrap();

        let loaded = get_manga(&conn, "manga-1").unwrap().expect("Must load manga");
        assert_eq!(loaded.id, "manga-1");
        assert_eq!(loaded.title, "Manga One");
        assert_eq!(loaded.chapters.len(), 1);
        assert_eq!(loaded.chapters[0].name, "Chapter 1");
        assert_eq!(loaded.chapters[0].pages.len(), 1);
        assert_eq!(loaded.chapters[0].pages[0].width, 800);
        assert!(loaded.chapters[0].read);
        assert!(loaded.chapters[0].position.is_some());
        assert_eq!(loaded.chapters[0].bookmarks.as_ref().unwrap().len(), 1);

        let list = list_library(&conn).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Manga One");
        assert_eq!(list[0].chapter_count, 1);
        assert_eq!(list[0].chapters_read, 1);
        assert!(list[0].has_progress);
    }

    #[test]
    fn test_save_progress_and_stale_detection() {
        let mut conn = create_test_conn();
        let manga = MangaRecord {
            id: "manga-prog".into(),
            slug: Some("manga-prog".into()),
            title: "Manga Progress".into(),
            local_path: None,
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(2),
            sort: None,
            chapters: vec![ChapterRecord {
                name: "Ch 1".into(),
                pages: vec![],
                read: false,
                position: None,
                bookmarks: None,
            }],
        };
        save_manga(&mut conn, &manga).unwrap();

        let pos = PositionRecord {
            page: 5,
            path: None,
            fraction: 0.25,
            manga_bookmark: None,
            timestamp: None,
        };

        // Stale revision rejection
        let stale_result = save_progress(
            &mut conn,
            "manga-prog",
            0,
            &pos,
            true,
            None,
            true,
            Some(1), // Expected revision 1 != current 2
            None,
        )
        .unwrap();
        assert_eq!(stale_result, "stale");

        // Successful save
        let ok_result = save_progress(
            &mut conn,
            "manga-prog",
            0,
            &pos,
            true,
            None,
            true,
            Some(2),
            Some(2000.0),
        )
        .unwrap();
        assert_eq!(ok_result, "saved");

        let loaded = get_manga(&conn, "manga-prog").unwrap().unwrap();
        assert!(loaded.chapters[0].read);
        assert_eq!(loaded.chapters[0].position.as_ref().unwrap().page, 5);
    }

    #[test]
    fn test_bookmarks_add_remove() {
        let mut conn = create_test_conn();
        let manga = MangaRecord {
            id: "m-bm".into(),
            slug: None,
            title: "Manga BM".into(),
            local_path: None,
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: None,
            chapters: vec![ChapterRecord {
                name: "Ch 1".into(),
                pages: vec![],
                read: false,
                position: None,
                bookmarks: None,
            }],
        };
        save_manga(&mut conn, &manga).unwrap();

        let bm = PositionRecord {
            page: 3,
            path: Some("page_3.png".into()),
            fraction: 0.8,
            manga_bookmark: Some(false),
            timestamp: Some(100.0),
        };

        let bms = add_bookmark(&mut conn, "m-bm", "Ch 1", &bm).unwrap();
        assert_eq!(bms.len(), 1);
        assert_eq!(bms[0].page, 3);

        let ids = get_bookmarked_ids(&conn).unwrap();
        assert_eq!(ids.all_bookmarked_ids, vec!["m-bm"]);
        assert!(ids.manga_bookmarked_ids.is_empty());

        let after_remove = remove_bookmark(&mut conn, "m-bm", "Ch 1", &bm).unwrap();
        assert_eq!(after_remove.len(), 0);
    }

    #[test]
    fn test_import_legacy_library() {
        let mut conn = create_test_conn();
        let payload = LegacyBackupPayload {
            manga: vec![MangaRecord {
                id: "legacy-1".into(),
                slug: Some("legacy-1".into()),
                title: "Legacy Title".into(),
                local_path: None,
                last_chapter: 0,
                added_at: 1000.0,
                updated_at: 1000.0,
                revision: Some(1),
                sort: None,
                chapters: vec![ChapterRecord {
                    name: "Chapter 1".into(),
                    pages: vec![],
                    read: true,
                    position: None,
                    bookmarks: None,
                }],
            }],
            settings: serde_json::json!({ "theme": "dark", "mode": "continuous" }),
        };

        assert!(!is_migrated(&conn).unwrap());
        import_legacy_library_tx(&mut conn, &payload).unwrap();
        assert!(is_migrated(&conn).unwrap());

        let manga = get_manga(&conn, "legacy-1").unwrap().unwrap();
        assert_eq!(manga.title, "Legacy Title");

        let settings = get_settings(&conn, "global").unwrap().unwrap();
        assert_eq!(settings["theme"], "dark");
    }
}
