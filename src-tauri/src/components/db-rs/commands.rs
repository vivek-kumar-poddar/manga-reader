use super::backup::{export_backup_json, restore_backup_tx};
use super::error::{DbError, DbResult};
use super::models::{
    BookmarkCardsQuery, BookmarkCardsResult, BookmarkedIdsResponse, LegacyBackupPayload,
    MangaRecord, PositionRecord, SummaryRecord,
};
use super::queries::{
    add_bookmark, clear_library, delete_manga, get_bookmarked_ids, get_manga, get_settings,
    list_library, query_bookmark_cards, remove_bookmark, reset_progress, save_manga, save_progress,
    save_settings,
};
use super::schema::{import_legacy_library_tx, is_migrated};
use super::state::DbState;
use tauri::State;

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
