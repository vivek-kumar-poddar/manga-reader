use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::time::UNIX_EPOCH;
use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager};

use crate::commands::fs::{ALLOWED_IMAGE_EXTENSIONS, AllowedRoots, MAX_FILE_READ_BYTES};

use super::cache::{is_explicit_cache_artifact, safe_name, try_find_and_generate_cover};
use super::types::{
    MAX_RANGE_CHUNK_BYTES, apply_cors, error_response, get_mime_type, matches_if_none_match,
};
use super::urls::{
    decode_request_path, parse_cover_resource_uri, parse_fit_dimensions, parse_page_resource_uri,
    parse_range,
};

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
        let req_size: u32 = req
            .uri()
            .query()
            .and_then(|q| {
                q.split('&').find_map(|pair| {
                    let (k, v) = pair.split_once('=')?;
                    if k == "size" {
                        v.parse::<u32>().ok()
                    } else {
                        None
                    }
                })
            })
            .or(cover_params.size)
            .unwrap_or(512);

        let safe_id = crate::commands::cache::sanitize_id(&cover_params.manga_id);
        let cache_dir = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| PathBuf::from("cache"));
        let thumb_dir = cache_dir.join("thumbnails");
        let sized_path = thumb_dir.join(format!("{safe_id}_{req_size}.webp"));
        let default_path = thumb_dir.join(format!("{safe_id}.webp"));

        if sized_path.exists() {
            sized_path
        } else {
            let local_path_opt = app
                .try_state::<crate::db::DbState>()
                .and_then(|db| db.get_local_path_sync(&cover_params.manga_id));
            if let Some(ref lp) = local_path_opt {
                let base = PathBuf::from(lp);
                match try_find_and_generate_cover(app, &base, &cover_params.manga_id, req_size) {
                    Ok(p) => p,
                    Err(_) => {
                        if default_path.exists() {
                            default_path
                        } else {
                            return error_response(
                                StatusCode::NOT_FOUND,
                                "Cover image not found",
                                &req,
                            );
                        }
                    }
                }
            } else if default_path.exists() {
                default_path
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

        let base_dir = PathBuf::from(base_dir_str.trim());
        let allowed = app.state::<AllowedRoots>();
        if !allowed.is_allowed(&base_dir) {
            return error_response(
                StatusCode::FORBIDDEN,
                "Base root is not under an authorized library root",
                &req,
            );
        }
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
                    app, &resolved, 768, 768,
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
