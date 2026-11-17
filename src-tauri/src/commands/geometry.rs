use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub const VIRTUALIZATION_THRESHOLD: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageInput {
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageOffset {
    pub page: usize,
    pub top: f64,
    pub height: f64,
    pub bottom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GeometryOptions {
    pub container_width: f64,
    pub viewport_height: f64,
    pub layout: String,
    pub max_width: f64,
    pub zoom: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowRange {
    pub start_index: usize,
    pub end_index: usize,
    pub top_spacer: f64,
    pub bottom_spacer: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PageDimensions {
    pub width: f64,
    pub height: f64,
}

pub fn calculate_page_dimensions_internal(
    page: &PageInput,
    options: &GeometryOptions,
) -> PageDimensions {
    let safe_zoom = if options.zoom == 0.0 || !options.zoom.is_finite() {
        1.0
    } else {
        options.zoom.max(0.1)
    };
    let page_w = (page.width.max(1)) as f64;
    let page_h = (page.height.max(1)) as f64;
    let native_width = page_w * safe_zoom;
    let page_aspect = page_w / page_h;

    let target_width = match options.layout.as_str() {
        "width" => options.container_width.min(native_width),
        "height" => {
            let by_height = options.viewport_height.max(1.0) * page_aspect * safe_zoom;
            options.container_width.min(by_height).min(native_width)
        }
        "auto" => options
            .container_width
            .min(920.0 * safe_zoom)
            .min(native_width),
        _ => {
            let reading_width = if options.max_width > 0.0 {
                options.max_width * safe_zoom
            } else {
                options.container_width
            };
            options.container_width.min(reading_width).min(native_width)
        }
    };

    let target_width = target_width.round().max(1.0);
    let target_height = (target_width / page_aspect).round().max(1.0);

    PageDimensions {
        width: target_width,
        height: target_height,
    }
}

pub fn compute_offsets_internal(
    pages: &[PageInput],
    options: &GeometryOptions,
    measured_heights: Option<&HashMap<usize, f64>>,
) -> Vec<PageOffset> {
    let mut offsets = Vec::with_capacity(pages.len());
    let mut current_top = 0.0;

    for (i, page) in pages.iter().enumerate() {
        let measured = measured_heights
            .and_then(|m| m.get(&i).copied())
            .filter(|&h| h > 0.0 && h.is_finite());

        let height =
            measured.unwrap_or_else(|| calculate_page_dimensions_internal(page, options).height);
        let bottom = current_top + height;

        offsets.push(PageOffset {
            page: i,
            top: current_top,
            height,
            bottom,
        });
        current_top = bottom;
    }

    offsets
}

pub fn get_window_range_internal(
    offsets: &[PageOffset],
    scroll_y: f64,
    viewport_height: f64,
    buffer_screen_count: Option<f64>,
    threshold: Option<usize>,
) -> WindowRange {
    let count = offsets.len();
    let thresh = threshold.unwrap_or(VIRTUALIZATION_THRESHOLD);

    if count <= thresh {
        return WindowRange {
            start_index: 0,
            end_index: count.saturating_sub(1),
            top_spacer: 0.0,
            bottom_spacer: 0.0,
        };
    }

    let safe_viewport_height = if viewport_height <= 0.0 || !viewport_height.is_finite() {
        800.0
    } else {
        viewport_height.max(1.0)
    };
    let buf_screens = buffer_screen_count.unwrap_or(3.0).max(1.0);
    let buffer = safe_viewport_height * buf_screens;
    let min_y = (scroll_y - buffer).max(0.0);
    let max_y = scroll_y + safe_viewport_height + buffer;

    let mut lo = 0usize;
    let mut hi = count - 1;
    while lo < hi {
        let mid = (lo + hi) / 2;
        if offsets[mid].bottom >= min_y {
            hi = mid;
        } else {
            lo = mid + 1;
        }
    }
    let start_index = lo;
    hi = count - 1;
    while lo < hi {
        let mid = (lo + hi).div_ceil(2);
        if offsets[mid].top <= max_y {
            lo = mid;
        } else {
            hi = mid - 1;
        }
    }
    let end_index = lo.max(start_index).min(count - 1);

    let top_spacer = offsets[start_index].top.max(0.0);
    let bottom_spacer = (offsets[count - 1].bottom - offsets[end_index].bottom).max(0.0);

    WindowRange {
        start_index,
        end_index,
        top_spacer,
        bottom_spacer,
    }
}

#[tauri::command]
pub fn calculate_page_dimensions(page: PageInput, options: GeometryOptions) -> PageDimensions {
    calculate_page_dimensions_internal(&page, &options)
}

#[tauri::command]
pub fn compute_offsets(
    pages: Vec<PageInput>,
    options: GeometryOptions,
    measured_heights: Option<HashMap<usize, f64>>,
) -> Vec<PageOffset> {
    compute_offsets_internal(&pages, &options, measured_heights.as_ref())
}

#[tauri::command]
pub fn get_window_range(
    offsets: Vec<PageOffset>,
    scroll_y: f64,
    viewport_height: f64,
    buffer_screen_count: Option<f64>,
    threshold: Option<usize>,
) -> WindowRange {
    get_window_range_internal(
        &offsets,
        scroll_y,
        viewport_height,
        buffer_screen_count,
        threshold,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn default_options() -> GeometryOptions {
        GeometryOptions {
            container_width: 1000.0,
            viewport_height: 900.0,
            layout: "max".to_string(),
            max_width: 920.0,
            zoom: 1.0,
        }
    }

    #[test]
    fn test_calculate_page_dimensions() {
        let page = PageInput {
            width: 800,
            height: 1200,
        };

        let dim_max = calculate_page_dimensions_internal(&page, &default_options());
        assert_eq!(dim_max.width, 800.0);
        assert_eq!(dim_max.height, 1200.0);

        let mut opt_width = default_options();
        opt_width.layout = "width".to_string();
        opt_width.container_width = 600.0;
        let dim_width = calculate_page_dimensions_internal(&page, &opt_width);
        assert_eq!(dim_width.width, 600.0);
        assert_eq!(dim_width.height, 900.0);

        let mut opt_height = default_options();
        opt_height.layout = "height".to_string();
        opt_height.viewport_height = 600.0;
        let dim_height = calculate_page_dimensions_internal(&page, &opt_height);
        assert_eq!(dim_height.width, 400.0);
        assert_eq!(dim_height.height, 600.0);

        let mut opt_zoom = default_options();
        opt_zoom.zoom = 1.5;
        opt_zoom.container_width = 2000.0;
        opt_zoom.max_width = 2000.0;
        let dim_zoom = calculate_page_dimensions_internal(&page, &opt_zoom);
        assert_eq!(dim_zoom.width, 1200.0);
        assert_eq!(dim_zoom.height, 1800.0);
    }

    #[test]
    fn test_compute_offsets() {
        let pages: Vec<PageInput> = (0..5)
            .map(|_| PageInput {
                width: 800,
                height: 1000,
            })
            .collect();
        let offsets = compute_offsets_internal(&pages, &default_options(), None);
        assert_eq!(offsets.len(), 5);
        assert_eq!(offsets[0].top, 0.0);
        assert_eq!(offsets[0].height, 1000.0);
        assert_eq!(offsets[0].bottom, 1000.0);
        assert_eq!(offsets[4].bottom, 5000.0);

        let mut measured = HashMap::new();
        measured.insert(0, 1050.0);
        measured.insert(1, 950.0);
        let offsets_measured =
            compute_offsets_internal(&pages[0..3], &default_options(), Some(&measured));
        assert_eq!(offsets_measured[0].height, 1050.0);
        assert_eq!(offsets_measured[1].top, 1050.0);
        assert_eq!(offsets_measured[1].height, 950.0);
        assert_eq!(offsets_measured[1].bottom, 2000.0);
        assert_eq!(offsets_measured[2].top, 2000.0);
        assert_eq!(offsets_measured[2].height, 1000.0);
        assert_eq!(offsets_measured[2].bottom, 3000.0);
    }

    #[test]
    fn test_get_window_range() {
        let pages: Vec<PageInput> = (0..100)
            .map(|_| PageInput {
                width: 800,
                height: 1000,
            })
            .collect();
        let offsets = compute_offsets_internal(&pages, &default_options(), None);

        // Small chapter (<= threshold)
        let small_range = get_window_range_internal(&offsets[0..7], 5000.0, 900.0, Some(3.0), None);
        assert_eq!(small_range.start_index, 0);
        assert_eq!(small_range.end_index, 6);
        assert_eq!(small_range.top_spacer, 0.0);
        assert_eq!(small_range.bottom_spacer, 0.0);

        // Large chapter top
        let top_range = get_window_range_internal(&offsets, 0.0, 1000.0, Some(3.0), None);
        assert_eq!(top_range.start_index, 0);
        assert_eq!(top_range.top_spacer, 0.0);
        assert!(top_range.end_index >= 3 && top_range.end_index <= 6);
        let total_height = 100_000.0;
        let covered = top_range.top_spacer
            + (offsets[top_range.end_index].bottom - offsets[top_range.start_index].top)
            + top_range.bottom_spacer;
        assert_eq!(covered, total_height);

        // Middle
        let mid_range = get_window_range_internal(&offsets, 50_000.0, 1000.0, Some(3.0), None);
        assert!(mid_range.start_index > 0);
        assert!(mid_range.end_index < 99);
        let mid_covered = mid_range.top_spacer
            + (offsets[mid_range.end_index].bottom - offsets[mid_range.start_index].top)
            + mid_range.bottom_spacer;
        assert_eq!(mid_covered, total_height);
    }
}
