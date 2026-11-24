use super::backup::validate_backup_json;
use super::path::validate_relative_path;
use super::settings::normalize_settings;
use super::types::ValidatedSettings;

#[test]
fn test_validate_relative_path_traversal() {
    assert!(validate_relative_path("ch1/01.jpg").is_ok());
    assert!(validate_relative_path("ch1/chapter..jpg").is_ok());
    assert!(validate_relative_path("../ch1/01.jpg").is_err());
    assert!(validate_relative_path("/ch1/01.jpg").is_err());
    assert!(validate_relative_path("ch1/01.jpg/").is_err());
    assert!(validate_relative_path("ch1\\01.jpg").is_err());
    assert!(validate_relative_path("ch1/./01.jpg").is_err());
    assert!(validate_relative_path("ch1/../01.jpg").is_err());
    assert!(validate_relative_path("ch1/\001.jpg").is_err());
    assert!(validate_relative_path("C:/ch1/01.jpg").is_err());
    assert!(validate_relative_path("ch1/01.jpg:stream").is_err());
    assert!(validate_relative_path("//server/share/01.jpg").is_err());
    assert!(validate_relative_path("nul.jpg").is_err());
    assert!(validate_relative_path("con").is_err());
    assert!(validate_relative_path("ch1./01.jpg").is_err());
    assert!(validate_relative_path("ch1/01.jpg.").is_err());
    assert!(validate_relative_path("ch1/01.jpg ").is_err());
    assert!(validate_relative_path(" ch1/01.jpg").is_err());
}

#[test]
fn test_deny_unknown_fields_on_backup() {
    let json = r#"{
        "version": 2,
        "manga": [],
        "settings": {},
        "injectedKey": "malicious"
    }"#;
    assert!(validate_backup_json(json).is_err());
}

#[test]
fn test_valid_backup_json_roundtrip() {
    let json = r#"{
        "version": 2,
        "manga": [
            {
                "id": "title-1",
                "title": "Title 1",
                "chapters": [
                    {
                        "name": "Chapter 1",
                        "pages": [
                            { "name": "01.jpg", "path": "ch1/01.jpg", "width": 800, "height": 1200 }
                        ]
                    }
                ]
            }
        ],
        "settings": {
            "theme": "dark",
            "mode": "continuous"
        }
    }"#;

    let res = validate_backup_json(json);
    assert!(res.is_ok());
    let payload = res.unwrap();
    assert_eq!(payload.manga.len(), 1);
    assert_eq!(payload.manga[0].id, "title-1");
    assert_eq!(payload.manga[0].chapters[0].pages[0].width, 800);
}

#[test]
fn test_duplicate_manga_id_rejected() {
    let json = r#"{
        "version": 2,
        "manga": [
            {
                "id": "title-1",
                "title": "Title 1",
                "chapters": [{ "name": "C1", "pages": [{ "name": "1.jpg", "path": "1.jpg", "width": 100, "height": 100 }] }]
            },
            {
                "id": "title-1",
                "title": "Title 1 Duplicate",
                "chapters": [{ "name": "C1", "pages": [{ "name": "1.jpg", "path": "1.jpg", "width": 100, "height": 100 }] }]
            }
        ],
        "settings": {}
    }"#;

    let err = validate_backup_json(json).unwrap_err();
    assert!(err.contains("Duplicate manga ID"));
}

#[test]
fn test_duplicate_page_path_rejected() {
    let json = r#"{
        "version": 2,
        "manga": [
            {
                "id": "title-1",
                "title": "Title 1",
                "chapters": [{
                    "name": "C1",
                    "pages": [
                        { "name": "1.jpg", "path": "ch1/1.jpg", "width": 100, "height": 100 },
                        { "name": "1.jpg", "path": "ch1/1.jpg", "width": 100, "height": 100 }
                    ]
                }]
            }
        ],
        "settings": {}
    }"#;

    let err = validate_backup_json(json).unwrap_err();
    assert!(err.contains("Duplicate page path"));
}

#[test]
fn test_invalid_version_rejected() {
    let json = r#"{
        "version": 3,
        "manga": [],
        "settings": {}
    }"#;

    let err = validate_backup_json(json).unwrap_err();
    assert!(err.contains("Invalid backup version"));
}

