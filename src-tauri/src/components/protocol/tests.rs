use std::path::PathBuf;
use tauri::http::Request;

use super::types::{get_cors_allow_origin, get_mime_type, matches_if_none_match};
use super::urls::{
    build_cover_resource_url, build_page_resource_url, decode_request_path,
    parse_cover_resource_uri, parse_fit_dimensions, parse_page_resource_uri, parse_range,
    path_to_mangaimg_url,
};

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
