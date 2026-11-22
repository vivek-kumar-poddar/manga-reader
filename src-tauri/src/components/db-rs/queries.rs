use rusqlite::{Connection, OptionalExtension, params};
use super::error::DbResult;
use super::models::{
    BookmarkCardDto, BookmarkCardsQuery, BookmarkCardsResult, BookmarkedIdsResponse, ChapterRecord,
    MangaRecord, PageRecord, PositionRecord, SummaryRecord,
};
use super::schema::insert_or_replace_manga;

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
