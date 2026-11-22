use rusqlite::{Connection, OptionalExtension};
use std::sync::{Arc, Mutex};
use super::error::{DbError, DbResult};
use super::models::MangaRecord;
use super::queries::{get_manga, save_manga};

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
