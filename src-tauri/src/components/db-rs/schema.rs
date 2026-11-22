use rusqlite::{Connection, Transaction, params};
use super::error::{DbError, DbResult};
use super::models::{derive_chapter_id, LegacyBackupPayload, MangaRecord};

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

pub type ExistingPageTuple = (i64, String, String, i64, i64, i64, f64, i64);

pub fn insert_or_replace_manga(tx: &Transaction<'_>, m: &MangaRecord) -> DbResult<()> {
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
        let existing_bookmarks: std::collections::HashMap<String, Vec<super::models::PositionRecord>> = {
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
                    super::models::PositionRecord {
                        page: page as u32,
                        path,
                        fraction,
                        manga_bookmark: Some(manga_bm == 1),
                        timestamp: Some(timestamp),
                    },
                ))
            })?;
            let mut map: std::collections::HashMap<String, Vec<super::models::PositionRecord>> =
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