#[test]
fn test_backup_preserves_all_supported_fields_and_pending_dimensions() {
    let json = r#"{
        "version": 2,
        "manga": [
            {
                "id": "title-fields",
                "title": "Title Fields",
                "sort": "natural",
                "revision": 7,
                "chapters": [
                    {
                        "id": "ch-id-1",
                        "name": "Chapter 1",
                        "pages": [
                            { "name": "01.jpg", "path": "ch1/01.jpg", "width": 0, "height": 0, "dimensionsPending": true }
                        ],
                        "position": {
                            "page": 0,
                            "fraction": 0.5,
                            "path": "ch1/01.jpg",
                            "mangaBookmark": true,
                            "timestamp": 1731234567890.0
                        },
                        "bookmarks": [
                            {
                                "page": 0,
                                "fraction": 0.0,
                                "path": "ch1/01.jpg",
                                "mangaBookmark": true,
                                "timestamp": 1731234567890.0
                            },
                            {
                                "page": 0,
                                "fraction": 0.5,
                                "path": "ch1/01.jpg",
                                "mangaBookmark": false,
                                "timestamp": 1731234567891.0
                            }
                        ]
                    }
                ]
            }
        ],
        "settings": {
            "theme": "dark",
            "fontSizeTitle": 24,
            "fontSizeUi": 18,
            "fontSizeButton": 16,
            "confirmDelete": true,
            "shelfSort": "progress"
        }
    }"#;

    let payload = validate_backup_json(json).expect("Validation should pass");
    assert_eq!(payload.manga[0].sort.as_deref(), Some("natural"));
    assert_eq!(payload.manga[0].revision, Some(7));
    assert_eq!(payload.manga[0].chapters[0].id.as_deref(), Some("ch-id-1"));
    assert_eq!(
        payload.manga[0].chapters[0].pages[0].dimensions_pending,
        Some(true)
    );
    let bms = payload.manga[0].chapters[0].bookmarks.as_ref().unwrap();
    assert_eq!(
        bms.len(),
        2,
        "Both title bookmark and page bookmark on page 0 must be preserved"
    );
    let pos = payload.manga[0].chapters[0].position.as_ref().unwrap();
    assert_eq!(pos.manga_bookmark, Some(true));
    assert_eq!(pos.timestamp, Some(1731234567890.0));

    let norm = normalize_settings(&payload.settings);
    assert_eq!(norm["fontSizeTitle"], 24);
    assert_eq!(norm["fontSizeUi"], 18);
    assert_eq!(norm["fontSizeButton"], 16);
    assert_eq!(norm["fontSizeScale"], 1.0);
    assert_eq!(norm["confirmDelete"], true);
    assert_eq!(norm["shelfSort"], "progress");
}

#[test]
fn test_font_size_scale_and_multiplier_validation() {
    let mut settings = ValidatedSettings::default();
    settings.font_size_title = Some(56.0); // 28 * 2.0
    settings.font_size_ui = Some(30.0); // 15 * 2.0
    settings.font_size_button = Some(28.0); // 14 * 2.0
    settings.font_size_scale = Some(2.0);

    let norm = normalize_settings(&settings);
    assert_eq!(norm["fontSizeTitle"], 56);
    assert_eq!(norm["fontSizeUi"], 30);
    assert_eq!(norm["fontSizeButton"], 28);
    assert_eq!(norm["fontSizeScale"], 2.0);

    // Test 1.5x multiplier scaling
    let mut settings_150 = ValidatedSettings::default();
    settings_150.font_size_title = Some(42.0);
    settings_150.font_size_ui = Some(23.0);
    settings_150.font_size_button = Some(21.0);
    settings_150.font_size_scale = Some(1.5);

    let norm_150 = normalize_settings(&settings_150);
    assert_eq!(norm_150["fontSizeTitle"], 42);
    assert_eq!(norm_150["fontSizeUi"], 23);
    assert_eq!(norm_150["fontSizeButton"], 21);
    assert_eq!(norm_150["fontSizeScale"], 1.5);

    // Test default fallback values when None
    let default_settings = ValidatedSettings::default();
    let norm_default = normalize_settings(&default_settings);
    assert_eq!(norm_default["fontSizeTitle"], 28);
    assert_eq!(norm_default["fontSizeUi"], 15);
    assert_eq!(norm_default["fontSizeButton"], 14);
    assert_eq!(norm_default["fontSizeScale"], 1.0);
}
