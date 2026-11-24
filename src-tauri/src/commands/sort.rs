use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SortableSummary {
    pub id: String,
    pub title: String,
    pub added_at: f64,
    pub updated_at: f64,
    pub chapters_read: usize,
    pub chapter_count: usize,
}

/// Case-insensitive numeric collation matching `Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })`.
pub fn collate_numeric_ci(a: &str, b: &str) -> Ordering {
    let la = a.to_lowercase();
    let lb = b.to_lowercase();
    let mut ca = la.chars().peekable();
    let mut cb = lb.chars().peekable();

    loop {
        match (ca.peek().copied(), cb.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let mut num_a = String::new();
                while let Some(&d) = ca.peek() {
                    if d.is_ascii_digit() {
                        num_a.push(d);
                        ca.next();
                    } else {
                        break;
                    }
                }
                let mut num_b = String::new();
                while let Some(&d) = cb.peek() {
                    if d.is_ascii_digit() {
                        num_b.push(d);
                        cb.next();
                    } else {
                        break;
                    }
                }
                let ta = num_a.trim_start_matches('0');
                let tb = num_b.trim_start_matches('0');
                let ord = ta.len().cmp(&tb.len()).then_with(|| ta.cmp(tb));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.cmp(&y);
                if ord != Ordering::Equal {
                    return ord;
                }
                ca.next();
                cb.next();
            }
        }
    }
}

fn compare_f64_desc(a: f64, b: f64) -> Ordering {
    let va = if a.is_finite() && a != 0.0 { a } else { 0.0 };
    let vb = if b.is_finite() && b != 0.0 { b } else { 0.0 };
    vb.total_cmp(&va)
}

pub fn sort_library_entries_internal(
    mut entries: Vec<SortableSummary>,
    shelf_sort: Option<&str>,
) -> Vec<String> {
    let mode = shelf_sort.unwrap_or("recent");

    entries.sort_by(|a, b| {
        let by_title = collate_numeric_ci(&a.title, &b.title);
        let primary = match mode {
            "title" => by_title,
            "added" => compare_f64_desc(a.added_at, b.added_at),
            "progress" => {
                let ratio_a = a.chapters_read as f64 / a.chapter_count.max(1) as f64;
                let ratio_b = b.chapters_read as f64 / b.chapter_count.max(1) as f64;
                compare_f64_desc(ratio_a, ratio_b)
            }
            _ => compare_f64_desc(a.updated_at, b.updated_at),
        };

        primary
            .then(by_title)
            .then_with(|| collate_numeric_ci(&a.id, &b.id))
    });

    entries.into_iter().map(|e| e.id).collect()
}

#[tauri::command]
pub fn sort_library_entries(
    entries: Vec<SortableSummary>,
    shelf_sort: Option<String>,
) -> Vec<String> {
    sort_library_entries_internal(entries, shelf_sort.as_deref())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_entries() -> Vec<SortableSummary> {
        vec![
            SortableSummary {
                id: "m-10".into(),
                title: "Manga 10".into(),
                added_at: 100.0,
                updated_at: 500.0,
                chapters_read: 5,
                chapter_count: 10,
            },
            SortableSummary {
                id: "m-2".into(),
                title: "manga 2".into(),
                added_at: 300.0,
                updated_at: 200.0,
                chapters_read: 9,
                chapter_count: 10,
            },
            SortableSummary {
                id: "m-1".into(),
                title: "Alpha".into(),
                added_at: 200.0,
                updated_at: 800.0,
                chapters_read: 0,
                chapter_count: 0,
            },
        ]
    }

    #[test]
    fn test_sort_by_recent_default() {
        let ids = sort_library_entries_internal(sample_entries(), None);
        assert_eq!(ids, vec!["m-1", "m-10", "m-2"]);
    }

    #[test]
    fn test_sort_by_title_numeric_case_insensitive() {
        let ids = sort_library_entries_internal(sample_entries(), Some("title"));
        assert_eq!(ids, vec!["m-1", "m-2", "m-10"]);
    }

    #[test]
    fn test_sort_by_added_desc() {
        let ids = sort_library_entries_internal(sample_entries(), Some("added"));
        assert_eq!(ids, vec!["m-2", "m-1", "m-10"]);
    }

    #[test]
    fn test_sort_by_progress_desc() {
        let ids = sort_library_entries_internal(sample_entries(), Some("progress"));
        assert_eq!(ids, vec!["m-2", "m-10", "m-1"]);
    }

    #[test]
    fn test_tie_breakers_title_then_id() {
        let entries = vec![
            SortableSummary {
                id: "id-10".into(),
                title: "Same".into(),
                added_at: 100.0,
                updated_at: 100.0,
                chapters_read: 1,
                chapter_count: 2,
            },
            SortableSummary {
                id: "id-2".into(),
                title: "Same".into(),
                added_at: 100.0,
                updated_at: 100.0,
                chapters_read: 1,
                chapter_count: 2,
            },
        ];
        let ids = sort_library_entries_internal(entries, Some("recent"));
        assert_eq!(ids, vec!["id-2", "id-10"]);
    }
}
