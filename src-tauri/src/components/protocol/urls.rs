use std::path::Path;

use super::types::{CoverResourceParams, PageResourceParams};

pub fn decode_request_path(path_str: &str) -> String {
    let decoded = crate::commands::cache::percent_decode(path_str);
    #[cfg(windows)]
    {
        let trimmed = decoded.trim_start_matches('/');
        if trimmed.len() >= 2
            && trimmed.as_bytes()[1] == b':'
            && trimmed.as_bytes()[0].is_ascii_alphabetic()
        {
            return trimmed.to_string();
        }
    }
    decoded
}

/// Encodes a single path segment per RFC 3986, preserving unreserved characters
/// (alphanumeric, -, _, ., ~) and percent-encoding all others including spaces, #, %, and UTF-8 bytes.
pub fn encode_path_segment(segment: &str) -> String {
    let mut encoded = String::with_capacity(segment.len() * 3);
    for b in segment.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                encoded.push(*b as char);
            }
            _ => {
                use std::fmt::Write;
                let _ = write!(encoded, "%{:02X}", b);
            }
        }
    }
    encoded
}

/// Parses HTTP Range header.
/// Rejects suffix ranges on empty files, extra delimiters, and invalid numbers.
pub fn parse_range(header_val: &str, total_size: u64) -> Option<(u64, u64)> {
    if total_size == 0 {
        return None;
    }
    let trimmed = header_val.trim();
    if !trimmed.starts_with("bytes=") {
        return None;
    }
    let range_str = trimmed[6..].trim();
    if range_str.contains(',') {
        // Multi-range or trailing comma delimiters are not supported
        return None;
    }

    let mut bounds = range_str.split('-');
    let start_str = bounds.next()?.trim();
    let end_str = bounds.next()?.trim();
    if bounds.next().is_some() {
        // Extra hyphens (e.g., 0-10-20)
        return None;
    }

    if start_str.is_empty() && end_str.is_empty() {
        return None;
    }

    if start_str.is_empty() {
        if !end_str.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let suffix_len: u64 = end_str.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = total_size.saturating_sub(suffix_len);
        let end = total_size - 1;
        Some((start, end))
    } else {
        if !start_str.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let start: u64 = start_str.parse().ok()?;
        if start >= total_size {
            return None;
        }
        let end = if end_str.is_empty() {
            total_size - 1
        } else {
            if !end_str.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            let parsed_end: u64 = end_str.parse().ok()?;
            parsed_end.min(total_size - 1)
        };
        if start <= end {
            Some((start, end))
        } else {
            None
        }
    }
}

/// Constructs properly encoded mangaimg URLs where path segments are individually escaped,
/// ensuring Windows paths with spaces, Unicode characters, #, and % roundtrip safely without URI truncation.
pub fn path_to_mangaimg_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let trimmed = s.trim_start_matches('/');
    if trimmed.len() >= 2
        && trimmed.as_bytes()[1] == b':'
        && trimmed.as_bytes()[0].is_ascii_alphabetic()
    {
        let drive = &trimmed[0..1];
        let rest = trimmed[2..].trim_start_matches('/');
        let segments: Vec<String> = rest
            .split('/')
            .filter(|seg| !seg.is_empty())
            .map(encode_path_segment)
            .collect();
        format!(
            "http://mangaimg.localhost/{drive}%3A/{}",
            segments.join("/")
        )
    } else {
        let segments: Vec<String> = trimmed
            .split('/')
            .filter(|seg| !seg.is_empty())
            .map(encode_path_segment)
            .collect();
        format!("http://mangaimg.localhost/{}", segments.join("/"))
    }
}

pub fn parse_page_resource_uri(uri_path: &str) -> Option<PageResourceParams> {
    let rest = uri_path.strip_prefix("/page/")?;
    let parts: Vec<&str> = rest.splitn(4, '/').collect();
    if parts.len() < 4 {
        return None;
    }
    let manga_id = crate::commands::cache::percent_decode(parts[0]);
    let version = parts[1].to_string();
    let transform = parts[2].to_string();
    let rel_path = crate::commands::cache::percent_decode(parts[3]);
    if manga_id.is_empty() || rel_path.is_empty() {
        return None;
    }
    Some(PageResourceParams {
        manga_id,
        version,
        transform,
        rel_path,
    })
}

pub fn parse_cover_resource_uri(uri_path: &str) -> Option<CoverResourceParams> {
    let rest = uri_path.strip_prefix("/cover/")?;
    let trimmed = rest.trim_matches('/');
    let parts: Vec<&str> = trimmed.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let manga_id = crate::commands::cache::percent_decode(parts[0]);
    if manga_id.is_empty() {
        return None;
    }
    let mut version = None;
    let mut size = None;

    for part in parts.iter().skip(1) {
        if let Ok(num) = part.parse::<u32>() {
            if num == 512 || num == 768 || num == 1024 {
                size = Some(num);
                continue;
            }
        }
        if version.is_none() {
            version = Some(part.to_string());
        }
    }

    Some(CoverResourceParams {
        manga_id,
        version,
        size,
    })
}

pub fn build_page_resource_url(
    manga_id: &str,
    version: &str,
    transform: &str,
    rel_path: &str,
    root: Option<&str>,
) -> String {
    let enc_manga_id = encode_path_segment(manga_id);
    let enc_version = encode_path_segment(version);
    let enc_transform = encode_path_segment(transform);
    let clean_rel = rel_path.replace('\\', "/");
    let segments: Vec<String> = clean_rel
        .split('/')
        .filter(|s| !s.is_empty())
        .map(encode_path_segment)
        .collect();
    let enc_path = segments.join("/");
    let base_url = format!(
        "http://mangaimg.localhost/page/{}/{}/{}/{}",
        enc_manga_id, enc_version, enc_transform, enc_path
    );
    if let Some(r) = root {
        if !r.is_empty() {
            return format!("{}?root={}", base_url, encode_path_segment(r));
        }
    }
    base_url
}

pub fn build_cover_resource_url(manga_id: &str, version: Option<&str>) -> String {
    let enc_manga_id = encode_path_segment(manga_id);
    match version {
        Some(v) if !v.is_empty() => {
            format!(
                "http://mangaimg.localhost/cover/{}/{}",
                enc_manga_id,
                encode_path_segment(v)
            )
        }
        _ => format!("http://mangaimg.localhost/cover/{}", enc_manga_id),
    }
}

pub fn parse_fit_dimensions(transform: &str) -> Option<(u32, u32)> {
    let rest = transform.strip_prefix("fit_")?;
    let mut parts = rest.split('x');
    let w_str = parts.next()?;
    let h_str = parts.next()?;
    let w: u32 = w_str.parse().ok()?;
    let h: u32 = h_str.parse().ok()?;
    if w == 0 || h == 0 {
        return None;
    }
    Some((w, h))
}
