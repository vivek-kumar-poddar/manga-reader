use std::collections::HashSet;

use super::path::validate_relative_path;
use super::settings::normalize_settings;
use super::types::{
    ValidatedManga, ValidatedPage, ValidatedPosition, ValidatedSettings, ValidatedSummary,
};
use super::validators::{matching_position_internal, parse_summary_internal, validate_manga};

#[tauri::command]
pub fn validate_relative_path_cmd(path: String) -> Result<String, String> {
    validate_relative_path(&path)
}

#[tauri::command]
pub fn matching_position_cmd(
    saved: Option<ValidatedPosition>,
    pages: Option<Vec<ValidatedPage>>,
    old_pages: Option<Vec<ValidatedPage>>,
) -> Option<ValidatedPosition> {
    let s = saved?;
    let p = pages?;
    matching_position_internal(&s, &p, old_pages.as_deref().unwrap_or(&[]))
}

#[tauri::command]
pub fn parse_position_cmd(
    mut value: ValidatedPosition,
    pages: Option<Vec<ValidatedPage>>,
    old_pages: Option<Vec<ValidatedPage>>,
) -> Result<ValidatedPosition, String> {
    if let Some(p) = &value.path {
        value.path = Some(validate_relative_path(p)?);
    }
    if !value.fraction.is_finite() {
        return Err("Position fraction must be a finite number.".to_string());
    }
    value.fraction = value.fraction.clamp(0.0, 1.0);
    if let Some(ref page_list) = pages {
        if !page_list.is_empty() {
            if let Some(matched) =
                matching_position_internal(&value, page_list, old_pages.as_deref().unwrap_or(&[]))
            {
                return Ok(matched);
            }
        }
    }
    Ok(value)
}

#[tauri::command]
pub fn parse_manga_cmd(
    mut value: ValidatedManga,
    preserve_hardware_pointers: Option<bool>,
) -> Result<ValidatedManga, String> {
    let mut seen = HashSet::new();
    if !preserve_hardware_pointers.unwrap_or(true) {
        value.local_path = None;
        value.handle = None;
        value.cover = None;
    }
    validate_manga(&mut value, &mut seen)?;
    Ok(value)
}

#[tauri::command]
pub fn parse_summary_cmd(value: serde_json::Value) -> Option<ValidatedSummary> {
    parse_summary_internal(&value)
}

#[tauri::command]
pub fn parse_settings_cmd(value: serde_json::Value) -> serde_json::Value {
    let parsed: ValidatedSettings = serde_json::from_value(value).unwrap_or_default();
    normalize_settings(&parsed)
}
