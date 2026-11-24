use super::types::ValidatedSettings;

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
    let custom_seconds = settings
        .custom_seconds
        .unwrap_or_else(|| ![2.0, 3.0, 4.0, 5.0].contains(&seconds));
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
        _ => {
            if !advance {
                "stop"
            } else {
                "next"
            }
        }
    };
    let font_size_title = settings
        .font_size_title
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 72.0) as u32)
        .unwrap_or(28);
    let font_size_ui = settings
        .font_size_ui
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 48.0) as u32)
        .unwrap_or(15);
    let font_size_button = settings
        .font_size_button
        .filter(|f| f.is_finite())
        .map(|f| f.round().clamp(10.0, 48.0) as u32)
        .unwrap_or(14);
    let font_size_scale = settings
        .font_size_scale
        .filter(|f| f.is_finite())
        .map(|f| (f * 10.0).round() / 10.0)
        .map(|f| f.clamp(0.5, 3.0))
        .unwrap_or(1.0);
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
    map.insert("fontSizeScale".into(), font_size_scale.into());
    map.insert("confirmDelete".into(), confirm_delete.into());

    if let Some(sort) = &settings.shelf_sort {
        if sort == "recent" || sort == "title" || sort == "added" || sort == "progress" {
            map.insert("shelfSort".into(), sort.as_str().into());
        }
    }

    serde_json::Value::Object(map)
}
