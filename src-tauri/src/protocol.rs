use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::commands::fs::{ALLOWED_IMAGE_EXTENSIONS, AllowedRoots, MAX_FILE_READ_BYTES};

pub const MAX_RANGE_CHUNK_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB range chunk cap

const TRUSTED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
    "http://localhost:5173",
    "http://mangaimg.localhost",
];

/// Restricts CORS headers to trusted application origins instead of wildcard *.
pub fn get_cors_allow_origin(req: &Request<Vec<u8>>) -> Option<&'static str> {
    if let Some(origin_val) = req.headers().get("origin").and_then(|v| v.to_str().ok()) {
        let trimmed = origin_val.trim();
        for &trusted in TRUSTED_ORIGINS {
            if trimmed.eq_ignore_ascii_case(trusted) {
                return Some(trusted);
            }
        }
    }
    None
}

fn apply_cors(
    builder: tauri::http::response::Builder,
    req: &Request<Vec<u8>>,
) -> tauri::http::response::Builder {
    if let Some(origin) = get_cors_allow_origin(req) {
        builder
            .header("Access-Control-Allow-Origin", origin)
            .header("Vary", "Origin")
    } else {
        builder
    }
}

pub fn matches_if_none_match(header_val: &str, current_etag: &str) -> bool {
    let clean_current = current_etag
        .trim()
        .trim_start_matches("W/")
        .trim()
        .trim_matches('"');
    for tag in header_val.split(',') {
        let tag = tag.trim();
        if tag == "*" {
            return true;
        }
        let clean_tag = tag.trim_start_matches("W/").trim().trim_matches('"');
        if clean_tag == clean_current {
            return true;
        }
    }
    false
}

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

pub fn get_mime_type(ext: &str) -> &'static str {
    match ext {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        "ico" => "image/x-icon",
        "heic" => "image/heic",
        "heif" => "image/heif",
        "tif" | "tiff" => "image/tiff",
        "jxl" => "image/jxl",
        _ => "application/octet-stream",
    }
}

fn error_response(status: StatusCode, message: &str, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8");
    builder = apply_cors(builder, req);
    builder
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

/// Verifies whether a path is an explicitly managed image artifact in the thumbnail or variant cache.
/// Prevents broad authorization of arbitrary files in the cache or data directory.
pub fn is_explicit_cache_artifact(app: &AppHandle, path: &Path) -> bool {
    let file_name = match path.file_name().and_then(|f| f.to_str()) {
        Some(f) => f,
        None => return false,
    };

    if !file_name.ends_with(".webp") {
        return false;
    }
    let is_thumb_or_variant = file_name.starts_with("t_") || file_name.starts_with("v_");
    if !is_thumb_or_variant {
        return false;
    }

    let parent = match path.parent() {
        Some(p) => p,
        None => return false,
    };
    let parent_name = match parent.file_name().and_then(|f| f.to_str()) {
        Some(p) => p,
        None => return false,
    };
    if parent_name != "thumbnails" && parent_name != "variants" {
        return false;
    }

    if let Ok(cache_dir) = app.path().app_cache_dir() {
        if let Ok(canonical_cache) = dunce::canonicalize(&cache_dir) {
            if parent.starts_with(&canonical_cache) || parent.starts_with(&cache_dir) {
                return true;
            }
        } else if parent.starts_with(&cache_dir) {
            return true;
        }
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let cache_dir = app_dir.join("cache");
        if let Ok(canonical_cache) = dunce::canonicalize(&cache_dir) {
            if parent.starts_with(&canonical_cache) || parent.starts_with(&cache_dir) {
                return true;
            }
        } else if parent.starts_with(&cache_dir) {
            return true;
        }
    }
    false
}

pub fn is_in_thumbnail_cache(app: &AppHandle, path: &Path) -> bool {
    is_explicit_cache_artifact(app, path)
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

#[derive(Debug, PartialEq, Eq)]
pub struct PageResourceParams {
    pub manga_id: String,
    pub version: String,
    pub transform: String,
    pub rel_path: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CoverResourceParams {
    pub manga_id: String,
    pub version: Option<String>,
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
    let version = parts.get(1).map(|v| v.to_string());
    Some(CoverResourceParams { manga_id, version })
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

fn try_find_and_generate_cover(
    app: &AppHandle,
    base_dir: &Path,
    manga_id: &str,
) -> Result<PathBuf, String> {
    if !base_dir.is_dir() {
        return Err("Base directory does not exist".into());
    }

    // Common cover filenames
    for name in &[
        "cover.jpg",
        "cover.jpeg",
        "cover.png",
        "cover.webp",
        "Cover.jpg",
        "Cover.png",
        "folder.jpg",
    ] {
        let candidate = base_dir.join(name);
        if candidate.is_file() {
            return crate::commands::image::generate_thumbnail_direct(app, &candidate, manga_id);
        }
    }

    // Search immediate files in base_dir
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        let mut files: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_file())
            .collect();
        files.sort();
        for path in files {
            if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
                if ALLOWED_IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                    return crate::commands::image::generate_thumbnail_direct(app, &path, manga_id);
                }
            }
        }
    }

    // Search first subfolder (e.g. Chapter 1)
    if let Ok(entries) = std::fs::read_dir(base_dir) {
        let mut subdirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        subdirs.sort();
        for subdir in subdirs {
            if let Ok(sub_entries) = std::fs::read_dir(&subdir) {
                let mut files: Vec<PathBuf> = sub_entries
                    .flatten()
                    .map(|e| e.path())
                    .filter(|p| p.is_file())
                    .collect();
                files.sort();
                for f in files {
                    if let Some(ext) = f.extension().and_then(|e| e.to_str()) {
                        if ALLOWED_IMAGE_EXTENSIONS.contains(&ext.to_lowercase().as_str()) {
                            return crate::commands::image::generate_thumbnail_direct(
                                app, &f, manga_id,
                            );
                        }
                    }
                }
            }
        }
    }

    Err("No image found to generate cover".into())
}

