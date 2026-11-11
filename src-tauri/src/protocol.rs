use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::commands::fs::{AllowedRoots, ALLOWED_IMAGE_EXTENSIONS, MAX_FILE_READ_BYTES};

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

pub fn parse_range(header_val: &str, total_size: u64) -> Option<(u64, u64)> {
    let trimmed = header_val.trim();
    if !trimmed.starts_with("bytes=") {
        return None;
    }
    let range_str = &trimmed[6..];
    let mut parts = range_str.split(',');
    let first_range = parts.next()?.trim();

    let mut bounds = first_range.split('-');
    let start_str = bounds.next()?.trim();
    let end_str = bounds.next()?.trim();

    if start_str.is_empty() {
        let suffix_len: u64 = end_str.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = total_size.saturating_sub(suffix_len);
        let end = total_size.saturating_sub(1);
        Some((start, end))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= total_size {
            return None;
        }
        let end = if end_str.is_empty() {
            total_size.saturating_sub(1)
        } else {
            let parsed_end: u64 = end_str.parse().ok()?;
            parsed_end.min(total_size.saturating_sub(1))
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

fn error_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8")
        .header("Access-Control-Allow-Origin", "*")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

pub fn is_in_thumbnail_cache(app: &AppHandle, path: &Path) -> bool {
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        if path.starts_with(&cache_dir) {
            return true;
        }
    }
    if let Ok(app_dir) = app.path().app_data_dir() {
        let cache_dir = app_dir.join("cache");
        if path.starts_with(&cache_dir) {
            return true;
        }
    }
    false
}

pub fn path_to_mangaimg_url(path: &Path) -> String {
    let s = path.to_string_lossy().replace('\\', "/");
    let trimmed = s.trim_start_matches('/');
    let formatted = if trimmed.len() >= 2 && trimmed.as_bytes()[1] == b':' {
        let drive = &trimmed[0..1];
        let rest = &trimmed[2..];
        format!("{drive}%3A{rest}")
    } else {
        trimmed.to_string()
    };
    format!("http://mangaimg.localhost/{}", formatted)
}

pub fn handle_mangaimg_request(app: &AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let uri_path = req.uri().path();
    let decoded_path = decode_request_path(uri_path);

    if decoded_path.is_empty() {
        return error_response(StatusCode::BAD_REQUEST, "Missing file path");
    }

    let raw_path = PathBuf::from(&decoded_path);
    let resolved = match dunce::canonicalize(&raw_path) {
        Ok(p) => p,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "Target file not found"),
    };

    // 1. Path allowlist checks (AllowedRoots or app thumbnail cache)
    let allowed = app.state::<AllowedRoots>();
    let is_allowed = allowed.is_allowed(&resolved) || is_in_thumbnail_cache(app, &resolved);
    if !is_allowed {
        return error_response(
            StatusCode::FORBIDDEN,
            "Path is not under an allowed library root",
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
        );
    }

    // 3. Regular file and size check (100 MiB cap)
    let metadata = match std::fs::metadata(&resolved) {
        Ok(m) => m,
        Err(_) => return error_response(StatusCode::NOT_FOUND, "Failed to inspect file metadata"),
    };

    if !metadata.is_file() {
        return error_response(StatusCode::NOT_FOUND, "Target path is not a regular file");
    }

    let total_size = metadata.len();
    if total_size > MAX_FILE_READ_BYTES {
        return error_response(
            StatusCode::PAYLOAD_TOO_LARGE,
            "File exceeds 100 MiB safety limit",
        );
    }

    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0);

    let etag = format!("\"{:x}-{:x}\"", mtime_ms, total_size);
    let mime = get_mime_type(&ext);

    // 4. Conditional GET via ETag (304 Not Modified)
    if let Some(if_none_match) = req.headers().get("if-none-match") {
        if if_none_match.as_bytes() == etag.as_bytes() {
            return Response::builder()
                .status(StatusCode::NOT_MODIFIED)
                .header("ETag", &etag)
                .header("Cache-Control", "public, max-age=31536000, immutable")
                .header("Access-Control-Allow-Origin", "*")
                .body(Vec::new())
                .unwrap_or_else(|_| Response::new(Vec::new()));
        }
    }

    let is_head = req.method() == "HEAD";

    // 5. HTTP Range request handling (206 Partial Content)
    if let Some(range_header) = req.headers().get("range") {
        if let Ok(range_str) = range_header.to_str() {
            if let Some((start, end)) = parse_range(range_str, total_size) {
                let length = end - start + 1;
                let body = if is_head {
                    Vec::new()
                } else {
                    let mut file = match File::open(&resolved) {
                        Ok(f) => f,
                        Err(e) => {
                            return error_response(
                                StatusCode::INTERNAL_SERVER_ERROR,
                                &format!("IO error: {e}"),
                            )
                        }
                    };
                    if let Err(e) = file.seek(SeekFrom::Start(start)) {
                        return error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &format!("Seek error: {e}"),
                        );
                    }
                    let mut buffer = vec![0u8; length as usize];
                    if let Err(e) = file.read_exact(&mut buffer) {
                        return error_response(
                            StatusCode::INTERNAL_SERVER_ERROR,
                            &format!("Read error: {e}"),
                        );
                    }
                    buffer
                };

                return Response::builder()
                    .status(StatusCode::PARTIAL_CONTENT)
                    .header("Content-Type", mime)
                    .header("Content-Length", length.to_string())
                    .header(
                        "Content-Range",
                        format!("bytes {}-{}/{}", start, end, total_size),
                    )
                    .header("Accept-Ranges", "bytes")
                    .header("ETag", &etag)
                    .header("Cache-Control", "public, max-age=31536000, immutable")
                    .header("Access-Control-Allow-Origin", "*")
                    .body(body)
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            } else {
                return Response::builder()
                    .status(StatusCode::RANGE_NOT_SATISFIABLE)
                    .header("Content-Range", format!("bytes */{}", total_size))
                    .header("Access-Control-Allow-Origin", "*")
                    .body(Vec::new())
                    .unwrap_or_else(|_| Response::new(Vec::new()));
            }
        }
    }

    // 6. Full content response (200 OK)
    let body = if is_head {
        Vec::new()
    } else {
        match std::fs::read(&resolved) {
            Ok(b) => b,
            Err(e) => {
                return error_response(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    &format!("Failed to read file: {e}"),
                )
            }
        }
    };

    Response::builder()
        .status(StatusCode::OK)
        .header("Content-Type", mime)
        .header("Content-Length", total_size.to_string())
        .header("Accept-Ranges", "bytes")
        .header("ETag", &etag)
        .header("Cache-Control", "public, max-age=31536000, immutable")
        .header("Access-Control-Allow-Origin", "*")
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
}
