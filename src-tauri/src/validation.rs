use serde::{Deserialize, Serialize};
use std::collections::HashSet;

pub const LIMIT_BACKUP_BYTES: usize = 32 * 1024 * 1024;
pub const LIMIT_TITLES: usize = 1_000;
pub const LIMIT_CHAPTERS_PER_TITLE: usize = 1_000;
pub const LIMIT_PAGES_PER_TITLE: usize = 100_000;
pub const LIMIT_BACKUP_PAGES: usize = 1_000_000;
pub const LIMIT_BOOKMARKS_PER_CHAPTER: usize = 1_000;
pub const LIMIT_PATH_CHARS: usize = 4_096;
pub const LIMIT_DIRECTORY_DEPTH: usize = 64;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedPage {
    pub name: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(default)]
    pub size: Option<u64>,
    #[serde(default)]
    pub modified: Option<f64>,
    #[serde(default)]
    pub dimensions_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedPosition {
    pub page: u32,
    #[serde(default)]
    pub path: Option<String>,
    pub fraction: f64,
    #[serde(default)]
    pub manga_bookmark: Option<bool>,
    #[serde(default)]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedChapter {
    pub name: String,
    pub pages: Vec<ValidatedPage>,
    #[serde(default)]
    pub read: Option<bool>,
    #[serde(default)]
    pub position: Option<ValidatedPosition>,
    #[serde(default)]
    pub bookmarks: Option<Vec<ValidatedPosition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedManga {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub slug: Option<String>,
    pub chapters: Vec<ValidatedChapter>,
    #[serde(default)]
    pub last_chapter: Option<usize>,
    #[serde(default)]
    pub added_at: Option<f64>,
    #[serde(default)]
    pub updated_at: Option<f64>,
    #[serde(default)]
    pub revision: Option<u64>,
    #[serde(default)]
    pub sort: Option<String>,
    #[serde(default)]
    pub local_path: Option<String>,
    #[serde(default)]
    pub handle: Option<serde_json::Value>,
    #[serde(default)]
    pub cover: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedSettings {
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub mode: Option<String>,
    #[serde(default)]
    pub layout: Option<String>,
    #[serde(default)]
    pub max_width: Option<u32>,
    #[serde(default)]
    pub seconds: Option<f64>,
    #[serde(default)]
    pub advance: Option<bool>,
    #[serde(default)]
    pub reduced: Option<bool>,
    #[serde(default)]
    pub low_quality: Option<bool>,
    #[serde(default)]
    pub custom_seconds: Option<bool>,
    #[serde(default)]
    pub auto_hide_bars: Option<bool>,
    #[serde(default)]
    pub resume_delay: Option<f64>,
    #[serde(default)]
    pub direction: Option<String>,
    #[serde(default)]
    pub spread: Option<bool>,
    #[serde(default)]
    pub single_cover: Option<bool>,
    #[serde(default)]
    pub end_action: Option<String>,
    #[serde(default)]
    pub font_size_title: Option<f64>,
    #[serde(default)]
    pub font_size_ui: Option<f64>,
    #[serde(default)]
    pub font_size_button: Option<f64>,
    #[serde(default)]
    pub confirm_delete: Option<bool>,
    #[serde(default)]
    pub shelf_sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct BackupPayload {
    pub version: u32,
    pub manga: Vec<ValidatedManga>,
    pub settings: ValidatedSettings,
}

pub fn validate_relative_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path must be a non-empty string.".to_string());
    }
    if trimmed.len() > LIMIT_PATH_CHARS {
        return Err(format!(
            "Relative path length (characters) exceeds the limit of {LIMIT_PATH_CHARS}. Use a smaller selection."
        ));
    }
    if trimmed.starts_with('/') || trimmed.ends_with('/') {
        return Err(format!("Path cannot start or end with a slash: \"{trimmed}\""));
    }
    if trimmed.contains('\\') {
        return Err(format!("Path must use forward slashes only: \"{trimmed}\""));
    }
    if trimmed.contains('\0') {
        return Err("Path contains invalid null byte.".to_string());
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err("Path contains invalid control character.".to_string());
    }

    let segments: Vec<&str> = trimmed.split('/').collect();
    if segments.len().saturating_sub(1) > LIMIT_DIRECTORY_DEPTH {
        return Err(format!(
            "Folder depth exceeds the limit of {LIMIT_DIRECTORY_DEPTH}. Use a smaller selection."
        ));
    }
    for seg in &segments {
        if seg.is_empty() || *seg == "." || *seg == ".." {
            return Err(format!("Path contains invalid traversal segment: \"{trimmed}\""));
        }
    }
    Ok(trimmed.to_string())
}

pub fn assert_image_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0 || height == 0 {
        return Err("Image dimensions must be positive integer pixels.".to_string());
    }
    let area = (width as u64).checked_mul(height as u64);
    match area {
        Some(a) if a <= 9_007_199_254_740_991 => Ok(()),
        _ => Err("Image area cannot be represented safely.".to_string()),
    }
}

