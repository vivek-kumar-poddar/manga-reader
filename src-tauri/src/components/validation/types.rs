use serde::{Deserialize, Serialize};

pub const LIMIT_BACKUP_BYTES: usize = 32 * 1024 * 1024;
pub const LIMIT_TITLES: usize = 1_000;
pub const LIMIT_CHAPTERS_PER_TITLE: usize = 1_000;
pub const LIMIT_PAGES_PER_TITLE: usize = 100_000;
pub const LIMIT_BACKUP_PAGES: usize = 1_000_000;
pub const LIMIT_BOOKMARKS_PER_CHAPTER: usize = 1_000;
pub const LIMIT_PATH_CHARS: usize = 4_096;
pub const LIMIT_DIRECTORY_DEPTH: usize = 64;

pub const RESERVED_DOS_NAMES: &[&str] = &[
    "con", "prn", "aux", "nul", "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8",
    "com9", "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
];

pub fn now_ms() -> f64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedPage {
    pub name: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub modified: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dimensions_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedPosition {
    pub page: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    pub fraction: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manga_bookmark: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedChapter {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub name: String,
    pub pages: Vec<ValidatedPage>,
    #[serde(default)]
    pub read: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub position: Option<ValidatedPosition>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub bookmarks: Option<Vec<ValidatedPosition>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct ValidatedManga {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub handle: Option<serde_json::Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cover: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedSummary {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub chapter_count: usize,
    pub chapters_read: usize,
    pub last_chapter: usize,
    pub last_chapter_name: String,
    pub has_progress: bool,
    pub indexed_at: f64,
    pub added_at: f64,
    pub updated_at: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub revision: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub local_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
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
