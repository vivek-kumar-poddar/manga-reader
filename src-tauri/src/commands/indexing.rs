use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

use crate::commands::fs::{
    natural_order, parse_image_dimensions, AllowedRoots, ALLOWED_IMAGE_EXTENSIONS,
    IGNORED_FOLDER_NAMES, MAX_DEPTH, MAX_SCAN_FILES, SCAN_BATCH_SIZE,
};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct IndexOptions {
    pub sort: Option<String>,
    pub previous: Option<PreviousMangaDto>,
    pub warm_chapters: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousMangaDto {
    pub id: String,
    pub title: String,
    pub slug: Option<String>,
    pub last_chapter: Option<usize>,
    pub added_at: Option<f64>,
    pub revision: Option<u64>,
    pub chapters: Vec<PreviousChapterDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousChapterDto {
    pub name: String,
    pub read: Option<bool>,
    pub position: Option<PositionDto>,
    pub bookmarks: Option<Vec<PositionDto>>,
    pub pages: Vec<PreviousPageDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviousPageDto {
    pub name: String,
    pub path: String,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub size: Option<u64>,
    pub modified: Option<f64>,
    pub dimensions_pending: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PositionDto {
    pub page: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fraction: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manga_bookmark: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageDto {
    pub name: String,
    pub path: String,
    pub width: u32,
    pub height: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub modified: Option<f64>,
    pub dimensions_pending: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChapterDto {
    pub name: String,
    pub pages: Vec<PageDto>,
    pub read: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<PositionDto>,
    pub bookmarks: Vec<PositionDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanIssue {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TitleDto {
    pub id: String,
    pub title: String,
    pub slug: String,
    pub local_path: String,
    pub last_chapter: usize,
    pub added_at: f64,
    pub updated_at: f64,
    pub revision: u64,
    pub sort: String,
    pub chapters: Vec<ChapterDto>,
    pub cover_path: Option<String>,
    pub issues: Vec<ScanIssue>,
    pub reused: usize,
}

/// Generates a clean URL slug from a title string.
pub fn generate_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut prev_dash = false;
    for c in name.chars() {
        if c.is_alphanumeric() {
            for lc in c.to_lowercase() {
                slug.push(lc);
            }
            prev_dash = false;
        } else if !prev_dash && !slug.is_empty() {
            slug.push('-');
            prev_dash = true;
        }
        if slug.len() >= 100 {
            break;
        }
    }
    let trimmed = slug.trim_matches('-');
    if trimmed.is_empty() {
        "manga".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Resolves a reading position against a chapter's newly indexed pages list.
pub fn matching_position(
    p: &PositionDto,
    pages: &[PageDto],
    old_pages: &[PreviousPageDto],
) -> Option<PositionDto> {
    if pages.is_empty() {
        return None;
    }

    let target_path = p
        .path
        .clone()
        .or_else(|| old_pages.get(p.page).map(|pg| pg.path.clone()));

    let mut page_idx = target_path
        .as_ref()
        .and_then(|tp| pages.iter().position(|x| &x.path == tp));

    // If path not found, try matching by leaf file name
    if page_idx.is_none() {
        if let Some(tp) = target_path.as_ref() {
            let leaf = tp.rsplit('/').next().unwrap_or(tp);
            let matches: Vec<usize> = pages
                .iter()
                .enumerate()
                .filter(|(_, x)| x.name == leaf)
                .map(|(i, _)| i)
                .collect();
            if matches.len() == 1 {
                page_idx = Some(matches[0]);
            }
        }
    }

    // Fall back to clamping by index
    let valid_idx = page_idx
        .unwrap_or_else(|| p.page.min(pages.len().saturating_sub(1)));
    let fraction = p
        .fraction
        .map(|f| if f.is_nan() { 0.0 } else { f.clamp(0.0, 1.0) });

    Some(PositionDto {
        page: valid_idx,
        path: Some(pages[valid_idx].path.clone()),
        fraction,
        manga_bookmark: p.manga_bookmark,
        timestamp: p.timestamp,
    })
}

/// Matches a newly indexed chapter against an existing manga record.
pub fn chapter_match<'a>(
    name: &str,
    pages: &[PageDto],
    previous: Option<&'a PreviousMangaDto>,
) -> Option<&'a PreviousChapterDto> {
    let prev = previous?;

    // 1. Exact name match
    if let Some(exact) = prev.chapters.iter().find(|c| c.name == name) {
        return Some(exact);
    }

    // 2. Renamed chapter matching: same page count and all page signatures match
    fn sig(name: &str, size: Option<u64>, modified: Option<f64>) -> String {
        format!(
            "{}\0{}\0{}",
            name,
            size.unwrap_or(0),
            modified.map(|m| m.round() as i64).unwrap_or(0)
        )
    }

    let current_signatures: HashSet<String> = pages
        .iter()
        .map(|p| sig(&p.name, p.size, p.modified))
        .collect();

    let candidate_matches: Vec<&'a PreviousChapterDto> = prev
        .chapters
        .iter()
        .filter(|c| {
            if c.pages.len() != pages.len() {
                return false;
            }
            c.pages
                .iter()
                .all(|p| current_signatures.contains(&sig(&p.name, p.size, p.modified)))
        })
        .collect();

    if candidate_matches.len() == 1 {
        Some(candidate_matches[0])
    } else {
        None
    }
}

#[derive(Debug, Clone)]
struct ScannedFile {
    rel_path: String,
    abs_path: PathBuf,
    name: String,
    size: u64,
    modified: f64,
}

#[tauri::command]
pub async fn index_title(
    app: AppHandle,
    root: String,
    options: Option<IndexOptions>,
    on_progress: tauri::ipc::Channel<ScanProgress>,
) -> Result<TitleDto, String> {
    let raw_path = Path::new(root.trim());
    if !raw_path.exists() || !raw_path.is_dir() {
        return Err(format!("Target path '{}' is not an existing directory", root));
    }

    let root_path = dunce::canonicalize(raw_path).unwrap_or_else(|_| raw_path.to_path_buf());

    // Security check: must be under allowed library roots
    let allowed = app.state::<AllowedRoots>();
    if !allowed.is_allowed(&root_path) {
        // Auto-allow if user explicitly selected this folder
        allowed.add_root(root_path.clone());
    }

    let opts = options.unwrap_or_default();
    let sort_mode = opts.sort.unwrap_or_else(|| "natural".to_string());
    let warm_count = opts.warm_chapters.unwrap_or(5);

    let folder_name = root_path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "Manga".to_string());

    let root_clone = root_path.clone();

    // 1. Recursive directory scan
    let scanned_files = tokio::task::spawn_blocking(move || {
        let mut files = Vec::new();
        let walker = walkdir::WalkDir::new(&root_clone)
            .max_depth(MAX_DEPTH)
            .follow_links(false)
            .into_iter()
            .filter_entry(|entry| {
                if entry.depth() == 0 {
                    return true;
                }
                let name = entry.file_name().to_string_lossy().to_lowercase();
                if entry.file_type().is_dir() {
                    if name.starts_with('.') || IGNORED_FOLDER_NAMES.contains(&name.as_str()) {
                        return false;
                    }
                }
                true
            });

        for entry_res in walker {
            if files.len() >= MAX_SCAN_FILES {
                break;
            }
            let entry = match entry_res {
                Ok(e) => e,
                Err(_) => continue,
            };

            if !entry.file_type().is_file() {
                continue;
            }

            let file_path = entry.path();
            let ext = match file_path.extension() {
                Some(e) => e.to_string_lossy().to_lowercase(),
                None => continue,
            };

            if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
                continue;
            }

            let metadata = match entry.metadata() {
                Ok(m) => m,
                Err(_) => continue,
            };

            let rel_path = match file_path.strip_prefix(&root_clone) {
                Ok(p) => p.to_string_lossy().replace('\\', "/"),
                Err(_) => continue,
            };

            let file_name = file_path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| rel_path.clone());

            let modified = metadata
                .modified()
                .ok()
                .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as f64)
                .unwrap_or(0.0);

            files.push(ScannedFile {
                rel_path,
                abs_path: file_path.to_path_buf(),
                name: file_name,
                size: metadata.len(),
                modified,
            });
        }
        files
    })
    .await
    .map_err(|e| format!("Scan error: {e}"))?;

    let total_scanned = scanned_files.len();
    if total_scanned == 0 {
        return Err("No image pages found in this selection.".to_string());
    }

    let _ = on_progress.send(ScanProgress {
        phase: "discover".to_string(),
        done: total_scanned,
        total: total_scanned,
        title: folder_name.clone(),
    });

    // 2. Build lookup for previous dimensions reuse
    let mut old_pages_map: HashMap<String, PreviousPageDto> = HashMap::new();
    if let Some(ref prev) = opts.previous {
        for ch in &prev.chapters {
            for pg in &ch.pages {
                old_pages_map.insert(pg.path.clone(), pg.clone());
            }
        }
    }

    // 3. Chapter grouping and cover detection
    let mut cover_candidate: Option<PathBuf> = None;
    let mut grouped_pages: HashMap<String, Vec<PageDto>> = HashMap::new();
    let mut reused_count = 0;

    let has_multiple_files = total_scanned > 1;

    for file in &scanned_files {
        let parts: Vec<&str> = file.rel_path.split('/').collect();
        let is_root = parts.len() == 1;

        if is_root && has_multiple_files {
            let lower = file.name.to_lowercase();
            if lower.starts_with("cover.") || lower.starts_with("thumbnail.") {
                if cover_candidate.is_none() {
                    cover_candidate = Some(file.abs_path.clone());
                }
                continue;
            }
        }

        let chapter_name = if is_root {
            "Root pages".to_string()
        } else {
            parts[..parts.len() - 1].join(" / ")
        };

        let mut width = 800;
        let mut height = 1200;
        let mut dimensions_pending = true;

        if let Some(cached) = old_pages_map.get(&file.rel_path) {
            let not_pending = !cached.dimensions_pending.unwrap_or(false);
            let size_matches = cached.size == Some(file.size);
            let mtime_matches = cached
                .modified
                .map(|m| (m - file.modified).abs() < 1000.0)
                .unwrap_or(false);

            if not_pending && size_matches && mtime_matches {
                if let (Some(w), Some(h)) = (cached.width, cached.height) {
                    if w > 0 && h > 0 {
                        width = w;
                        height = h;
                        dimensions_pending = false;
                        reused_count += 1;
                    }
                }
            }
        }

        grouped_pages
            .entry(chapter_name)
            .or_default()
            .push(PageDto {
                name: file.name.clone(),
                path: file.rel_path.clone(),
                width,
                height,
                size: Some(file.size),
                modified: Some(file.modified),
                dimensions_pending,
            });
    }

    if grouped_pages.is_empty() {
        return Err("No valid chapters or readable pages found in selection.".to_string());
    }

    // 4. Sort chapter names according to sort option
    let sort_cmp = |a: &str, b: &str| -> std::cmp::Ordering {
        match sort_mode.as_str() {
            "name" => a.cmp(b),
            "reverse" => natural_order(b, a),
            _ => natural_order(a, b),
        }
    };

    let mut chapter_names: Vec<String> = grouped_pages.keys().cloned().collect();
    chapter_names.sort_by(|a, b| sort_cmp(a, b));

    // Sort pages within each chapter
    for pages in grouped_pages.values_mut() {
        pages.sort_by(|a, b| sort_cmp(&a.name, &b.name));
    }

    // 5. Dimension extraction for warm chapters (first N chapters, default 5)
    let warm_names: Vec<String> = chapter_names.iter().take(warm_count).cloned().collect();

    // Collect pending pages from warm chapters
    let mut pending_warm: Vec<(String, PathBuf)> = Vec::new();
    for name in &warm_names {
        if let Some(pages) = grouped_pages.get(name) {
            for p in pages {
                if p.dimensions_pending {
                    let abs = root_path.join(p.path.replace('/', std::path::MAIN_SEPARATOR_STR));
                    pending_warm.push((p.path.clone(), abs));
                }
            }
        }
    }

    let total_pending = pending_warm.len();
    if total_pending > 0 {
        let _ = on_progress.send(ScanProgress {
            phase: "index".to_string(),
            done: 0,
            total: total_pending,
            title: format!("{folder_name} · first {warm_count} chapters"),
        });

        let mut done = 0;
        let mut parsed_results: HashMap<String, (u32, u32)> = HashMap::with_capacity(total_pending);

        for chunk in pending_warm.chunks(SCAN_BATCH_SIZE) {
            let chunk_vec = chunk.to_vec();
            let parsed_batch: Vec<(String, Option<u32>, Option<u32>)> =
                tokio::task::spawn_blocking(move || {
                    chunk_vec
                        .into_par_iter()
                        .map(|(rel, abs)| {
                            let (w, h) = parse_image_dimensions(&abs);
                            (rel, w, h)
                        })
                        .collect()
                })
                .await
                .map_err(|e| format!("Parse join error: {e}"))?;

            done += parsed_batch.len();
            for (rel, w, h) in parsed_batch {
                if let (Some(width), Some(height)) = (w, h) {
                    if width > 0 && height > 0 {
                        parsed_results.insert(rel, (width, height));
                    }
                }
            }

            let _ = on_progress.send(ScanProgress {
                phase: "index".to_string(),
                done,
                total: total_pending,
                title: format!("{folder_name} · first {warm_count} chapters"),
            });
            tokio::task::yield_now().await;
        }

        // Apply parsed dimensions back to warm chapters
        for name in &warm_names {
            if let Some(pages) = grouped_pages.get_mut(name) {
                for p in pages.iter_mut() {
                    if let Some(&(w, h)) = parsed_results.get(&p.path) {
                        p.width = w;
                        p.height = h;
                        p.dimensions_pending = false;
                    }
                }
            }
        }
    }

    // 6. Re-link matching and chapters construction
    let mut final_chapters = Vec::with_capacity(chapter_names.len());

    for name in chapter_names {
        let pages = grouped_pages.remove(&name).unwrap_or_default();
        let old_match = chapter_match(&name, &pages, opts.previous.as_ref());

        let (read, position, bookmarks) = if let Some(old) = old_match {
            let old_names: HashSet<&str> = old.pages.iter().map(|p| p.name.as_str()).collect();
            let read = old.read.unwrap_or(false)
                && pages.iter().all(|p| old_names.contains(p.name.as_str()));

            let position = old
                .position
                .as_ref()
                .and_then(|pos| matching_position(pos, &pages, &old.pages));

            let bookmarks = old
                .bookmarks
                .as_ref()
                .map(|bms| {
                    bms.iter()
                        .filter_map(|bm| matching_position(bm, &pages, &old.pages))
                        .collect()
                })
                .unwrap_or_default();

            (read, position, bookmarks)
        } else {
            (false, None, Vec::new())
        };

        final_chapters.push(ChapterDto {
            name,
            pages,
            read,
            position,
            bookmarks,
        });
    }

    // 7. Cover identification and thumbnail generation
    let first_page_abs = final_chapters
        .first()
        .and_then(|c| c.pages.first())
        .map(|p| root_path.join(p.path.replace('/', std::path::MAIN_SEPARATOR_STR)));

    let cover_abs = cover_candidate.or(first_page_abs);

    let title_name = opts
        .previous
        .as_ref()
        .map(|p| p.title.clone())
        .unwrap_or_else(|| folder_name.clone());

    let manga_id = opts
        .previous
        .as_ref()
        .map(|p| p.id.clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let slug = opts
        .previous
        .as_ref()
        .and_then(|p| p.slug.clone())
        .unwrap_or_else(|| generate_slug(&title_name));

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as f64;

    let added_at = opts
        .previous
        .as_ref()
        .and_then(|p| p.added_at)
        .unwrap_or(now);

    let revision = opts
        .previous
        .as_ref()
        .and_then(|p| p.revision)
        .unwrap_or(1);

    let last_chapter = opts
        .previous
        .as_ref()
        .and_then(|p| p.last_chapter)
        .unwrap_or(0)
        .min(final_chapters.len().saturating_sub(1));

    let mut final_cover_path: Option<String> = None;
    if let Some(cover_file) = cover_abs {
        final_cover_path = Some(cover_file.to_string_lossy().to_string());
        // Generate native thumbnail directly to disk cache
        let _ = crate::commands::image::generate_thumbnail_direct(&app, &cover_file, &manga_id);
    }

    Ok(TitleDto {
        id: manga_id,
        title: title_name,
        slug,
        local_path: root_path.to_string_lossy().to_string(),
        last_chapter,
        added_at,
        updated_at: now,
        revision,
        sort: sort_mode,
        chapters: final_chapters,
        cover_path: final_cover_path,
        issues: Vec::new(),
        reused: reused_count,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_slug() {
        assert_eq!(generate_slug("One Piece (Digital)"), "one-piece-digital");
        assert_eq!(generate_slug("Attack on Titan: Vol 1"), "attack-on-titan-vol-1");
        assert_eq!(generate_slug("   "), "manga");
        assert_eq!(generate_slug("---"), "manga");
    }

    #[test]
    fn test_matching_position_exact_path() {
        let pages = vec![
            PageDto {
                name: "01.jpg".into(),
                path: "ch1/01.jpg".into(),
                width: 800,
                height: 1200,
                size: Some(100),
                modified: Some(1000.0),
                dimensions_pending: false,
            },
            PageDto {
                name: "02.jpg".into(),
                path: "ch1/02.jpg".into(),
                width: 800,
                height: 1200,
                size: Some(100),
                modified: Some(1000.0),
                dimensions_pending: false,
            },
        ];

        let pos = PositionDto {
            page: 0,
            path: Some("ch1/02.jpg".into()),
            fraction: Some(0.4),
            manga_bookmark: Some(true),
            timestamp: Some(12345.0),
        };

        let matched = matching_position(&pos, &pages, &[]).expect("should match");
        assert_eq!(matched.page, 1);
        assert_eq!(matched.path, Some("ch1/02.jpg".into()));
        assert_eq!(matched.fraction, Some(0.4));
        assert_eq!(matched.manga_bookmark, Some(true));
        assert_eq!(matched.timestamp, Some(12345.0));
    }

    #[test]
    fn test_matching_position_leaf_fallback() {
        let pages = vec![PageDto {
            name: "02.jpg".into(),
            path: "new_folder/02.jpg".into(),
            width: 800,
            height: 1200,
            size: Some(100),
            modified: Some(1000.0),
            dimensions_pending: false,
        }];

        let pos = PositionDto {
            page: 5,
            path: Some("old_folder/02.jpg".into()),
            fraction: Some(0.5),
            manga_bookmark: None,
            timestamp: None,
        };

        let matched = matching_position(&pos, &pages, &[]).expect("should match");
        assert_eq!(matched.page, 0);
        assert_eq!(matched.path, Some("new_folder/02.jpg".into()));
        assert_eq!(matched.fraction, Some(0.5));
    }

    #[test]
    fn test_chapter_match_exact_and_renamed() {
        let pages = vec![
            PageDto {
                name: "01.jpg".into(),
                path: "new_ch1/01.jpg".into(),
                width: 800,
                height: 1200,
                size: Some(100),
                modified: Some(1000.0),
                dimensions_pending: false,
            },
            PageDto {
                name: "02.jpg".into(),
                path: "new_ch1/02.jpg".into(),
                width: 800,
                height: 1200,
                size: Some(200),
                modified: Some(2000.0),
                dimensions_pending: false,
            },
        ];

        let prev = PreviousMangaDto {
            id: "m-1".into(),
            title: "Title".into(),
            slug: Some("title".into()),
            last_chapter: Some(0),
            added_at: Some(1000.0),
            revision: Some(2),
            chapters: vec![
                PreviousChapterDto {
                    name: "Old Ch 1".into(),
                    read: Some(true),
                    position: None,
                    bookmarks: None,
                    pages: vec![
                        PreviousPageDto {
                            name: "01.jpg".into(),
                            path: "old_ch1/01.jpg".into(),
                            width: Some(800),
                            height: Some(1200),
                            size: Some(100),
                            modified: Some(1000.0),
                            dimensions_pending: Some(false),
                        },
                        PreviousPageDto {
                            name: "02.jpg".into(),
                            path: "old_ch1/02.jpg".into(),
                            width: Some(800),
                            height: Some(1200),
                            size: Some(200),
                            modified: Some(2000.0),
                            dimensions_pending: Some(false),
                        },
                    ],
                },
                PreviousChapterDto {
                    name: "Exact Chapter".into(),
                    read: Some(false),
                    position: None,
                    bookmarks: None,
                    pages: vec![],
                },
            ],
        };

        // 1. Exact match
        let exact = chapter_match("Exact Chapter", &[], Some(&prev));
        assert!(exact.is_some());
        assert_eq!(exact.unwrap().name, "Exact Chapter");

        // 2. Renamed match
        let renamed = chapter_match("Different Name", &pages, Some(&prev));
        assert!(renamed.is_some());
        assert_eq!(renamed.unwrap().name, "Old Ch 1");
    }

    #[test]
    fn test_indexing_grouping_logic() {
        // Test determine_chapter helper logic
        fn determine_chapter(rel_path: &str, is_cover: bool) -> Option<String> {
            if is_cover {
                return None;
            }
            if let Some(idx) = rel_path.rfind('/') {
                let dir_part = &rel_path[..idx];
                let chapter_name = dir_part.replace('/', " / ");
                Some(chapter_name)
            } else {
                Some("Root pages".to_string())
            }
        }

        // Subdirectory becomes chapter name with slash normalization
        assert_eq!(determine_chapter("Chapter 1/01.jpg", false), Some("Chapter 1".into()));
        assert_eq!(determine_chapter("Volume 1/Chapter 1/01.jpg", false), Some("Volume 1 / Chapter 1".into()));

        // Root file becomes "Root pages"
        assert_eq!(determine_chapter("01.jpg", false), Some("Root pages".into()));

        // Cover file excluded from regular chapters
        assert_eq!(determine_chapter("cover.jpg", true), None);
        assert_eq!(determine_chapter("thumbnail.png", true), None);
    }
}