pub fn validate_page(page: &mut ValidatedPage, seen_paths: &mut HashSet<String>) -> Result<(), String> {
    let trimmed_name = page.name.trim();
    if trimmed_name.is_empty() {
        return Err("Page name must be a non-empty string.".to_string());
    }
    page.name = trimmed_name.to_string();

    let valid_path = validate_relative_path(&page.path)?;
    if seen_paths.contains(&valid_path) {
        return Err(format!("Duplicate page path within chapter: \"{valid_path}\""));
    }
    seen_paths.insert(valid_path.clone());
    page.path = valid_path;

    assert_image_dimensions(page.width, page.height)?;

    if let Some(m) = page.modified {
        if !m.is_finite() || m < 0.0 {
            return Err("Page modified timestamp must be a non-negative number.".to_string());
        }
    }

    Ok(())
}

pub fn validate_position(
    pos: &mut ValidatedPosition,
    pages_count: usize,
) -> Result<(), String> {
    if pages_count == 0 {
        return Err("Position cannot be resolved against an empty chapter.".to_string());
    }

    if !pos.fraction.is_finite() {
        return Err("Position fraction must be a finite number.".to_string());
    }
    pos.fraction = pos.fraction.clamp(0.0, 1.0);

    if let Some(p) = &pos.path {
        pos.path = Some(validate_relative_path(p)?);
    }

    if let Some(ts) = pos.timestamp {
        if !ts.is_finite() {
            return Err("Position timestamp must be a finite number.".to_string());
        }
    }

    if (pos.page as usize) >= pages_count {
        pos.page = (pages_count - 1) as u32;
    }

    Ok(())
}

pub fn validate_chapter(
    chapter: &mut ValidatedChapter,
    chapter_index: usize,
) -> Result<usize, String> {
    let trimmed_name = chapter.name.trim();
    if trimmed_name.is_empty() {
        return Err(format!("Chapter {} name must be a non-empty string.", chapter_index + 1));
    }
    chapter.name = trimmed_name.to_string();

    if chapter.pages.is_empty() {
        return Err(format!("Chapter \"{}\" must contain at least one page.", chapter.name));
    }

    let mut seen_paths = HashSet::new();
    for (idx, page) in chapter.pages.iter_mut().enumerate() {
        validate_page(page, &mut seen_paths).map_err(|e| {
            format!("Chapter \"{}\" page {} is invalid: {e}", chapter.name, idx + 1)
        })?;
    }

    let page_count = chapter.pages.len();

    if let Some(pos) = &mut chapter.position {
        validate_position(pos, page_count)?;
    }

    if let Some(bms) = &mut chapter.bookmarks {
        if bms.len() > LIMIT_BOOKMARKS_PER_CHAPTER {
            return Err(format!(
                "Bookmarks per chapter exceeds the limit of {LIMIT_BOOKMARKS_PER_CHAPTER}. Use a smaller selection."
            ));
        }

        let mut seen_bms = HashSet::new();
        let mut valid_bms = Vec::new();
        for bm in bms.iter_mut() {
            if validate_position(bm, page_count).is_ok() {
                let key = format!("{}:{}", bm.page, bm.path.as_deref().unwrap_or(""));
                if seen_bms.insert(key) {
                    valid_bms.push(bm.clone());
                }
            }
        }
        *bms = valid_bms;
    }

    Ok(page_count)
}

pub fn validate_manga(
    manga: &mut ValidatedManga,
    seen_ids: &mut HashSet<String>,
) -> Result<usize, String> {
    let trimmed_id = manga.id.trim();
    if trimmed_id.is_empty() {
        return Err("Manga ID must be a non-empty string.".to_string());
    }
    if !seen_ids.insert(trimmed_id.to_string()) {
        return Err(format!("Duplicate manga ID found in backup: \"{trimmed_id}\""));
    }
    manga.id = trimmed_id.to_string();

    let trimmed_title = manga.title.trim();
    if trimmed_title.is_empty() {
        return Err("Manga title must be a non-empty string.".to_string());
    }
    manga.title = trimmed_title.to_string();

    if manga.chapters.is_empty() {
        return Err(format!("Manga \"{}\" must contain at least one chapter.", manga.title));
    }
    if manga.chapters.len() > LIMIT_CHAPTERS_PER_TITLE {
        return Err(format!(
            "Chapters per title exceeds the limit of {LIMIT_CHAPTERS_PER_TITLE}. Use a smaller selection."
        ));
    }

    let mut total_pages = 0;
    for (idx, ch) in manga.chapters.iter_mut().enumerate() {
        let ch_pages = validate_chapter(ch, idx)?;
        total_pages += ch_pages;
        if total_pages > LIMIT_PAGES_PER_TITLE {
            return Err(format!(
                "Pages per title exceeds the limit of {LIMIT_PAGES_PER_TITLE}. Use a smaller selection."
            ));
        }
    }

    let chapter_count = manga.chapters.len();
    let last_chapter = manga.last_chapter.unwrap_or(0);
    manga.last_chapter = Some(last_chapter.min(chapter_count.saturating_sub(1)));

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;

    manga.added_at = Some(manga.added_at.filter(|t| t.is_finite() && *t > 0.0).unwrap_or(now));
    manga.updated_at = Some(manga.updated_at.filter(|t| t.is_finite() && *t > 0.0).unwrap_or(now));

    if let Some(sort) = &manga.sort {
        if sort != "name" && sort != "reverse" && sort != "natural" {
            manga.sort = None;
        }
    }

    if manga.slug.as_ref().map_or(true, |s| s.trim().is_empty()) {
        manga.slug = Some(
            manga
                .title
                .to_lowercase()
                .chars()
                .map(|c| if c.is_alphanumeric() { c } else { '-' })
                .collect::<String>(),
        );
    }

    Ok(total_pages)
}

