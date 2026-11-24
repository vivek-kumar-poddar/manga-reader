use super::backup::{export_backup_json, restore_backup_tx};
use super::error::DbError;
use super::models::{
    BookmarkCardsQuery, ChapterRecord, LegacyBackupPayload, MangaRecord, PageRecord, PositionRecord,
};
use super::queries::{
    add_bookmark, get_bookmarked_ids, get_manga, get_settings, list_library, query_bookmark_cards,
    remove_bookmark, save_manga, save_progress, save_settings,
};
use super::schema::{import_legacy_library_tx, init_db, is_migrated, run_migrations, set_migrated};
use super::state::DbState;
use rusqlite::{Connection, OptionalExtension};

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
