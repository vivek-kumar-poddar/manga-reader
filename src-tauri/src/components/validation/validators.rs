use std::collections::HashSet;

use super::path::{assert_image_dimensions, validate_relative_path};
use super::types::{
    now_ms, LIMIT_BOOKMARKS_PER_CHAPTER, LIMIT_CHAPTERS_PER_TITLE, LIMIT_PAGES_PER_TITLE,
    ValidatedChapter, ValidatedManga, ValidatedPage, ValidatedPosition, ValidatedSummary,
};

pub fn matching_position_internal(
    saved: &ValidatedPosition,
    pages: &[ValidatedPage],
    old_pages: &[ValidatedPage],
) -> Option<ValidatedPosition> {
    if pages.is_empty() {
        return None;
    }
    let path = saved
        .path
        .clone()
        .or_else(|| old_pages.get(saved.page as usize).map(|p| p.path.clone()));

    let mut page_idx = path
        .as_ref()
        .and_then(|target| pages.iter().position(|p| &p.path == target));

    if page_idx.is_none() {
        if let Some(ref target) = path {
            let leaf = target.rsplit('/').next().unwrap_or(target);
            let matches: Vec<usize> = pages
                .iter()
                .enumerate()
                .filter(|(_, p)| p.name == leaf)
                .map(|(i, _)| i)
                .collect();
            if matches.len() == 1 {
                page_idx = Some(matches[0]);
            }
        }
    }

    let valid_index = page_idx.unwrap_or_else(|| (saved.page as usize).min(pages.len() - 1));
    let fraction = if saved.fraction.is_finite() {
        saved.fraction.clamp(0.0, 1.0)
    } else {
        0.0
    };

    Some(ValidatedPosition {
        page: valid_index as u32,
        path: Some(pages[valid_index].path.clone()),
        fraction,
        manga_bookmark: if saved.manga_bookmark == Some(true) {
            Some(true)
        } else {
            None
        },
        timestamp: saved.timestamp.filter(|t| t.is_finite()),
    })
}

pub fn validate_page(
    page: &mut ValidatedPage,
    seen_paths: &mut HashSet<String>,
) -> Result<(), String> {
    let trimmed_name = page.name.trim();
    if trimmed_name.is_empty() {
        return Err("Page name must be a non-empty string.".to_string());
    }
    page.name = trimmed_name.to_string();

    let valid_path = validate_relative_path(&page.path)?;
    if seen_paths.contains(&valid_path) {
        return Err(format!(
            "Duplicate page path within chapter: \"{valid_path}\""
        ));
    }
    seen_paths.insert(valid_path.clone());
    page.path = valid_path;

    let is_pending_zero =
        page.dimensions_pending == Some(true) && page.width == 0 && page.height == 0;
    if !is_pending_zero {
        assert_image_dimensions(page.width, page.height)?;
    }

    if let Some(m) = page.modified {
        if !m.is_finite() || m < 0.0 {
            return Err("Page modified timestamp must be a non-negative number.".to_string());
        }
    }

    Ok(())
}

