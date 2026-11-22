use serde::{Deserialize, Serialize};

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