pub fn normalize_settings(settings: &ValidatedSettings) -> serde_json::Value {
    let theme = match settings.theme.as_deref() {
        Some("light") => "light",
        Some("dark") => "dark",
        _ => "system",
    };
    let mode = match settings.mode.as_deref() {
        Some("single") => "single",
        _ => "continuous",
    };
    let layout = match settings.layout.as_deref() {
        Some("width") => "width",
        Some("height") => "height",
        Some("auto") => "auto",
        _ => "max",
    };
    let max_width = match settings.max_width {
        Some(920) | Some(1024) | Some(1280) | Some(0) => settings.max_width.unwrap(),
        _ => 920,
    };
    let seconds = settings
        .seconds
        .filter(|s| s.is_finite())
        .map(|s| s.clamp(0.5, 120.0))
        .unwrap_or(3.0);
    let advance = settings.advance.unwrap_or(true);
    let reduced = settings.reduced.unwrap_or(false);
    let low_quality = settings.low_quality.unwrap_or(false);
    let custom_seconds = settings.custom_seconds.unwrap_or_else(|| {
        ![2.0, 3.0, 4.0, 5.0].contains(&seconds)
    });
    let auto_hide_bars = settings.auto_hide_bars.unwrap_or(true);
    let resume_delay = settings
        .resume_delay
        .filter(|r| r.is_finite())
        .map(|r| r.clamp(0.5, 15.0))
        .unwrap_or(1.8);
    let direction = match settings.direction.as_deref() {
        Some("rtl") => "rtl",
        _ => "ltr",
    };
    let spread = settings.spread.unwrap_or(false);
    let single_cover = settings.single_cover.unwrap_or(true);
    let end_action = match settings.end_action.as_deref() {
        Some("stop") => "stop",
        Some("replay") => "replay",
        Some("next") => "next",
        _ => if !advance { "stop" } else { "next" },
    };
    let font_size_title = settings
        .font_size_title
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 36.0) as u32)
        .unwrap_or(15);
    let font_size_ui = settings
        .font_size_ui
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 36.0) as u32)
        .unwrap_or(15);
    let font_size_button = settings
        .font_size_button
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 36.0) as u32)
        .unwrap_or(15);
    let confirm_delete = settings.confirm_delete.unwrap_or(false);

    let mut map = serde_json::Map::new();
    map.insert("theme".into(), theme.into());
    map.insert("mode".into(), mode.into());
    map.insert("layout".into(), layout.into());
    map.insert("maxWidth".into(), max_width.into());
    map.insert("seconds".into(), seconds.into());
    map.insert("advance".into(), advance.into());
    map.insert("reduced".into(), reduced.into());
    map.insert("lowQuality".into(), low_quality.into());
    map.insert("customSeconds".into(), custom_seconds.into());
    map.insert("autoHideBars".into(), auto_hide_bars.into());
    map.insert("resumeDelay".into(), resume_delay.into());
    map.insert("direction".into(), direction.into());
    map.insert("spread".into(), spread.into());
    map.insert("singleCover".into(), single_cover.into());
    map.insert("endAction".into(), end_action.into());
    map.insert("fontSizeTitle".into(), font_size_title.into());
    map.insert("fontSizeUi".into(), font_size_ui.into());
    map.insert("fontSizeButton".into(), font_size_button.into());
    map.insert("confirmDelete".into(), confirm_delete.into());

    if let Some(sort) = &settings.shelf_sort {
        if sort == "recent" || sort == "title" || sort == "added" || sort == "progress" {
            map.insert("shelfSort".into(), sort.as_str().into());
        }
    }

    serde_json::Value::Object(map)
}

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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_validate_relative_path_traversal() {
        assert!(validate_relative_path("ch1/01.jpg").is_ok());
        assert!(validate_relative_path("../ch1/01.jpg").is_err());
        assert!(validate_relative_path("/ch1/01.jpg").is_err());
        assert!(validate_relative_path("ch1/01.jpg/").is_err());
        assert!(validate_relative_path("ch1\\01.jpg").is_err());
        assert!(validate_relative_path("ch1/./01.jpg").is_err());
        assert!(validate_relative_path("ch1/../01.jpg").is_err());
        assert!(validate_relative_path("ch1/\001.jpg").is_err());
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
}