pub fn validate_position(pos: &mut ValidatedPosition, pages_count: usize) -> Result<(), String> {
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
        return Err(format!(
            "Chapter {} name must be a non-empty string.",
            chapter_index + 1
        ));
    }
    chapter.name = trimmed_name.to_string();

    if let Some(ref id) = chapter.id {
        let trimmed_id = id.trim();
        chapter.id = if trimmed_id.is_empty() {
            None
        } else {
            Some(trimmed_id.to_string())
        };
    }

    if chapter.pages.is_empty() {
        return Err(format!(
            "Chapter \"{}\" must contain at least one page.",
            chapter.name
        ));
    }

    let mut seen_paths = HashSet::new();
    for (idx, page) in chapter.pages.iter_mut().enumerate() {
        validate_page(page, &mut seen_paths).map_err(|e| {
            format!(
                "Chapter \"{}\" page {} is invalid: {e}",
                chapter.name,
                idx + 1
            )
        })?;
    }

    let page_count = chapter.pages.len();

    if let Some(pos) = &mut chapter.position {
        validate_position(pos, page_count)?;
        if let Some(matched) = matching_position_internal(pos, &chapter.pages, &[]) {
            *pos = matched;
        }
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
                if let Some(matched) = matching_position_internal(bm, &chapter.pages, &[]) {
                    let key = format!(
                        "{}:{}:{}",
                        matched.page,
                        matched.path.as_deref().unwrap_or(""),
                        matched.manga_bookmark.unwrap_or(false)
                    );
                    if seen_bms.insert(key) {
                        valid_bms.push(matched);
                    }
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
        return Err(format!(
            "Duplicate manga ID found in backup: \"{trimmed_id}\""
        ));
    }
    manga.id = trimmed_id.to_string();

    let trimmed_title = manga.title.trim();
    if trimmed_title.is_empty() {
        return Err("Manga title must be a non-empty string.".to_string());
    }
    manga.title = trimmed_title.to_string();

    if manga.chapters.is_empty() {
        return Err(format!(
            "Manga \"{}\" must contain at least one chapter.",
            manga.title
        ));
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

    let now = now_ms();

    manga.added_at = Some(
        manga
            .added_at
            .filter(|t| t.is_finite() && *t > 0.0)
            .unwrap_or(now),
    );
    manga.updated_at = Some(
        manga
            .updated_at
            .filter(|t| t.is_finite() && *t > 0.0)
            .unwrap_or(now),
    );
    manga.revision = Some(manga.revision.unwrap_or(1));

    if let Some(sort) = &manga.sort {
        if sort != "name" && sort != "reverse" && sort != "natural" {
            manga.sort = None;
        }
    }

    if let Some(ref lp) = manga.local_path {
        let trimmed_lp = lp.trim();
        manga.local_path = if trimmed_lp.is_empty() {
            None
        } else {
            Some(trimmed_lp.to_string())
        };
    }

    if manga.slug.as_ref().is_none_or(|s| s.trim().is_empty()) {
        manga.slug = Some(crate::commands::indexing::generate_slug(&manga.title));
    } else if let Some(ref s) = manga.slug {
        manga.slug = Some(s.trim().to_string());
    }

    Ok(total_pages)
}

pub fn parse_summary_internal(value: &serde_json::Value) -> Option<ValidatedSummary> {
    let obj = value.as_object()?;
    let id = obj.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }
    let title = obj.get("title")?.as_str()?.trim();
    if title.is_empty() {
        return None;
    }

    let slug = obj
        .get("slug")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| crate::commands::indexing::generate_slug(title));

    let chapter_count = obj
        .get("chapterCount")
        .and_then(|v| v.as_u64())
        .unwrap_or(0) as usize;

    let chapters_read = obj
        .get("chaptersRead")
        .and_then(|v| v.as_u64())
        .map(|v| (v as usize).min(chapter_count))
        .unwrap_or(0);

    let last_chapter = obj
        .get("lastChapter")
        .and_then(|v| v.as_u64())
        .map(|v| (v as usize).min(chapter_count.saturating_sub(1)))
        .unwrap_or(0);

    let last_chapter_name = obj
        .get("lastChapterName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let has_progress = obj
        .get("hasProgress")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let now = now_ms();
    let indexed_at = obj
        .get("indexedAt")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(now);

    let added_at = obj
        .get("addedAt")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(now);

    let updated_at = obj
        .get("updatedAt")
        .and_then(|v| v.as_f64())
        .filter(|v| v.is_finite() && *v > 0.0)
        .unwrap_or(now);

    let revision = obj.get("revision").and_then(|v| v.as_u64());

    let local_path = obj
        .get("localPath")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let sort = obj
        .get("sort")
        .and_then(|v| v.as_str())
        .filter(|&s| s == "name" || s == "reverse" || s == "natural")
        .map(|s| s.to_string());

    Some(ValidatedSummary {
        id: id.to_string(),
        title: title.to_string(),
        slug,
        chapter_count,
        chapters_read,
        last_chapter,
        last_chapter_name,
        has_progress,
        indexed_at,
        added_at,
        updated_at,
        revision,
        local_path,
        sort,
    })
}
