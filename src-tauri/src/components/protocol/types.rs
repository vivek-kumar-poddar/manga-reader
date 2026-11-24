use tauri::http::{Request, Response, StatusCode};

pub const MAX_RANGE_CHUNK_BYTES: u64 = 8 * 1024 * 1024; // 8 MiB range chunk cap

pub const TRUSTED_ORIGINS: &[&str] = &[
    "tauri://localhost",
    "https://tauri.localhost",
    "http://tauri.localhost",
    "http://localhost:5173",
    "http://mangaimg.localhost",
];

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
    pub size: Option<u32>,
}

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

pub fn apply_cors(
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

pub fn error_response(
    status: StatusCode,
    message: &str,
    req: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header("Content-Type", "text/plain; charset=utf-8");
    builder = apply_cors(builder, req);
    builder
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}
