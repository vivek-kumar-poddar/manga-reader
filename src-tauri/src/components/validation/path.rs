use super::types::{LIMIT_DIRECTORY_DEPTH, LIMIT_PATH_CHARS, RESERVED_DOS_NAMES};

pub fn validate_relative_path(path: &str) -> Result<String, String> {
    if path.starts_with(' ') || path.ends_with(' ') {
        return Err(format!(
            "Path cannot start or end with whitespace: \"{path}\""
        ));
    }
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("Path must be a non-empty string.".to_string());
    }
    if trimmed.len() > LIMIT_PATH_CHARS {
        return Err(format!(
            "Relative path length (characters) exceeds the limit of {LIMIT_PATH_CHARS}. Use a smaller selection."
        ));
    }
    if trimmed.contains(':') {
        return Err(format!(
            "Path contains invalid colon or drive/stream prefix: \"{trimmed}\""
        ));
    }
    if trimmed.starts_with('/') || trimmed.ends_with('/') {
        return Err(format!(
            "Path cannot start or end with a slash: \"{trimmed}\""
        ));
    }
    if trimmed.contains('\\') {
        return Err(format!("Path must use forward slashes only: \"{trimmed}\""));
    }
    if trimmed.starts_with("//") {
        return Err(format!("Path cannot start with UNC prefix: \"{trimmed}\""));
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
            return Err(format!(
                "Path contains invalid traversal segment: \"{trimmed}\""
            ));
        }
        if seg.ends_with(' ') || seg.ends_with('.') {
            return Err(format!(
                "Path segment cannot end with a space or dot: \"{seg}\""
            ));
        }
        let stem = seg.split('.').next().unwrap_or("").to_lowercase();
        if RESERVED_DOS_NAMES.contains(&stem.as_str()) {
            return Err(format!("Path segment uses reserved device name: \"{seg}\""));
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
