use rusqlite::{Connection, OptionalExtension, Transaction, params};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use tauri::State;

#[derive(Debug, thiserror::Error, Serialize, Deserialize, PartialEq, Clone)]
#[serde(tag = "code", content = "message")]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(String),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Lock error: {0}")]
    Lock(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Stale revision conflict: {0}")]
    Conflict(String),

    #[error("Task execution error: {0}")]
    Task(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

impl From<rusqlite::Error> for DbError {
    fn from(err: rusqlite::Error) -> Self {
        DbError::Sqlite(err.to_string())
    }
}

impl From<serde_json::Error> for DbError {
    fn from(err: serde_json::Error) -> Self {
        DbError::Serialization(err.to_string())
    }
}

pub type DbResult<T> = std::result::Result<T, DbError>;

#[derive(Clone)]
pub struct DbState {
    pub reader: Arc<Mutex<Connection>>,
    pub writer: Arc<Mutex<Connection>>,
}

impl DbState {
    pub fn new(reader: Connection, writer: Connection) -> Self {
        Self {
            reader: Arc::new(Mutex::new(reader)),
            writer: Arc::new(Mutex::new(writer)),
        }
    }

    pub async fn read<F, R>(&self, f: F) -> DbResult<R>
    where
        F: FnOnce(&Connection) -> DbResult<R> + Send + 'static,
        R: Send + 'static,
    {
        let reader = Arc::clone(&self.reader);
        tauri::async_runtime::spawn_blocking(move || {
            let conn = reader.lock().map_err(|e| DbError::Lock(e.to_string()))?;
            f(&conn)
        })
        .await
        .map_err(|e| DbError::Task(format!("Database read task failed: {e}")))?
    }

    pub async fn write<F, R>(&self, f: F) -> DbResult<R>
    where
        F: FnOnce(&mut Connection) -> DbResult<R> + Send + 'static,
        R: Send + 'static,
    {
        let writer = Arc::clone(&self.writer);
        tauri::async_runtime::spawn_blocking(move || {
            let mut conn = writer.lock().map_err(|e| DbError::Lock(e.to_string()))?;
            f(&mut conn)
        })
        .await
        .map_err(|e| DbError::Task(format!("Database write task failed: {e}")))?
    }

    pub async fn get_local_path(&self, manga_id: &str) -> Option<String> {
        let id = manga_id.to_string();
        self.read(move |conn| {
            let mut stmt = conn
                .prepare_cached("SELECT local_path FROM manga WHERE id = ?1")
                .map_err(|e| DbError::Sqlite(e.to_string()))?;
            let res = stmt
                .query_row([&id], |row| row.get::<_, Option<String>>(0))
                .optional()
                .map_err(|e| DbError::Sqlite(e.to_string()))?
                .flatten();
            Ok(res)
        })
        .await
        .ok()
        .flatten()
    }

    pub fn get_local_path_sync(&self, manga_id: &str) -> Option<String> {
        let conn = self.reader.lock().ok()?;
        let mut stmt = conn
            .prepare_cached("SELECT local_path FROM manga WHERE id = ?1")
            .ok()?;
        let res: Option<String> = stmt
            .query_row([manga_id], |row| row.get(0))
            .optional()
            .ok()
            .flatten();
        res
    }

    pub fn get_previous_manga_for_indexing_sync(
        &self,
        target_id: Option<&str>,
        local_path: Option<&str>,
    ) -> Option<MangaRecord> {
        let conn = self.reader.lock().ok()?;
        let id_found: Option<String> = if let Some(tid) = target_id {
            let mut stmt = conn
                .prepare_cached("SELECT id FROM manga WHERE id = ?1")
                .ok()?;
            stmt.query_row([tid], |row| row.get(0))
                .optional()
                .ok()
                .flatten()
        } else if let Some(lp) = local_path {
            let mut stmt = conn
                .prepare_cached("SELECT id FROM manga WHERE local_path = ?1")
                .ok()?;
            stmt.query_row([lp], |row| row.get(0))
                .optional()
                .ok()
                .flatten()
        } else {
            None
        };

        if let Some(id) = id_found {
            get_manga(&conn, &id).ok().flatten()
        } else {
            None
        }
    }

    pub fn save_manga_sync(&self, manga: &MangaRecord) -> DbResult<()> {
        let mut conn = self
            .writer
            .lock()
            .map_err(|e| DbError::Lock(e.to_string()))?;
        save_manga(&mut conn, manga)
    }
    
    pub fn allocate_unique_slug_sync(&self, base_slug: &str, manga_id: &str) -> String {
        let reserved = ["read", "assets", "api"];
        let used: std::collections::HashSet<String> = self
            .reader
            .lock()
            .ok()
            .and_then(|conn| {
                let mut stmt = conn
                    .prepare_cached("SELECT slug FROM manga WHERE id != ?1")
                    .ok()?;
                let rows = stmt
                    .query_map([manga_id], |row| row.get::<_, String>(0))
                    .ok()?;
                Some(rows.flatten().collect())
            })
            .unwrap_or_default();

        for attempt in 0..=(used.len() + reserved.len()) {
            let candidate = if attempt == 0 {
                base_slug.to_string()
            } else {
                format!("{}-{}", base_slug, attempt + 1)
            };
            if !used.contains(&candidate) && !reserved.contains(&candidate.as_str()) {
                return candidate;
            }
        }
        format!("{}-{}", base_slug, uuid::Uuid::new_v4())
    }
}

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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub pages: Vec<PageRecord>,
    pub read: bool,
    #[serde(default)]
    pub position: Option<PositionRecord>,
    #[serde(default)]
    pub bookmarks: Option<Vec<PositionRecord>>,
}

/// Generates a stable chapter ID resilient to renames and reordering.
pub fn derive_chapter_id(manga_id: &str, chapter: &ChapterRecord, chapter_idx: usize) -> String {
    if let Some(ref id) = chapter.id {
        let trimmed = id.trim();
        if !trimmed.is_empty() {
            return trimmed.to_string();
        }
    }
    if let Some(first_page) = chapter.pages.first() {
        if let Some(parent) = std::path::Path::new(&first_page.path).parent() {
            let parent_str = parent.to_string_lossy().replace('\\', "/");
            if !parent_str.is_empty() && parent_str != "." {
                return format!("{}:{}", manga_id, parent_str);
            }
        }
        return format!("{}:p:{}", manga_id, first_page.path);
    }
    let slug: String = chapter
        .name
        .chars()
        .map(|c| {
            if c.is_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("{}:{}:{}", manga_id, chapter_idx, slug.trim_matches('-'))
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

impl From<crate::validation::ValidatedPage> for PageRecord {
    fn from(p: crate::validation::ValidatedPage) -> Self {
        Self {
            name: p.name,
            path: p.path,
            width: p.width,
            height: p.height,
            size: p.size,
            modified: p.modified,
            dimensions_pending: p.dimensions_pending,
        }
    }
}

impl From<crate::validation::ValidatedPosition> for PositionRecord {
    fn from(p: crate::validation::ValidatedPosition) -> Self {
        Self {
            page: p.page,
            path: p.path,
            fraction: p.fraction,
            manga_bookmark: p.manga_bookmark,
            timestamp: p.timestamp,
        }
    }
}

impl From<crate::validation::ValidatedChapter> for ChapterRecord {
    fn from(c: crate::validation::ValidatedChapter) -> Self {
        Self {
            id: c.id,
            name: c.name,
            pages: c.pages.into_iter().map(PageRecord::from).collect(),
            read: c.read.unwrap_or(false),
            position: c.position.map(PositionRecord::from),
            bookmarks: c
                .bookmarks
                .map(|bms| bms.into_iter().map(PositionRecord::from).collect()),
        }
    }
}

impl From<crate::validation::ValidatedManga> for MangaRecord {
    fn from(m: crate::validation::ValidatedManga) -> Self {
        Self {
            id: m.id,
            slug: m.slug,
            title: m.title,
            chapters: m.chapters.into_iter().map(ChapterRecord::from).collect(),
            local_path: m.local_path,
            last_chapter: m.last_chapter.unwrap_or(0),
            added_at: m.added_at.unwrap_or(0.0),
            updated_at: m.updated_at.unwrap_or(0.0),
            revision: m.revision,
            sort: m.sort,
        }
    }
}

pub fn init_db(conn: &Connection) -> DbResult<()> {
    conn.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        "#,
    )?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))?;

    run_migrations(conn)?;

    Ok(())
}

pub fn run_migrations(conn: &Connection) -> DbResult<()> {
    let current_version: u32 = conn
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| DbError::Migration(format!("Failed to read user_version: {e}")))?;

    if current_version < 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            r#"
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
                chapter_id TEXT NOT NULL,
                chapter_idx INTEGER NOT NULL,
                name TEXT NOT NULL,
                PRIMARY KEY (manga_id, chapter_id),
                FOREIGN KEY (manga_id) REFERENCES manga(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS pages (
                manga_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                chapter_idx INTEGER NOT NULL,
                idx INTEGER NOT NULL,
                name TEXT NOT NULL,
                path TEXT NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                size INTEGER NOT NULL DEFAULT 0,
                modified REAL NOT NULL DEFAULT 0,
                dimensions_pending INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (manga_id, chapter_id, idx),
                FOREIGN KEY (manga_id, chapter_id) REFERENCES chapters(manga_id, chapter_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS progress (
                manga_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                chapter_name TEXT NOT NULL,
                read INTEGER NOT NULL DEFAULT 0,
                page INTEGER,
                path TEXT,
                fraction REAL,
                updated_at REAL NOT NULL DEFAULT 0,
                PRIMARY KEY (manga_id, chapter_id),
                FOREIGN KEY (manga_id, chapter_id) REFERENCES chapters(manga_id, chapter_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS bookmarks (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                manga_id TEXT NOT NULL,
                chapter_id TEXT NOT NULL,
                chapter_name TEXT NOT NULL,
                page INTEGER NOT NULL DEFAULT 0,
                path TEXT,
                fraction REAL NOT NULL DEFAULT 0,
                manga_bookmark INTEGER NOT NULL DEFAULT 0,
                timestamp REAL NOT NULL DEFAULT 0,
                FOREIGN KEY (manga_id, chapter_id) REFERENCES chapters(manga_id, chapter_id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_chapters_manga ON chapters(manga_id);
            CREATE INDEX IF NOT EXISTS idx_chapters_manga_idx ON chapters(manga_id, chapter_idx);
            CREATE INDEX IF NOT EXISTS idx_pages_manga_chapter ON pages(manga_id, chapter_id);
            CREATE INDEX IF NOT EXISTS idx_progress_manga ON progress(manga_id);
            CREATE INDEX IF NOT EXISTS idx_bookmarks_manga ON bookmarks(manga_id, chapter_id);
            CREATE INDEX IF NOT EXISTS idx_manga_updated ON manga(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_manga_slug ON manga(slug);

            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|e| DbError::Migration(format!("Migration to v2 failed: {e}")))?;

        tx.commit()?;
    } else if current_version == 1 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(
            r#"
            ALTER TABLE chapters ADD COLUMN chapter_id TEXT;
            UPDATE chapters SET chapter_id = name WHERE chapter_id IS NULL OR chapter_id = '';

            ALTER TABLE pages ADD COLUMN chapter_id TEXT;
            ALTER TABLE pages ADD COLUMN dimensions_pending INTEGER NOT NULL DEFAULT 0;
            UPDATE pages SET chapter_id = (
                SELECT c.chapter_id FROM chapters c
                WHERE c.manga_id = pages.manga_id AND c.chapter_idx = pages.chapter_idx
                LIMIT 1
            ) WHERE chapter_id IS NULL;
            UPDATE pages SET chapter_id = 'ch_' || chapter_idx WHERE chapter_id IS NULL;

            ALTER TABLE progress ADD COLUMN chapter_id TEXT;
            UPDATE progress SET chapter_id = chapter_name WHERE chapter_id IS NULL;

            ALTER TABLE bookmarks ADD COLUMN chapter_id TEXT;
            UPDATE bookmarks SET chapter_id = chapter_name WHERE chapter_id IS NULL;

            CREATE INDEX IF NOT EXISTS idx_chapters_manga_idx ON chapters(manga_id, chapter_idx);
            CREATE INDEX IF NOT EXISTS idx_pages_manga_chapter ON pages(manga_id, chapter_id);

            PRAGMA user_version = 2;
            "#,
        )
        .map_err(|e| DbError::Migration(format!("Migration from v1 to v2 failed: {e}")))?;

        tx.commit()?;
    }

    Ok(())
}

pub fn is_migrated(conn: &Connection) -> DbResult<bool> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = 'migrated' LIMIT 1")?;
    let mut rows = stmt.query([])?;
    if let Some(row) = rows.next()? {
        let val: String = row.get(0)?;
        Ok(val == "1" || val == "\"1\"" || val == "true")
    } else {
        Ok(false)
    }
}

pub fn set_migrated(conn: &mut Connection, migrated: bool) -> DbResult<()> {
    let val = if migrated { "1" } else { "0" };
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated', ?1)",
        params![val],
    )?;
    Ok(())
}

pub fn import_legacy_library_tx(
    conn: &mut Connection,
    payload: &LegacyBackupPayload,
) -> DbResult<()> {
    let tx = conn.transaction()?;

    for m in &payload.manga {
        insert_or_replace_manga(&tx, m)?;
    }

    let settings_json = serde_json::to_string(&payload.settings)?;
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

type ExistingPageTuple = (i64, String, String, i64, i64, i64, f64, i64);

fn insert_or_replace_manga(tx: &Transaction<'_>, m: &MangaRecord) -> DbResult<()> {
    let slug = m
        .slug
        .clone()
        .unwrap_or_else(|| m.title.to_lowercase().replace(' ', "-"));
    let revision = m.revision.unwrap_or(1);

    // 1. Upsert manga record
    tx.execute(
        r#"
        INSERT INTO manga (id, title, slug, local_path, last_chapter, added_at, updated_at, revision, sort)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
        ON CONFLICT(id) DO UPDATE SET
            title = excluded.title,
            slug = excluded.slug,
            local_path = COALESCE(excluded.local_path, manga.local_path),
            last_chapter = excluded.last_chapter,
            added_at = excluded.added_at,
            updated_at = excluded.updated_at,
            revision = excluded.revision,
            sort = excluded.sort
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

    // 2. Diff and upsert chapters and pages using stable chapter_id
    let mut current_chapter_ids = std::collections::HashSet::new();
    {
        let mut upsert_chapter_stmt = tx.prepare(
            r#"
            INSERT INTO chapters (manga_id, chapter_id, chapter_idx, name)
            VALUES (?1, ?2, ?3, ?4)
            ON CONFLICT(manga_id, chapter_id) DO UPDATE SET
                chapter_idx = excluded.chapter_idx,
                name = excluded.name
            "#,
        )?;

        let mut select_pages_stmt = tx.prepare(
            r#"
            SELECT idx, name, path, width, height, size, modified, dimensions_pending
            FROM pages
            WHERE manga_id = ?1 AND chapter_id = ?2
            ORDER BY idx ASC
            "#,
        )?;

        let mut delete_pages_stmt =
            tx.prepare("DELETE FROM pages WHERE manga_id = ?1 AND chapter_id = ?2")?;

        let mut insert_page_stmt = tx.prepare(
            r#"
            INSERT INTO pages (manga_id, chapter_id, chapter_idx, idx, name, path, width, height, size, modified, dimensions_pending)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
            "#,
        )?;

        for (c_idx, c) in m.chapters.iter().enumerate() {
            let ch_id = derive_chapter_id(&m.id, c, c_idx);
            current_chapter_ids.insert(ch_id.clone());

            upsert_chapter_stmt.execute(params![m.id, ch_id, c_idx as i64, c.name])?;

            let existing_pages: Vec<ExistingPageTuple> = select_pages_stmt
                .query_map(params![m.id, ch_id], |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get::<_, Option<i64>>(7)?.unwrap_or(0),
                    ))
                })?
                .collect::<std::result::Result<Vec<_>, _>>()?;

            let pages_identical = existing_pages.len() == c.pages.len()
                && existing_pages.iter().enumerate().all(|(idx, existing)| {
                    let p = &c.pages[idx];
                    let dim_pending = if p.dimensions_pending.unwrap_or(false) {
                        1
                    } else {
                        0
                    };
                    existing.0 == idx as i64
                        && existing.1 == p.name
                        && existing.2 == p.path
                        && existing.3 == p.width as i64
                        && existing.4 == p.height as i64
                        && existing.5 == p.size.unwrap_or(0) as i64
                        && (existing.6 - p.modified.unwrap_or(0.0)).abs() < 0.001
                        && existing.7 == dim_pending
                });

            if !pages_identical {
                if !existing_pages.is_empty() {
                    delete_pages_stmt.execute(params![m.id, ch_id])?;
                }
                for (p_idx, p) in c.pages.iter().enumerate() {
                    let dim_pending = if p.dimensions_pending.unwrap_or(false) {
                        1
                    } else {
                        0
                    };
                    insert_page_stmt.execute(params![
                        m.id,
                        ch_id,
                        c_idx as i64,
                        p_idx as i64,
                        p.name,
                        p.path,
                        p.width as i64,
                        p.height as i64,
                        p.size.unwrap_or(0) as i64,
                        p.modified.unwrap_or(0.0),
                        dim_pending,
                    ])?;
                }
            } else {
                tx.execute(
                    "UPDATE pages SET chapter_idx = ?1 WHERE manga_id = ?2 AND chapter_id = ?3 AND chapter_idx != ?1",
                    params![c_idx as i64, m.id, ch_id],
                )?;
            }
        }
    }

    // Remove obsolete chapters by chapter_id (cascades to pages, progress, bookmarks)
    {
        let existing_ch_ids: Vec<String> = {
            let mut stmt = tx.prepare("SELECT chapter_id FROM chapters WHERE manga_id = ?1")?;
            let rows = stmt.query_map(params![m.id], |row| row.get(0))?;
            rows.collect::<std::result::Result<Vec<_>, _>>()?
        };
        let mut del_ch_stmt =
            tx.prepare("DELETE FROM chapters WHERE manga_id = ?1 AND chapter_id = ?2")?;
        for old_ch_id in existing_ch_ids {
            if !current_chapter_ids.contains(&old_ch_id) {
                del_ch_stmt.execute(params![m.id, old_ch_id])?;
            }
        }
    }
    // 3. Diff and upsert progress keyed by stable chapter_id
    type ProgressSnapshot = (bool, Option<i64>, Option<String>, Option<f64>);
    {
        let existing_progress: std::collections::HashMap<String, ProgressSnapshot> = {
            let mut p_stmt = tx.prepare(
                "SELECT chapter_id, read, page, path, fraction FROM progress WHERE manga_id = ?1",
            )?;
            let p_rows = p_stmt.query_map(params![m.id], |row| {
                let ch_id: String = row.get(0)?;
                let is_read: i64 = row.get(1)?;
                let page: Option<i64> = row.get(2)?;
                let path: Option<String> = row.get(3)?;
                let fraction: Option<f64> = row.get(4)?;
                Ok((ch_id, (is_read == 1, page, path, fraction)))
            })?;
            let mut map = std::collections::HashMap::new();
            for r in p_rows {
                let (k, v) = r?;
                map.insert(k, v);
            }
            map
        };

        let mut delete_progress_stmt =
            tx.prepare("DELETE FROM progress WHERE manga_id = ?1 AND chapter_id = ?2")?;
        for ch_id in existing_progress.keys() {
            if !current_chapter_ids.contains(ch_id.as_str()) {
                delete_progress_stmt.execute(params![m.id, ch_id])?;
            }
        }

        let mut upsert_progress_stmt = tx.prepare(
            r#"
            INSERT INTO progress (manga_id, chapter_id, chapter_name, read, page, path, fraction, updated_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(manga_id, chapter_id) DO UPDATE SET
                chapter_name = excluded.chapter_name,
                read = excluded.read,
                page = excluded.page,
                path = excluded.path,
                fraction = excluded.fraction,
                updated_at = excluded.updated_at
            "#,
        )?;

        for (c_idx, c) in m.chapters.iter().enumerate() {
            let ch_id = derive_chapter_id(&m.id, c, c_idx);
            if c.read || c.position.is_some() {
                let read_int = if c.read { 1 } else { 0 };
                let (pos_page, pos_path, pos_frac) = match &c.position {
                    Some(pos) => (Some(pos.page as i64), pos.path.clone(), Some(pos.fraction)),
                    None => (None, None, None),
                };

                let matches_existing = match existing_progress.get(&ch_id) {
                    Some(&(ex_read, ex_page, ref ex_path, ex_frac)) => {
                        (ex_read == c.read)
                            && (ex_page == pos_page)
                            && (ex_path.as_deref() == pos_path.as_deref())
                            && match (ex_frac, pos_frac) {
                                (Some(a), Some(b)) => (a - b).abs() < 0.001,
                                (None, None) => true,
                                _ => false,
                            }
                    }
                    None => false,
                };

                if !matches_existing {
                    upsert_progress_stmt.execute(params![
                        m.id,
                        ch_id,
                        c.name,
                        read_int,
                        pos_page,
                        pos_path,
                        pos_frac,
                        m.updated_at,
                    ])?;
                }
            } else if existing_progress.contains_key(&ch_id) {
                delete_progress_stmt.execute(params![m.id, ch_id])?;
            }
        }
    }

    // 4. Diff and upsert bookmarks keyed by stable chapter_id
    {
        let existing_bookmarks: std::collections::HashMap<String, Vec<PositionRecord>> = {
            let mut bm_stmt = tx.prepare(
                "SELECT chapter_id, page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 ORDER BY id ASC",
            )?;
            let bm_rows = bm_stmt.query_map(params![m.id], |row| {
                let ch_id: String = row.get(0)?;
                let page: i64 = row.get(1)?;
                let path: Option<String> = row.get(2)?;
                let fraction: f64 = row.get(3)?;
                let manga_bm: i64 = row.get(4)?;
                let timestamp: f64 = row.get(5)?;
                Ok((
                    ch_id,
                    PositionRecord {
                        page: page as u32,
                        path,
                        fraction,
                        manga_bookmark: Some(manga_bm == 1),
                        timestamp: Some(timestamp),
                    },
                ))
            })?;
            let mut map: std::collections::HashMap<String, Vec<PositionRecord>> =
                std::collections::HashMap::new();
            for r in bm_rows {
                let (ch_id, pos) = r?;
                map.entry(ch_id).or_default().push(pos);
            }
            map
        };

        let mut delete_bm_chapter_stmt =
            tx.prepare("DELETE FROM bookmarks WHERE manga_id = ?1 AND chapter_id = ?2")?;
        let mut insert_bm_stmt = tx.prepare(
            r#"
            INSERT INTO bookmarks (manga_id, chapter_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
        )?;

        for ch_id in existing_bookmarks.keys() {
            if !current_chapter_ids.contains(ch_id.as_str()) {
                delete_bm_chapter_stmt.execute(params![m.id, ch_id])?;
            }
        }

        for (c_idx, c) in m.chapters.iter().enumerate() {
            let ch_id = derive_chapter_id(&m.id, c, c_idx);
            let new_bms = c.bookmarks.as_deref().unwrap_or(&[]);
            let ex_bms = existing_bookmarks
                .get(&ch_id)
                .map(|v| v.as_slice())
                .unwrap_or(&[]);

            let bookmarks_identical = ex_bms.len() == new_bms.len()
                && ex_bms.iter().zip(new_bms.iter()).all(|(a, b)| {
                    a.page == b.page
                        && a.path == b.path
                        && (a.fraction - b.fraction).abs() < 0.001
                        && a.manga_bookmark.unwrap_or(false) == b.manga_bookmark.unwrap_or(false)
                        && match (a.timestamp, b.timestamp) {
                            (Some(t1), Some(t2)) => (t1 - t2).abs() < 0.001,
                            (None, None) => true,
                            _ => false,
                        }
                });

            if !bookmarks_identical {
                if !ex_bms.is_empty() {
                    delete_bm_chapter_stmt.execute(params![m.id, ch_id])?;
                }
                for bm in new_bms {
                    let is_manga_bm = if bm.manga_bookmark.unwrap_or(false) {
                        1
                    } else {
                        0
                    };
                    insert_bm_stmt.execute(params![
                        m.id,
                        ch_id,
                        c.name,
                        bm.page as i64,
                        bm.path,
                        bm.fraction,
                        is_manga_bm,
                        bm.timestamp.unwrap_or(0.0),
                    ])?;
                }
            }
        }
    }

    Ok(())
}

pub fn list_library(conn: &Connection) -> DbResult<Vec<SummaryRecord>> {
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

pub fn get_manga(conn: &Connection, id: &str) -> DbResult<Option<MangaRecord>> {
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

    let (m_id, slug, title, local_path, last_chapter, added_at, updated_at, revision, sort) =
        match manga_row {
            Some(tuple) => tuple,
            None => return Ok(None),
        };

    // Load progress indexed by chapter_id and chapter_name
    let mut prog_map = std::collections::HashMap::new();
    {
        let mut p_stmt = conn.prepare("SELECT chapter_id, chapter_name, read, page, path, fraction FROM progress WHERE manga_id = ?1")?;
        let p_rows = p_stmt.query_map(params![id], |row| {
            let ch_id: String = row.get(0)?;
            let chapter_name: String = row.get(1)?;
            let read_int: i64 = row.get(2)?;
            let page: Option<i64> = row.get(3)?;
            let path: Option<String> = row.get(4)?;
            let fraction: Option<f64> = row.get(5)?;
            Ok((ch_id, chapter_name, read_int == 1, page, path, fraction))
        })?;
        for r in p_rows {
            let (ch_id, ch_name, read, page, path, fraction) = r?;
            prog_map.insert(ch_id.clone(), (read, page, path.clone(), fraction));
            prog_map.insert(ch_name, (read, page, path, fraction));
        }
    }

    // Load bookmarks indexed by chapter_id and chapter_name
    let mut bm_map: std::collections::HashMap<String, Vec<PositionRecord>> =
        std::collections::HashMap::new();
    {
        let mut bm_stmt = conn.prepare(
            "SELECT chapter_id, chapter_name, page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 ORDER BY id ASC",
        )?;
        let bm_rows = bm_stmt.query_map(params![id], |row| {
            let ch_id: String = row.get(0)?;
            let chapter_name: String = row.get(1)?;
            let page: i64 = row.get(2)?;
            let path: Option<String> = row.get(3)?;
            let fraction: f64 = row.get(4)?;
            let manga_bm: i64 = row.get(5)?;
            let timestamp: f64 = row.get(6)?;
            Ok((
                ch_id,
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
            let (ch_id, ch_name, pos) = r?;
            bm_map.entry(ch_id.clone()).or_default().push(pos.clone());
            if ch_name != ch_id {
                bm_map.entry(ch_name).or_default().push(pos);
            }
        }
    }

    // Load chapters ordered by chapter_idx
    let mut chapters = Vec::new();
    let mut c_stmt = conn.prepare("SELECT chapter_id, chapter_idx, name FROM chapters WHERE manga_id = ?1 ORDER BY chapter_idx ASC")?;
    let c_rows = c_stmt.query_map(params![id], |row| {
        let ch_id: String = row.get(0)?;
        let c_idx: i64 = row.get(1)?;
        let c_name: String = row.get(2)?;
        Ok((ch_id, c_idx, c_name))
    })?;

    for cr in c_rows {
        let (ch_id, _c_idx, c_name) = cr?;

        // Load pages for this chapter
        let mut pages = Vec::new();
        let mut p_stmt = conn.prepare(
            "SELECT name, path, width, height, size, modified, dimensions_pending FROM pages WHERE manga_id = ?1 AND chapter_id = ?2 ORDER BY idx ASC",
        )?;
        let p_rows = p_stmt.query_map(params![id, ch_id], |row| {
            let dim_pending_int: i64 = row.get::<_, Option<i64>>(6)?.unwrap_or(0);
            let dimensions_pending = if dim_pending_int == 1 {
                Some(true)
            } else {
                None
            };
            Ok(PageRecord {
                dimensions_pending,
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

        let (read, position) = match prog_map.get(&ch_id).or_else(|| prog_map.get(&c_name)) {
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

        let bookmarks = bm_map.remove(&ch_id).or_else(|| bm_map.remove(&c_name));

        chapters.push(ChapterRecord {
            id: Some(ch_id),
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

pub fn save_manga(conn: &mut Connection, manga: &MangaRecord) -> DbResult<()> {
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
) -> DbResult<String> {
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

    if let Some(exp_rev) = expected_revision {
        if exp_rev != cur_revision as u64 {
            tx.rollback()?;
            return Ok("stale".to_string());
        }
    } else if let Some(exp_up) = expected_updated_at {
        if (exp_up - cur_updated_at).abs() > 0.001 {
            tx.rollback()?;
            return Ok("stale".to_string());
        }
    }

    let chapter_info: Option<(String, String)> = tx
        .query_row(
            "SELECT chapter_id, name FROM chapters WHERE manga_id = ?1 AND chapter_idx = ?2",
            params![manga_id, chapter_index as i64],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    let (ch_id, ch_name) = match chapter_info {
        Some(t) => t,
        None => {
            tx.rollback()?;
            return Ok("missing".to_string());
        }
    };

    let existing_read: Option<i64> = tx
        .query_row(
            "SELECT read FROM progress WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3)",
            params![manga_id, ch_id, ch_name],
            |row| row.get(0),
        )
        .optional()?;

    let is_read = if read || existing_read == Some(1) {
        1
    } else {
        0
    };
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;

    tx.execute(
        r#"
        INSERT INTO progress (manga_id, chapter_id, chapter_name, read, page, path, fraction, updated_at)
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
        ON CONFLICT(manga_id, chapter_id) DO UPDATE SET
            chapter_name = excluded.chapter_name,
            read = excluded.read,
            page = excluded.page,
            path = excluded.path,
            fraction = excluded.fraction,
            updated_at = excluded.updated_at
        "#,
        params![
            manga_id,
            ch_id,
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
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3)",
            params![manga_id, ch_id, ch_name],
        )?;
        for bm in bms {
            let is_manga_bm = if bm.manga_bookmark.unwrap_or(false) {
                1
            } else {
                0
            };
            tx.execute(
                r#"
                INSERT INTO bookmarks (manga_id, chapter_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                "#,
                params![
                    manga_id,
                    ch_id,
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
) -> DbResult<Vec<PositionRecord>> {
    let tx = conn.transaction()?;
    let is_manga_bm = if position.manga_bookmark.unwrap_or(false) {
        1
    } else {
        0
    };

    let chapter_id: String = tx
        .query_row(
            "SELECT chapter_id FROM chapters WHERE manga_id = ?1 AND (name = ?2 OR chapter_id = ?2) LIMIT 1",
            params![manga_id, chapter_name],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| chapter_name.to_string());

    let exists: bool = if is_manga_bm == 1 {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND manga_bookmark = 1 LIMIT 1",
            params![manga_id, chapter_id, chapter_name],
            |_| Ok(true),
        )
        .unwrap_or(false)
    } else if let Some(path) = &position.path {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND path = ?4 AND manga_bookmark = 0 LIMIT 1",
            params![manga_id, chapter_id, chapter_name, path],
            |_| Ok(true),
        )
        .unwrap_or(false)
    } else {
        tx.query_row(
            "SELECT 1 FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND page = ?4 AND manga_bookmark = 0 LIMIT 1",
            params![manga_id, chapter_id, chapter_name, position.page as i64],
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
            INSERT INTO bookmarks (manga_id, chapter_id, chapter_name, page, path, fraction, manga_bookmark, timestamp)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            "#,
            params![
                manga_id,
                chapter_id,
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
            "SELECT page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![manga_id, chapter_id, chapter_name], |row| {
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
) -> DbResult<Vec<PositionRecord>> {
    let tx = conn.transaction()?;
    let is_manga_bm = if position.manga_bookmark.unwrap_or(false) {
        1
    } else {
        0
    };

    let chapter_id: String = tx
        .query_row(
            "SELECT chapter_id FROM chapters WHERE manga_id = ?1 AND (name = ?2 OR chapter_id = ?2) LIMIT 1",
            params![manga_id, chapter_name],
            |row| row.get(0),
        )
        .unwrap_or_else(|_| chapter_name.to_string());

    if is_manga_bm == 1 {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND manga_bookmark = 1",
            params![manga_id, chapter_id, chapter_name],
        )?;
    } else if let Some(path) = &position.path {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND path = ?4 AND manga_bookmark = 0",
            params![manga_id, chapter_id, chapter_name, path],
        )?;
    } else {
        tx.execute(
            "DELETE FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) AND page = ?4 AND manga_bookmark = 0",
            params![manga_id, chapter_id, chapter_name, position.page as i64],
        )?;
    }

    let mut result = Vec::new();
    {
        let mut stmt = tx.prepare(
            "SELECT page, path, fraction, manga_bookmark, timestamp FROM bookmarks WHERE manga_id = ?1 AND (chapter_id = ?2 OR chapter_name = ?3) ORDER BY id ASC",
        )?;
        let rows = stmt.query_map(params![manga_id, chapter_id, chapter_name], |row| {
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

pub fn get_bookmarked_ids(conn: &Connection) -> DbResult<BookmarkedIdsResponse> {
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCardsQuery {
    pub tab: Option<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCardDto {
    pub manga_id: String,
    pub manga_title: String,
    pub manga_slug: String,
    pub local_path: Option<String>,
    pub updated_at: f64,
    pub chapter_idx: usize,
    pub chapter_name: String,
    pub page: usize,
    pub page_path: Option<String>,
    pub fraction: f64,
    pub manga_bookmark: bool,
    pub timestamp: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkCardsResult {
    pub cards: Vec<BookmarkCardDto>,
    pub total: usize,
}

pub fn query_bookmark_cards(
    conn: &Connection,
    query: &BookmarkCardsQuery,
) -> DbResult<BookmarkCardsResult> {
    let where_clause = match query.tab.as_deref() {
        Some("manga") => " WHERE b.manga_bookmark = 1",
        Some("individual") => " WHERE b.manga_bookmark = 0",
        _ => "",
    };

    let count_sql = format!(
        "SELECT COUNT(*) FROM bookmarks b JOIN manga m ON b.manga_id = m.id{}",
        where_clause
    );
    let total: usize = conn
        .query_row(&count_sql, [], |row| row.get::<_, i64>(0))
        .map(|c| c as usize)?;

    let sort_clause = match query.sort.as_deref() {
        Some("newest") => "ORDER BY b.timestamp DESC, b.id DESC",
        Some("oldest") => "ORDER BY b.timestamp ASC, b.id ASC",
        Some("title-asc") => {
            "ORDER BY m.title COLLATE NOCASE ASC, c.chapter_idx ASC, b.page ASC, b.id ASC"
        }
        Some("title-desc") => {
            "ORDER BY m.title COLLATE NOCASE DESC, c.chapter_idx ASC, b.page ASC, b.id ASC"
        }
        Some("chapter") => {
            "ORDER BY m.title COLLATE NOCASE ASC, c.chapter_idx ASC, b.page ASC, b.id ASC"
        }
        _ => "ORDER BY b.timestamp DESC, b.id DESC",
    };

    let mut select_sql = format!(
        "SELECT
            b.manga_id,
            m.title,
            m.slug,
            m.local_path,
            m.updated_at,
            COALESCE(c.chapter_idx, 0),
            b.chapter_name,
            b.page,
            COALESCE(b.path, p.path) AS page_path,
            b.fraction,
            b.manga_bookmark,
            b.timestamp
        FROM bookmarks b
        JOIN manga m ON b.manga_id = m.id
        LEFT JOIN chapters c ON b.manga_id = c.manga_id AND b.chapter_id = c.chapter_id
        LEFT JOIN pages p ON b.manga_id = p.manga_id AND c.chapter_id = p.chapter_id AND b.page = p.idx
        {}
        {}",
        where_clause,
        sort_clause
    );

    if let Some(limit) = query.limit {
        let offset = query.offset.unwrap_or(0);
        select_sql.push_str(&format!(" LIMIT {} OFFSET {}", limit, offset));
    }

    let mut stmt = conn.prepare(&select_sql)?;
    let rows = stmt.query_map([], |row| {
        Ok(BookmarkCardDto {
            manga_id: row.get(0)?,
            manga_title: row.get(1)?,
            manga_slug: row.get(2)?,
            local_path: row.get(3)?,
            updated_at: row.get(4)?,
            chapter_idx: row.get::<_, i64>(5)? as usize,
            chapter_name: row.get(6)?,
            page: row.get::<_, i64>(7)? as usize,
            page_path: row.get(8)?,
            fraction: row.get(9)?,
            manga_bookmark: row.get::<_, i64>(10)? == 1,
            timestamp: row.get(11)?,
        })
    })?;

    let mut cards = Vec::new();
    for r in rows {
        cards.push(r?);
    }

    Ok(BookmarkCardsResult { cards, total })
}

pub fn delete_manga(conn: &mut Connection, id: &str) -> DbResult<()> {
    conn.execute("DELETE FROM manga WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_library(conn: &mut Connection) -> DbResult<()> {
    conn.execute_batch(
        r#"
        DELETE FROM bookmarks;
        DELETE FROM progress;
        DELETE FROM pages;
        DELETE FROM chapters;
        DELETE FROM manga;
        "#,
    )?;
    Ok(())
}

pub fn reset_progress(conn: &mut Connection) -> DbResult<()> {
    let tx = conn.transaction()?;
    tx.execute(
        "UPDATE progress SET read = 0, page = NULL, path = NULL, fraction = NULL",
        params![],
    )?;
    tx.execute("UPDATE manga SET last_chapter = 0", params![])?;
    tx.commit()?;
    Ok(())
}

pub fn get_settings(conn: &Connection, key: &str) -> DbResult<Option<serde_json::Value>> {
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

pub fn save_settings(conn: &mut Connection, key: &str, val: &serde_json::Value) -> DbResult<()> {
    let s = serde_json::to_string(val)?;
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, s],
    )?;
    Ok(())
}

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
        params![settings_str],
    )?;

    tx.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated', '1')",
        params![],
    )?;

    tx.commit()?;

    Ok(norm_settings)
}

// ==============================================================================
// Tauri Command Handlers
// ==============================================================================

#[tauri::command]
pub async fn is_library_migrated(state: State<'_, DbState>) -> DbResult<bool> {
    state.read(is_migrated).await
}

#[tauri::command]
pub async fn import_legacy_library(
    state: State<'_, DbState>,
    payload: LegacyBackupPayload,
) -> DbResult<bool> {
    state
        .write(move |conn| import_legacy_library_tx(conn, &payload).map(|_| true))
        .await
}

#[tauri::command]
pub async fn sqlite_list_library(state: State<'_, DbState>) -> DbResult<Vec<SummaryRecord>> {
    state.read(list_library).await
}

#[tauri::command]
pub async fn sqlite_get_manga(
    state: State<'_, DbState>,
    id: String,
) -> DbResult<Option<MangaRecord>> {
    state.read(move |conn| get_manga(conn, &id)).await
}

#[tauri::command]
pub async fn sqlite_save_manga(state: State<'_, DbState>, manga: MangaRecord) -> DbResult<()> {
    state.write(move |conn| save_manga(conn, &manga)).await
}

#[tauri::command]
pub async fn sqlite_save_progress(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_index: usize,
    position: PositionRecord,
    read: bool,
    bookmarks: Option<Vec<PositionRecord>>,
    update_last: bool,
    expected_revision: Option<u64>,
    expected_updated_at: Option<f64>,
) -> DbResult<String> {
    state
        .write(move |conn| {
            save_progress(
                conn,
                &manga_id,
                chapter_index,
                &position,
                read,
                bookmarks.as_deref(),
                update_last,
                expected_revision,
                expected_updated_at,
            )
        })
        .await
}

#[tauri::command]
pub async fn sqlite_add_bookmark(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_name: String,
    position: PositionRecord,
) -> DbResult<Vec<PositionRecord>> {
    state
        .write(move |conn| add_bookmark(conn, &manga_id, &chapter_name, &position))
        .await
}

#[tauri::command]
pub async fn sqlite_remove_bookmark(
    state: State<'_, DbState>,
    manga_id: String,
    chapter_name: String,
    position: PositionRecord,
) -> DbResult<Vec<PositionRecord>> {
    state
        .write(move |conn| remove_bookmark(conn, &manga_id, &chapter_name, &position))
        .await
}

#[tauri::command]
pub async fn sqlite_get_bookmarked_manga_ids(
    state: State<'_, DbState>,
) -> DbResult<BookmarkedIdsResponse> {
    state.read(get_bookmarked_ids).await
}

#[tauri::command]
pub async fn get_bookmark_cards(
    state: State<'_, DbState>,
    query: BookmarkCardsQuery,
) -> DbResult<BookmarkCardsResult> {
    state
        .read(move |conn| query_bookmark_cards(conn, &query))
        .await
}

#[tauri::command]
pub async fn sqlite_delete_manga(state: State<'_, DbState>, id: String) -> DbResult<()> {
    state.write(move |conn| delete_manga(conn, &id)).await
}

#[tauri::command]
pub async fn sqlite_clear_library(state: State<'_, DbState>) -> DbResult<()> {
    state.write(clear_library).await
}

#[tauri::command]
pub async fn sqlite_reset_progress(state: State<'_, DbState>) -> DbResult<()> {
    state.write(reset_progress).await
}

#[tauri::command]
pub async fn sqlite_get_settings(state: State<'_, DbState>) -> DbResult<Option<serde_json::Value>> {
    state.read(|conn| get_settings(conn, "global")).await
}

#[tauri::command]
pub async fn sqlite_save_settings(
    state: State<'_, DbState>,
    settings: serde_json::Value,
) -> DbResult<()> {
    state
        .write(move |conn| save_settings(conn, "global", &settings))
        .await
}

#[tauri::command]
pub async fn validate_library_backup(
    backup_json: String,
) -> DbResult<crate::validation::BackupPayload> {
    tauri::async_runtime::spawn_blocking(move || {
        crate::validation::validate_backup_json(&backup_json)
    })
    .await
    .map_err(|e| DbError::Task(format!("Validation task failed: {e}")))?
    .map_err(DbError::Validation)
}

#[tauri::command]
pub async fn export_library_backup(state: State<'_, DbState>) -> DbResult<String> {
    state.read(export_backup_json).await
}

#[tauri::command]
pub async fn restore_library_backup(
    state: State<'_, DbState>,
    backup_json: String,
) -> DbResult<serde_json::Value> {
    let payload = tauri::async_runtime::spawn_blocking({
        let backup_json = backup_json.clone();
        move || crate::validation::validate_backup_json(&backup_json)
    })
    .await
    .map_err(|e| DbError::Task(format!("Validation task failed: {e}")))?
    .map_err(DbError::Validation)?;

    state
        .write(move |conn| restore_backup_tx(conn, &payload))
        .await
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
            chapters: vec![ChapterRecord {
                id: None,
                name: "Chapter 1".into(),
                pages: vec![PageRecord {
                    dimensions_pending: None,
                    name: "01.png".into(),
                    path: "Chapter 1/01.png".into(),
                    width: 800,
                    height: 1200,
                    size: Some(1024),
                    modified: Some(1500.0),
                }],
                read: true,
                position: Some(PositionRecord {
                    page: 1,
                    path: Some("Chapter 1/01.png".into()),
                    fraction: 0.5,
                    manga_bookmark: None,
                    timestamp: None,
                }),
                bookmarks: Some(vec![PositionRecord {
                    page: 1,
                    path: Some("Chapter 1/01.png".into()),
                    fraction: 0.5,
                    manga_bookmark: Some(false),
                    timestamp: Some(1234.0),
                }]),
            }],
        };

        save_manga(&mut conn, &manga).unwrap();

        let loaded = get_manga(&conn, "manga-1")
            .unwrap()
            .expect("Must load manga");
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
                id: None,
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
                id: None,
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
                    id: None,
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

    #[test]
    fn test_export_backup_json_and_restore_backup_tx() {
        let mut conn = create_test_conn();
        let manga = MangaRecord {
            id: "m-exp".into(),
            slug: Some("m-exp".into()),
            title: "Export Title".into(),
            local_path: Some("C:\\Local\\Path".into()),
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: None,
            chapters: vec![ChapterRecord {
                id: None,
                name: "Ch 1".into(),
                pages: vec![PageRecord {
                    dimensions_pending: None,
                    name: "1.jpg".into(),
                    path: "ch1/1.jpg".into(),
                    width: 800,
                    height: 1200,
                    size: Some(1024),
                    modified: Some(1000.0),
                }],
                read: true,
                position: Some(PositionRecord {
                    page: 0,
                    path: Some("ch1/1.jpg".into()),
                    fraction: 0.5,
                    manga_bookmark: None,
                    timestamp: None,
                }),
                bookmarks: None,
            }],
        };
        save_manga(&mut conn, &manga).unwrap();
        save_settings(
            &mut conn,
            "global",
            &serde_json::json!({ "theme": "dark", "maxWidth": 1280 }),
        )
        .unwrap();

        let json = export_backup_json(&conn).unwrap();
        assert!(json.contains("\"version\":2"));
        assert!(json.contains("Export Title"));
        assert!(json.contains("C:\\\\Local\\\\Path"));

        // Now test restore_backup_tx using the exported JSON
        let payload = crate::validation::validate_backup_json(&json).unwrap();
        let mut conn2 = create_test_conn();
        // Insert an existing title with local_path in conn2 to test preservation
        let existing_manga = MangaRecord {
            id: "m-exp".into(),
            slug: Some("m-exp".into()),
            title: "Old Title".into(),
            local_path: Some("D:\\Preserved\\Path".into()),
            last_chapter: 0,
            added_at: 500.0,
            updated_at: 600.0,
            revision: Some(1),
            sort: None,
            chapters: vec![],
        };
        save_manga(&mut conn2, &existing_manga).unwrap();

        // Restore backup where local_path is None or test preservation
        let mut payload_no_path = payload.clone();
        payload_no_path.manga[0].local_path = None;
        let applied_settings = restore_backup_tx(&mut conn2, &payload_no_path).unwrap();
        assert_eq!(applied_settings["theme"], "dark");
        assert_eq!(applied_settings["maxWidth"], 1280);

        let restored_manga = get_manga(&conn2, "m-exp").unwrap().unwrap();
        assert_eq!(restored_manga.title, "Export Title");
        assert_eq!(
            restored_manga.local_path,
            Some("D:\\Preserved\\Path".into())
        );
        assert_eq!(restored_manga.chapters.len(), 1);
        assert_eq!(restored_manga.chapters[0].pages.len(), 1);
    }

    #[tokio::test]
    async fn test_db_state_read_write_concurrency() {
        let temp_dir = std::env::temp_dir().join(format!(
            "manga_rw_test_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let _ = std::fs::create_dir_all(&temp_dir);
        let db_file = temp_dir.join("test_rw.db");

        let writer = Connection::open(&db_file).unwrap();
        init_db(&writer).unwrap();
        writer
            .busy_timeout(std::time::Duration::from_millis(5000))
            .unwrap();

        let reader = Connection::open_with_flags(
            &db_file,
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY | rusqlite::OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )
        .unwrap();
        reader
            .busy_timeout(std::time::Duration::from_millis(5000))
            .unwrap();
        reader
            .execute_batch(
                "PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON; PRAGMA query_only = ON;",
            )
            .unwrap();

        let state = DbState::new(reader, writer);

        // Perform concurrent write and read operations
        let write_fut = state.write(|conn| {
            conn.execute(
                "INSERT INTO settings (key, value) VALUES ('test_key', 'test_val')",
                [],
            )?;
            Ok(())
        });

        let read_fut = state.read(|conn| {
            let res: Option<String> = conn
                .query_row(
                    "SELECT value FROM settings WHERE key = 'test_key'",
                    [],
                    |r| r.get(0),
                )
                .optional()?;
            Ok(res)
        });

        let (write_res, read_res) = tokio::join!(write_fut, read_fut);
        assert!(write_res.is_ok());
        assert!(read_res.is_ok());

        // Now read after write is guaranteed to have committed
        let val = state
            .read(|conn| {
                let v: String = conn.query_row(
                    "SELECT value FROM settings WHERE key = 'test_key'",
                    [],
                    |r| r.get(0),
                )?;
                Ok(v)
            })
            .await
            .unwrap();
        assert_eq!(val, "test_val");

        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_schema_user_version_and_pragmas() {
        let conn = create_test_conn();

        let user_ver: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(user_ver, 2, "user_version must be initialized to 2");

        let sync_mode: i64 = conn
            .pragma_query_value(None, "synchronous", |r| r.get(0))
            .unwrap();
        assert_eq!(sync_mode, 1, "synchronous pragma must be NORMAL (1)");

        let foreign_keys: i64 = conn
            .pragma_query_value(None, "foreign_keys", |r| r.get(0))
            .unwrap();
        assert_eq!(foreign_keys, 1, "foreign_keys pragma must be ON (1)");

        // Running migrations again must be an idempotent no-op
        run_migrations(&conn).unwrap();
        let user_ver_after: u32 = conn
            .pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap();
        assert_eq!(user_ver_after, 2);
    }

    #[test]
    fn test_insert_or_replace_diff_and_upsert() {
        let mut conn = create_test_conn();

        let mut manga = MangaRecord {
            id: "manga-diff".into(),
            slug: Some("manga-diff".into()),
            title: "Manga Diff".into(),
            local_path: Some("C:\\Manga\\Diff".into()),
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: None,
            chapters: vec![
                ChapterRecord {
                    id: None,
                    name: "Ch 1".into(),
                    pages: vec![
                        PageRecord {
                            dimensions_pending: None,
                            name: "01.jpg".into(),
                            path: "Ch 1/01.jpg".into(),
                            width: 800,
                            height: 1200,
                            size: Some(100),
                            modified: Some(10.0),
                        },
                        PageRecord {
                            dimensions_pending: None,
                            name: "02.jpg".into(),
                            path: "Ch 1/02.jpg".into(),
                            width: 800,
                            height: 1200,
                            size: Some(200),
                            modified: Some(20.0),
                        },
                    ],
                    read: true,
                    position: Some(PositionRecord {
                        page: 1,
                        path: Some("Ch 1/02.jpg".into()),
                        fraction: 0.5,
                        manga_bookmark: None,
                        timestamp: Some(1234.0),
                    }),
                    bookmarks: Some(vec![PositionRecord {
                        page: 1,
                        path: Some("Ch 1/02.jpg".into()),
                        fraction: 0.5,
                        manga_bookmark: Some(false),
                        timestamp: Some(1234.0),
                    }]),
                },
                ChapterRecord {
                    id: None,
                    name: "Ch 2".into(),
                    pages: vec![PageRecord {
                        dimensions_pending: None,
                        name: "c2_01.jpg".into(),
                        path: "Ch 2/c2_01.jpg".into(),
                        width: 900,
                        height: 1300,
                        size: Some(300),
                        modified: Some(30.0),
                    }],
                    read: false,
                    position: None,
                    bookmarks: None,
                },
            ],
        };

        // First save
        save_manga(&mut conn, &manga).unwrap();

        // Get rowid of Ch 2 page 0
        let ch2_page_rowid: i64 = conn
            .query_row(
                "SELECT rowid FROM pages WHERE manga_id = 'manga-diff' AND chapter_idx = 1 AND idx = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Get progress row updated_at for Ch 1
        let ch1_prog_updated: f64 = conn
            .query_row(
                "SELECT updated_at FROM progress WHERE manga_id = 'manga-diff' AND chapter_name = 'Ch 1'",
                [],
                |r| r.get(0),
            )
            .unwrap();

        // Second save: only update Ch 1 page 0 width, leaving Ch 2 and Ch 1 progress unchanged
        manga.chapters[0].pages[0].width = 850;
        manga.updated_at = 3000.0;
        manga.revision = Some(2);
        save_manga(&mut conn, &manga).unwrap();

        // Check Ch 1 was updated
        let ch1_p0_width: u32 = conn
            .query_row(
                "SELECT width FROM pages WHERE manga_id = 'manga-diff' AND chapter_idx = 0 AND idx = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ch1_p0_width, 850);

        // Check Ch 2 page was NOT deleted and reinserted (rowid is unchanged)
        let ch2_page_rowid_after: i64 = conn
            .query_row(
                "SELECT rowid FROM pages WHERE manga_id = 'manga-diff' AND chapter_idx = 1 AND idx = 0",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            ch2_page_rowid, ch2_page_rowid_after,
            "Unchanged chapter pages must not be re-inserted"
        );

        // Check Ch 1 progress was preserved and not rewritten
        let ch1_prog_updated_after: f64 = conn
            .query_row(
                "SELECT updated_at FROM progress WHERE manga_id = 'manga-diff' AND chapter_name = 'Ch 1'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(ch1_prog_updated, ch1_prog_updated_after);

        // Third save: remove Ch 2 entirely (test truncation cleanup)
        manga.chapters.pop();
        save_manga(&mut conn, &manga).unwrap();

        let remaining_chapters: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM chapters WHERE manga_id = 'manga-diff'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining_chapters, 1);

        let remaining_pages: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pages WHERE manga_id = 'manga-diff'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(remaining_pages, 2);
    }

    #[test]
    fn test_db_error_structure() {
        let err = DbError::Sqlite("syntax error near WHERE".into());
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(
            json,
            r#"{"code":"Sqlite","message":"syntax error near WHERE"}"#
        );

        let val_err = DbError::Validation("invalid chapter length".into());
        let val_json = serde_json::to_string(&val_err).unwrap();
        assert_eq!(
            val_json,
            r#"{"code":"Validation","message":"invalid chapter length"}"#
        );

        let conflict = DbError::Conflict("stale revision".into());
        let conflict_json = serde_json::to_string(&conflict).unwrap();
        assert_eq!(
            conflict_json,
            r#"{"code":"Conflict","message":"stale revision"}"#
        );
    }

    #[test]
    fn test_stable_chapter_id_and_dimensions_pending() {
        let mut conn = create_test_conn();

        let manga = MangaRecord {
            id: "manga-stable".into(),
            slug: Some("manga-stable".into()),
            title: "Manga Stable".into(),
            local_path: Some("C:\\Manga\\Stable".into()),
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: None,
            chapters: vec![ChapterRecord {
                id: None,
                name: "Chapter 1".into(),
                pages: vec![PageRecord {
                    dimensions_pending: Some(true),
                    name: "01.jpg".into(),
                    path: "Chapter 1/01.jpg".into(),
                    width: 0,
                    height: 0,
                    size: Some(100),
                    modified: Some(10.0),
                }],
                read: true,
                position: Some(PositionRecord {
                    page: 0,
                    path: Some("Chapter 1/01.jpg".into()),
                    fraction: 0.5,
                    manga_bookmark: None,
                    timestamp: Some(1500.0),
                }),
                bookmarks: Some(vec![PositionRecord {
                    page: 0,
                    path: Some("Chapter 1/01.jpg".into()),
                    fraction: 0.5,
                    manga_bookmark: Some(true),
                    timestamp: Some(1500.0),
                }]),
            }],
        };

        save_manga(&mut conn, &manga).unwrap();

        // Verify get_manga returns dimensions_pending: Some(true) and stable chapter ID
        let loaded = get_manga(&conn, "manga-stable").unwrap().unwrap();
        assert_eq!(loaded.chapters.len(), 1);
        assert_eq!(loaded.chapters[0].pages[0].dimensions_pending, Some(true));
        assert!(loaded.chapters[0].id.is_some());
        let initial_ch_id = loaded.chapters[0].id.clone().unwrap();

        // Rename chapter from "Chapter 1" to "Ch 1: The Beginning"
        let mut renamed = loaded.clone();
        renamed.chapters[0].name = "Ch 1: The Beginning".into();
        save_manga(&mut conn, &renamed).unwrap();

        // Reload: progress and bookmarks are preserved under stable ID
        let reloaded = get_manga(&conn, "manga-stable").unwrap().unwrap();
        assert_eq!(reloaded.chapters[0].name, "Ch 1: The Beginning");
        assert_eq!(
            reloaded.chapters[0].id.as_deref(),
            Some(initial_ch_id.as_str())
        );
        assert!(reloaded.chapters[0].read);
        assert!(reloaded.chapters[0].position.is_some());
        assert_eq!(
            reloaded.chapters[0].bookmarks.as_ref().map(|b| b.len()),
            Some(1)
        );
    }

    #[test]
    fn test_query_bookmark_cards_tabs_sort_pagination() {
        let mut conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();

        let manga1 = MangaRecord {
            id: "manga-bm-1".into(),
            slug: Some("manga-bm-1".into()),
            title: "Alpha Manga".into(),
            local_path: Some("C:/Manga/Alpha".into()),
            last_chapter: 0,
            added_at: 1000.0,
            updated_at: 2000.0,
            revision: Some(1),
            sort: Some("natural".into()),
            chapters: vec![ChapterRecord {
                id: None,
                name: "Chapter 1".into(),
                pages: vec![PageRecord {
                    dimensions_pending: None,
                    name: "01.jpg".into(),
                    path: "Chapter 1/01.jpg".into(),
                    width: 800,
                    height: 1200,
                    size: Some(100),
                    modified: Some(10.0),
                }],
                read: false,
                position: None,
                bookmarks: Some(vec![
                    PositionRecord {
                        page: 0,
                        path: Some("Chapter 1/01.jpg".into()),
                        fraction: 0.2,
                        manga_bookmark: Some(true),
                        timestamp: Some(100.0),
                    },
                    PositionRecord {
                        page: 0,
                        path: Some("Chapter 1/01.jpg".into()),
                        fraction: 0.8,
                        manga_bookmark: Some(false),
                        timestamp: Some(200.0),
                    },
                ]),
            }],
        };

        let manga2 = MangaRecord {
            id: "manga-bm-2".into(),
            slug: Some("manga-bm-2".into()),
            title: "Beta Manga".into(),
            local_path: Some("C:/Manga/Beta".into()),
            last_chapter: 0,
            added_at: 1500.0,
            updated_at: 2500.0,
            revision: Some(1),
            sort: Some("natural".into()),
            chapters: vec![ChapterRecord {
                id: None,
                name: "Chapter 1".into(),
                pages: vec![PageRecord {
                    dimensions_pending: None,
                    name: "01.jpg".into(),
                    path: "Chapter 1/01.jpg".into(),
                    width: 800,
                    height: 1200,
                    size: Some(100),
                    modified: Some(10.0),
                }],
                read: false,
                position: None,
                bookmarks: Some(vec![PositionRecord {
                    page: 0,
                    path: Some("Chapter 1/01.jpg".into()),
                    fraction: 0.5,
                    manga_bookmark: Some(false),
                    timestamp: Some(300.0),
                }]),
            }],
        };

        save_manga(&mut conn, &manga1).unwrap();
        save_manga(&mut conn, &manga2).unwrap();

        // 1. Query all
        let all_res = query_bookmark_cards(&conn, &BookmarkCardsQuery::default()).unwrap();
        assert_eq!(all_res.total, 3);
        assert_eq!(all_res.cards.len(), 3);
        // Default order: newest timestamp first (300, 200, 100)
        assert_eq!(all_res.cards[0].manga_id, "manga-bm-2");
        assert_eq!(all_res.cards[0].page_path, Some("Chapter 1/01.jpg".into()));

        // 2. Query manga bookmarks only
        let manga_tab = query_bookmark_cards(
            &conn,
            &BookmarkCardsQuery {
                tab: Some("manga".into()),
                ..Default::default()
            },
        )
        .unwrap();
        assert_eq!(manga_tab.total, 1);
        assert_eq!(manga_tab.cards.len(), 1);
        assert!(manga_tab.cards[0].manga_bookmark);

        // 3. Query individual bookmarks with pagination
        let ind_tab = query_bookmark_cards(
            &conn,
            &BookmarkCardsQuery {
                tab: Some("individual".into()),
                sort: Some("newest".into()),
                limit: Some(1),
                offset: Some(0),
            },
        )
        .unwrap();
        assert_eq!(ind_tab.total, 2);
        assert_eq!(ind_tab.cards.len(), 1);
        assert_eq!(ind_tab.cards[0].manga_id, "manga-bm-2");

        let ind_page2 = query_bookmark_cards(
            &conn,
            &BookmarkCardsQuery {
                tab: Some("individual".into()),
                sort: Some("newest".into()),
                limit: Some(1),
                offset: Some(1),
            },
        )
        .unwrap();
        assert_eq!(ind_page2.total, 2);
        assert_eq!(ind_page2.cards.len(), 1);
        assert_eq!(ind_page2.cards[0].manga_id, "manga-bm-1");
    }
}