fn safe_name(s: &str) -> bool {
    !s.is_empty() && !s.contains(['/', '\\', ':']) && !s.contains("..")
}

pub fn handle_mangaimg_request(app: &AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    // 0. Method restriction: only GET and HEAD are permitted
    if req.method() != "GET" && req.method() != "HEAD" {
        let mut builder = Response::builder()
            .status(StatusCode::METHOD_NOT_ALLOWED)
            .header("Allow", "GET, HEAD")
            .header("Content-Type", "text/plain; charset=utf-8");
        builder = apply_cors(builder, &req);
        return builder
            .body(
                "Method not allowed. Only GET and HEAD are supported."
                    .as_bytes()
                    .to_vec(),
            )
            .unwrap_or_else(|_| Response::new(Vec::new()));
    }

    let uri_path = req.uri().path();

    // Support resource URLs (/cover/, /page/), opaque image ID endpoints, and canonical path requests
    let raw_target: PathBuf = if let Some(cover_params) = parse_cover_resource_uri(uri_path) {
        let safe_id = crate::commands::cache::sanitize_id(&cover_params.manga_id);
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| PathBuf::from("cache"));
        let thumb_path = cache_dir.join("thumbnails").join(format!("{safe_id}.webp"));

        if thumb_path.exists() {
            thumb_path
        } else {
            let local_path_opt = app
                .try_state::<crate::db::DbState>()
                .and_then(|db| db.get_local_path_sync(&cover_params.manga_id));
            if let Some(ref lp) = local_path_opt {
                let base = PathBuf::from(lp);
                match try_find_and_generate_cover(app, &base, &cover_params.manga_id) {
                    Ok(p) => p,
                    Err(_) => {
                        return error_response(
                            StatusCode::NOT_FOUND,
                            "Cover image not found",
                            &req,
                        );
                    }
                }
            } else {
                return error_response(StatusCode::NOT_FOUND, "Cover thumbnail not found", &req);
            }
        }
    } else if let Some(page_params) = parse_page_resource_uri(uri_path) {
        if let Err(e) = crate::validation::validate_relative_path(&page_params.rel_path) {
            return error_response(
                StatusCode::BAD_REQUEST,
                &format!("Invalid relative path in page URL: {e}"),
                &req,
            );
        }

        let query_root = req.uri().query().and_then(|q| {
            q.split('&').find_map(|pair| {
                pair.strip_prefix("root=")
                    .map(crate::commands::cache::percent_decode)
            })
        });

        let base_dir_str = match query_root {
            Some(ref r) if !r.trim().is_empty() => Some(r.clone()),
            _ => app
                .try_state::<crate::db::DbState>()
                .and_then(|db| db.get_local_path_sync(&page_params.manga_id)),
        };

        let base_dir_str = match base_dir_str {
            Some(s) => s,
            None => {
                return error_response(
                    StatusCode::NOT_FOUND,
                    &format!(
                        "Manga '{}' not found or localPath unavailable",
                        page_params.manga_id
                    ),
                    &req,
                );
            }
        };

        let base_dir = PathBuf::from(&base_dir_str);
        let resolved =
            match crate::commands::fs::resolve_relative_path(&base_dir, &page_params.rel_path) {
                Ok(p) => p,
                Err(e) => {
                    return error_response(
                        StatusCode::NOT_FOUND,
                        &format!("Page file not found: {e}"),
                        &req,
                    );
                }
            };

        let allowed = app.state::<AllowedRoots>();
        if !allowed.is_allowed(&resolved) {
            return error_response(
                StatusCode::FORBIDDEN,
                "Path is not under an authorized library root",
                &req,
            );
        }

        match page_params.transform.as_str() {
            "raw" | "full" | "original" => resolved,
            "thumb" => {
                match crate::commands::image::generate_image_variant_direct(
                    app, &resolved, 320, 420,
                ) {
                    Ok(variant_path) => variant_path,
                    Err(_) => resolved,
                }
            }
            "preview" | "low" => {
                match crate::commands::image::generate_image_variant_direct(
                    app, &resolved, 1000, 1600,
                ) {
                    Ok(variant_path) => variant_path,
                    Err(_) => resolved,
                }
            }
            fit if fit.starts_with("fit_") => {
                let (w, h) = parse_fit_dimensions(fit).unwrap_or((1000, 1600));
                match crate::commands::image::generate_image_variant_direct(app, &resolved, w, h) {
                    Ok(variant_path) => variant_path,
                    Err(_) => resolved,
                }
            }
            _ => resolved,
        }
    } else if let Some(id_part) = uri_path.strip_prefix("/thumb/") {
        let decoded = crate::commands::cache::percent_decode(id_part);
        if !safe_name(&decoded) {
            return error_response(StatusCode::BAD_REQUEST, "Bad name", &req);
        }
        let filename = if decoded.starts_with("t_") && decoded.ends_with(".webp") {
            decoded
        } else {
            let safe_id = crate::commands::cache::sanitize_id(&decoded);
            format!("{safe_id}.webp")
        };
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| PathBuf::from("cache"));
        cache_dir.join("thumbnails").join(filename)
    } else if let Some(hash_part) = uri_path.strip_prefix("/variant/") {
        let decoded = crate::commands::cache::percent_decode(hash_part);
        if !safe_name(&decoded) {
            return error_response(StatusCode::BAD_REQUEST, "Bad name", &req);
        }
        let filename = if decoded.ends_with(".webp") {
            decoded
        } else {
            format!("{decoded}.webp")
        };
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| PathBuf::from("cache"));
        cache_dir.join("variants").join(filename)
    } else {
        let decoded_path = decode_request_path(uri_path);
        if decoded_path.is_empty() {
            return error_response(StatusCode::BAD_REQUEST, "Missing file path", &req);
        }
        PathBuf::from(&decoded_path)
    };

    let resolved = match dunce::canonicalize(&raw_target) {
        Ok(p) => p,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "Target file not found", &req),
    };

    // 1. Path allowlist checks (AllowedRoots or explicit cache artifact)
    let allowed = app.state::<AllowedRoots>();
    let is_allowed = allowed.is_allowed(&resolved) || is_explicit_cache_artifact(app, &resolved);
    if !is_allowed {
        return error_response(
            StatusCode::FORBIDDEN,
            "Path is not under an allowed library root or managed cache",
            &req,
        );
    }

    // 2. Extension check
    let ext = resolved
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !ALLOWED_IMAGE_EXTENSIONS.contains(&ext.as_str()) {
        return error_response(
            StatusCode::FORBIDDEN,
            "File extension is not an allowed image format",
            &req,
        );
    }

    // 3. Regular file and size check (100 MiB cap)
    // Open the descriptor once to eliminate TOCTOU race conditions between inspection and read.
    let mut file = match File::open(&resolved) {
        Ok(f) => f,
        Err(e) => {
            return error_response(
                StatusCode::NOT_FOUND,
                &format!("Failed to open file: {e}"),
                &req,
            );
        }
    };

    let metadata = match file.metadata() {
        Ok(m) => m,
        Err(_) => {
            return error_response(
                StatusCode::NOT_FOUND,
                "Failed to inspect file metadata",
                &req,
            );
        }
    };

    if !metadata.is_file() {
        return error_response(
            StatusCode::NOT_FOUND,
            "Target path is not a regular file",
            &req,
        );
    }

    let initial_size = metadata.len();
    if initial_size > MAX_FILE_READ_BYTES {
        return error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds 100 MiB safety limit",
            &req,
        );
    }

    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    // Format as weak validator per RFC 9110 Section 8.8.3
    let etag = format!("W/\"{:x}-{:x}\"", mtime_ms, initial_size);
    let mime = get_mime_type(&ext);

    // 4. Conditional GET via ETag (304 Not Modified)
    if let Some(if_none_match) = req.headers().get("if-none-match") {
        if let Ok(val) = if_none_match.to_str() {
            if matches_if_none_match(val, &etag) {
                let mut builder = Response::builder()
                    .status(StatusCode::NOT_MODIFIED)
                    .header("ETag", &etag)
                    .header("Cache-Control", "no-cache");
                builder = apply_cors(builder, &req);
                return builder
                    .body(Vec::new())
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            }
        }
    }

    let is_head = req.method() == "HEAD";

    // 5. HTTP Range request handling (206 Partial Content) with 8 MiB chunk capping
    if let Some(range_header) = req.headers().get("range") {
        if let Ok(range_str) = range_header.to_str() {
            if let Some((start, end)) = parse_range(range_str, initial_size) {
                let capped_end = end.min(start.saturating_add(MAX_RANGE_CHUNK_BYTES - 1));
                let length = capped_end - start + 1;
                let body = if is_head {
                    Vec::new()
                } else {
                    if let Err(e) = file.seek(SeekFrom::Start(start)) {
                        return error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &format!("Seek error: {e}"),
                            &req,
                        );
                    }
                    let mut buffer = vec![0u8; length as usize];
                    if let Err(e) = file.read_exact(&mut buffer) {
                        return error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &format!("Read error: {e}"),
                            &req,
                        );
                    }
                    buffer
                };

                let mut builder = Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("Content-Type", mime)
                    .header("Content-Length", length.to_string())
                    .header(
                        "Content-Range",
                        format!("bytes {}-{}/{}", start, capped_end, initial_size),
                    )
                    .header("Accept-Ranges", "bytes")
                    .header("ETag", &etag)
                    .header("Cache-Control", "no-cache");
                builder = apply_cors(builder, &req);
                return builder
                    .body(body)
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            } else {
                let mut builder = Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", format!("bytes */{}", initial_size));
                builder = apply_cors(builder, &req);
                return builder
                    .body(Vec::new())
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            }
        }
    }

    // 6. Full content response (200 OK)
    let body = if is_head {
        Vec::new()
    } else {
        // Enforce the 100 MiB safety limit against the opened descriptor using take()
        let mut buffer = Vec::with_capacity(initial_size.min(MAX_FILE_READ_BYTES) as usize);
        let mut reader = (&mut file).take(MAX_FILE_READ_BYTES + 1);
        if let Err(e) = reader.read_to_end(&mut buffer) {
            return error_response(
                StatusCode::INTERNAL_SERVER_ERROR,
                &format!("Failed to read file: {e}"),
                &req,
            );
        }
        if buffer.len() as u64 > MAX_FILE_READ_BYTES {
            return error_response(
                StatusCode::PAYLOAD_TOO_LARGE,
                "File exceeds 100 MiB safety limit",
                &req,
            );
        }
        buffer
    };

    let actual_size = if is_head {
        initial_size
    } else {
        body.len() as u64
    };
    let mut builder = Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Content-Length", actual_size.to_string())
        .header("Accept-Ranges", "bytes")
        .header("ETag", &etag)
        .header("Cache-Control", "no-cache");
    builder = apply_cors(builder, &req);
    builder
        .body(body)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_decode_request_path() {
        #[cfg(windows)]
        {
            assert_eq!(
                decode_request_path("/C%3A%2FManga%2Fchapter1%2F01.jpg"),
                "C:/Manga/chapter1/01.jpg"
            );
            assert_eq!(
                decode_request_path("/C:/Manga/chapter1/01.jpg"),
                "C:/Manga/chapter1/01.jpg"
            );
            assert_eq!(
                decode_request_path("C:/Manga/chapter1/01.jpg"),
                "C:/Manga/chapter1/01.jpg"
            );
        }
        #[cfg(not(windows))]
        {
            assert_eq!(
                decode_request_path("/home/user/manga/01.jpg"),
                "/home/user/manga/01.jpg"
            );
        }
    }

    #[test]
    fn test_parse_range() {
        let total = 1000;
        // Standard range
        assert_eq!(parse_range("bytes=0-499", total), Some((0, 499)));
        // Open ended
        assert_eq!(parse_range("bytes=500-", total), Some((500, 999)));
        // Suffix range
        assert_eq!(parse_range("bytes=-200", total), Some((800, 999)));
        // Clamping end
        assert_eq!(parse_range("bytes=0-2000", total), Some((0, 999)));
        // Out of bounds
        assert_eq!(parse_range("bytes=1000-", total), None);
        assert_eq!(parse_range("bytes=1500-2000", total), None);
        // Invalid syntax
        assert_eq!(parse_range("items=0-10", total), None);
    }

    #[test]
    fn test_parse_range_empty_file_and_delimiters() {
        // Suffix range on empty file must return None
        assert_eq!(parse_range("bytes=-100", 0), None);
        assert_eq!(parse_range("bytes=0-0", 0), None);

        // Extra delimiters must return None
        assert_eq!(parse_range("bytes=0-10-20", 100), None);
        assert_eq!(parse_range("bytes=0--10", 100), None);
        assert_eq!(parse_range("bytes=--10", 100), None);
        assert_eq!(parse_range("bytes=0-10,", 100), None);
        assert_eq!(parse_range("bytes=,0-10", 100), None);
        assert_eq!(parse_range("bytes=0-10, 20-30", 100), None);
        assert_eq!(parse_range("bytes=-", 100), None);
        assert_eq!(parse_range("bytes=abc-def", 100), None);
    }

    #[test]
    fn test_get_mime_type() {
        assert_eq!(get_mime_type("jpg"), "image/jpeg");
        assert_eq!(get_mime_type("jpeg"), "image/jpeg");
        assert_eq!(get_mime_type("png"), "image/png");
        assert_eq!(get_mime_type("webp"), "image/webp");
        assert_eq!(get_mime_type("avif"), "image/avif");
        assert_eq!(get_mime_type("gif"), "image/gif");
        assert_eq!(get_mime_type("svg"), "image/svg+xml");
        assert_eq!(get_mime_type("unknown"), "application/octet-stream");
    }

    #[test]
    fn test_path_to_mangaimg_url() {
        let path = PathBuf::from("C:\\Manga\\Title\\01.jpg");
        let url = path_to_mangaimg_url(&path);
        assert_eq!(url, "http://mangaimg.localhost/C%3A/Manga/Title/01.jpg");
    }

    #[test]
    fn test_path_to_mangaimg_url_special_characters() {
        let path = PathBuf::from("C:\\Manga\\Ch #1\\01% 20 [テスト].jpg");
        let url = path_to_mangaimg_url(&path);
        assert_eq!(
            url,
            "http://mangaimg.localhost/C%3A/Manga/Ch%20%231/01%25%2020%20%5B%E3%83%86%E3%82%B9%E3%83%88%5D.jpg"
        );
        let uri_path = url.trim_start_matches("http://mangaimg.localhost");
        let decoded = decode_request_path(uri_path);
        assert_eq!(decoded, "C:/Manga/Ch #1/01% 20 [テスト].jpg");
    }

    #[test]
    fn test_matches_if_none_match() {
        let current = "W/\"12345-67890\"";

        // Exact match
        assert!(matches_if_none_match("W/\"12345-67890\"", current));
        assert!(matches_if_none_match("\"12345-67890\"", current));

        // List containing matching tag
        assert!(matches_if_none_match(
            "\"old-tag\", \"12345-67890\", \"other\"",
            current
        ));
        assert!(matches_if_none_match(
            "\"old-tag\", W/\"12345-67890\"",
            current
        ));

        // Wildcard
        assert!(matches_if_none_match("*", current));

        // Mismatches
        assert!(!matches_if_none_match("\"different\"", current));
        assert!(!matches_if_none_match("W/\"different\"", current));
        assert!(!matches_if_none_match("\"12345-67890-extra\"", current));
    }

    #[test]
    fn test_weak_etag_formatting() {
        let mtime = 1234567890u128;
        let size = 4096u64;
        let etag = format!("W/\"{:x}-{:x}\"", mtime, size);
        assert!(etag.starts_with("W/\""));
        assert!(matches_if_none_match(&etag, &etag));
        assert!(matches_if_none_match("\"499602d2-1000\"", &etag));
    }

    #[test]
    fn test_cors_origin_restriction() {
        let req_trusted = Request::builder()
            .header("Origin", "http://localhost:5173")
            .body(Vec::new())
            .unwrap();
        assert_eq!(
            get_cors_allow_origin(&req_trusted),
            Some("http://localhost:5173")
        );

        let req_untrusted = Request::builder()
            .header("Origin", "https://malicious-website.com")
            .body(Vec::new())
            .unwrap();
        assert_eq!(get_cors_allow_origin(&req_untrusted), None);

        let req_no_origin = Request::builder().body(Vec::new()).unwrap();
        assert_eq!(get_cors_allow_origin(&req_no_origin), None);
    }

    #[test]
    fn test_parse_and_build_page_resource_url() {
        let manga_id = "berserk #1";
        let version = "17000000";
        let transform = "preview";
        let rel_path = "Ch 1/01 [raw] %20.jpg";

        let url = build_page_resource_url(manga_id, version, transform, rel_path, None);
        assert!(url.starts_with("http://mangaimg.localhost/page/"));
        assert!(url.contains("berserk%20%231"));
        assert!(url.contains("17000000"));
        assert!(url.contains("preview"));

        let uri_path = url.trim_start_matches("http://mangaimg.localhost");
        let parsed = parse_page_resource_uri(uri_path).expect("should parse page URI");
        assert_eq!(parsed.manga_id, "berserk #1");
        assert_eq!(parsed.version, "17000000");
        assert_eq!(parsed.transform, "preview");
        assert_eq!(parsed.rel_path, "Ch 1/01 [raw] %20.jpg");
    }

    #[test]
    fn test_parse_and_build_cover_resource_url() {
        let manga_id = "one piece #100";
        let version = "17100000";

        let url = build_cover_resource_url(manga_id, Some(version));
        assert_eq!(
            url,
            "http://mangaimg.localhost/cover/one%20piece%20%23100/17100000"
        );

        let uri_path = url.trim_start_matches("http://mangaimg.localhost");
        let parsed = parse_cover_resource_uri(uri_path).expect("should parse cover URI");
        assert_eq!(parsed.manga_id, "one piece #100");
        assert_eq!(parsed.version, Some("17100000".to_string()));

        let url_no_ver = build_cover_resource_url(manga_id, None);
        assert_eq!(
            url_no_ver,
            "http://mangaimg.localhost/cover/one%20piece%20%23100"
        );
        let uri_no_ver = url_no_ver.trim_start_matches("http://mangaimg.localhost");
        let parsed_no_ver =
            parse_cover_resource_uri(uri_no_ver).expect("should parse cover URI without version");
        assert_eq!(parsed_no_ver.manga_id, "one piece #100");
        assert_eq!(parsed_no_ver.version, None);
    }

    #[test]
    fn test_parse_fit_dimensions() {
        assert_eq!(parse_fit_dimensions("fit_800x1200"), Some((800, 1200)));
        assert_eq!(parse_fit_dimensions("fit_1000x1600"), Some((1000, 1600)));
        assert_eq!(parse_fit_dimensions("preview"), None);
        assert_eq!(parse_fit_dimensions("fit_0x1200"), None);
        assert_eq!(parse_fit_dimensions("fit_800x0"), None);
        assert_eq!(parse_fit_dimensions("fit_abcx120"), None);
    }
}
