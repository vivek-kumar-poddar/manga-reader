use super::*;
use std::cmp::Ordering;
use std::path::Path;

#[test]
fn test_natural_order_chapters() {
    assert_eq!(natural_order("Chapter 1", "Chapter 2"), Ordering::Less);
    assert_eq!(natural_order("Chapter 2", "Chapter 10"), Ordering::Less);
    assert_eq!(natural_order("Chapter 10", "Chapter 2"), Ordering::Greater);
    assert_eq!(natural_order("Chapter 1.5", "Chapter 1"), Ordering::Greater);
    assert_eq!(natural_order("Chapter 1.5", "Chapter 2"), Ordering::Less);
    assert_eq!(natural_order("001.png", "2.png"), Ordering::Less);
    assert_eq!(natural_order("10.jpg", "2.jpg"), Ordering::Greater);
    assert_eq!(natural_order("same", "same"), Ordering::Equal);

    // Long digit string precision (> 18 digits)
    assert_eq!(
        natural_order(
            "item_100000000000000000000001",
            "item_100000000000000000000002"
        ),
        Ordering::Less
    );
    assert_eq!(
        natural_order(
            "item_100000000000000000000002",
            "item_100000000000000000000001"
        ),
        Ordering::Greater
    );
}

#[test]
fn test_natural_order_categories() {
    assert_eq!(natural_order("Prologue", "Chapter 1"), Ordering::Less);
    assert_eq!(natural_order("Opening", "Chapter 1"), Ordering::Less);
    assert_eq!(natural_order("Chapter 50", "Epilogue"), Ordering::Less);
    assert_eq!(natural_order("Chapter 50", "Extra 1"), Ordering::Less);
    assert_eq!(natural_order("Chapter 50", "Bonus 1"), Ordering::Less);
    assert_eq!(natural_order("Chapter 50", "Special"), Ordering::Less);
}

#[test]
fn test_is_image_file() {
    for ext in ALLOWED_IMAGE_EXTENSIONS {
        let filename = format!("cover.{}", ext);
        assert!(
            is_image_file(Path::new(&filename)),
            "Extension .{} should be allowed",
            ext
        );
        let uppercase = format!("cover.{}", ext.to_uppercase());
        assert!(
            is_image_file(Path::new(&uppercase)),
            "Uppercase .{} should be allowed",
            ext
        );
    }

    assert!(!is_image_file(Path::new("document.pdf")));
    assert!(!is_image_file(Path::new("script.js")));
    assert!(!is_image_file(Path::new("archive.zip")));
    assert!(!is_image_file(Path::new(".gitignore")));
    assert!(!is_image_file(Path::new("noextension")));
}

#[test]
fn test_is_ignored_directory() {
    assert!(is_ignored_directory(Path::new(".git")));
    assert!(is_ignored_directory(Path::new(".svn")));
    assert!(is_ignored_directory(Path::new(".cache")));
    assert!(is_ignored_directory(Path::new("node_modules")));
    assert!(is_ignored_directory(Path::new("$recycle.bin")));
    assert!(is_ignored_directory(Path::new("System Volume Information")));

    assert!(!is_ignored_directory(Path::new("Chapter 1")));
    assert!(!is_ignored_directory(Path::new("Volume 1")));
    assert!(!is_ignored_directory(Path::new("manga")));
}

#[test]
fn test_write_atomic() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);
    let target = temp_dir.join("config.json");
    let tmp = target.with_extension("tmp");

    let content = b"{\"theme\":\"dark\"}";
    assert!(write_atomic(&target, content).is_ok());

    assert!(target.exists());
    assert!(!tmp.exists());
    assert_eq!(std::fs::read(&target).unwrap(), content);

    let updated = b"{\"theme\":\"light\"}";
    assert!(write_atomic(&target, updated).is_ok());
    assert_eq!(std::fs::read(&target).unwrap(), updated);

    // Test concurrent writers to the same destination
    let mut handles = Vec::new();
    for i in 0..8 {
        let target_clone = target.clone();
        handles.push(std::thread::spawn(move || {
            let data = format!("{{\"worker\":{i}}}");
            write_atomic(&target_clone, data.as_bytes()).unwrap();
        }));
    }
    for h in handles {
        h.join().unwrap();
    }
    assert!(target.exists());
    let final_content = std::fs::read_to_string(&target).unwrap();
    assert!(final_content.starts_with("{\"worker\":"));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_parse_image_dimensions() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_dim_test_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    // 1x1 transparent PNG
    let png_bytes = [
        0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
        0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f,
        0x15, 0xc4, 0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00,
        0x01, 0x00, 0x00, 0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
        0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ];
    let png_path = temp_dir.join("test.png");
    std::fs::write(&png_path, png_bytes).unwrap();

    let (w, h) = parse_image_dimensions(&png_path);
    assert_eq!(w, Some(1));
    assert_eq!(h, Some(1));

    let invalid_path = temp_dir.join("invalid.txt");
    std::fs::write(&invalid_path, b"not an image").unwrap();
    let (inv_w, inv_h) = parse_image_dimensions(&invalid_path);
    assert_eq!(inv_w, None);
    assert_eq!(inv_h, None);

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_allowed_roots() {
    let allowed = AllowedRoots::default();
    // Empty roots denies all
    assert!(!allowed.is_allowed(Path::new("C:\\Any\\Path")));

    let root = std::env::temp_dir().join("manga_root_test");
    let _ = std::fs::create_dir_all(&root);
    allowed.add_root(root.clone());

    let subfile = root.join("title").join("01.png");
    assert!(allowed.is_allowed(&subfile));

    let outside = std::env::temp_dir().join("other_folder_outside");
    assert!(!allowed.is_allowed(&outside));

    // Traversal path outside root rejected
    let traversal = root.join("..").join("outside.png");
    let canonical_traversal = dunce::canonicalize(&traversal).unwrap_or(traversal);
    assert!(!allowed.is_allowed(&canonical_traversal));

    let _ = std::fs::remove_dir_all(&root);
}

#[test]
fn test_natural_order_fixture_parity() {
    let fixtures = vec![
        "001.jpg",
        "002.jpg",
        "010.jpg",
        "099.jpg",
        "100.jpg",
        "Chapter 1",
        "Chapter 1.5",
        "Chapter 2",
        "Chapter 3",
        "Chapter 9",
        "Chapter 10",
        "Chapter 10.1",
        "Chapter 10.2",
        "Chapter 11",
        "Chapter 100",
        "Vol. 1 Ch. 1",
        "Vol. 1 Ch. 2",
        "Volume 1/Chapter 1/01.jpg",
        "Volume 1/Chapter 2/01.jpg",
        "Vol. 2 Ch. 1",
        "Volume 2/Chapter 1/01.jpg",
        "Vol. 10 Ch. 1",
        "Volume 10/Chapter 1/01.jpg",
    ];

    let mut sorted = fixtures.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    sorted.sort_by(|a, b| natural_order(a, b));

    // Check canonical sorted order invariant
    assert_eq!(sorted[0], "001.jpg");
    assert_eq!(sorted[1], "002.jpg");
    assert_eq!(sorted[2], "010.jpg");
    assert_eq!(sorted[3], "099.jpg");
    assert_eq!(sorted[4], "100.jpg");
    assert_eq!(sorted[5], "Chapter 1");
    assert_eq!(sorted[6], "Chapter 1.5");
    assert_eq!(sorted[7], "Chapter 2");
    assert_eq!(sorted[8], "Chapter 3");
    assert_eq!(sorted[9], "Chapter 9");
    assert_eq!(sorted[10], "Chapter 10");
    assert_eq!(sorted[11], "Chapter 10.1");
    assert_eq!(sorted[12], "Chapter 10.2");
    assert_eq!(sorted[13], "Chapter 11");
    assert_eq!(sorted[14], "Chapter 100");
}

#[test]
fn test_parse_image_dimensions_corrupted_headers() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_dim_corrupt_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    // Truncated PNG header
    let trunc_png = temp_dir.join("trunc.png");
    std::fs::write(&trunc_png, [0x89, 0x50, 0x4e, 0x47]).unwrap();
    let (tw, th) = parse_image_dimensions(&trunc_png);
    assert_eq!(tw, None);
    assert_eq!(th, None);

    // Empty file
    let empty_file = temp_dir.join("empty.jpg");
    std::fs::write(&empty_file, b"").unwrap();
    let (ew, eh) = parse_image_dimensions(&empty_file);
    assert_eq!(ew, None);
    assert_eq!(eh, None);

    // Valid GIF 1x1
    let gif_bytes = [
        0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0xff, 0xff,
        0xff, 0x00, 0x00, 0x00, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00,
        0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
    ];
    let gif_file = temp_dir.join("test.gif");
    std::fs::write(&gif_file, gif_bytes).unwrap();
    let (gw, gh) = parse_image_dimensions(&gif_file);
    assert_eq!(gw, Some(1));
    assert_eq!(gh, Some(1));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_is_same_path() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_same_path_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    let sub_dir = temp_dir.join("subfolder");
    let _ = std::fs::create_dir_all(&sub_dir);

    let p1 = sub_dir.to_string_lossy().to_string();
    let p2 = format!("{}/", p1.replace('\\', "/"));
    assert!(is_same_path(p1.clone(), p2));

    let non_existent_1 = "C:/test/path/b".to_string();
    let non_existent_2 = "C:\\test\\path\\b".to_string();
    // Fallback normalized comparison handles case/slash differences
    assert!(is_same_path(non_existent_1, non_existent_2));

    let different = temp_dir.to_string_lossy().to_string();
    assert!(!is_same_path(p1, different));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_scan_manager_atomic_cancellation() {
    let mgr = ScanManager::default();
    let handle = mgr.register("scan-123");
    assert!(!handle.flag.load(std::sync::atomic::Ordering::Relaxed));
    assert!(!*handle.receiver.borrow());

    assert!(mgr.cancel("scan-123"));
    assert!(handle.flag.load(std::sync::atomic::Ordering::Relaxed));
    assert!(*handle.receiver.borrow());
    assert!(mgr.is_cancelled("scan-123"));

    mgr.unregister("scan-123");
    assert!(!mgr.cancel("scan-123"));
}

#[test]
fn test_resolve_relative_path_safety() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_resolve_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    let ch1 = temp_dir.join("Chapter 1");
    let _ = std::fs::create_dir_all(&ch1);
    let page1 = ch1.join("01.jpg");
    std::fs::write(&page1, b"fake image").unwrap();

    // 1. Valid resolution
    let resolved = resolve_relative_path(&temp_dir, "Chapter 1/01.jpg").unwrap();
    assert_eq!(
        dunce::canonicalize(&page1).unwrap(),
        dunce::canonicalize(resolved).unwrap()
    );

    // 2. Traversal rejection
    assert!(matches!(
        resolve_relative_path(&temp_dir, "../secret.txt"),
        Err(FsError::PathNotAllowed(_))
    ));
    assert!(matches!(
        resolve_relative_path(&temp_dir, "Chapter 1/../../secret.txt"),
        Err(FsError::PathNotAllowed(_))
    ));

    // 3. Absolute path rejection
    #[cfg(windows)]
    {
        assert!(matches!(
            resolve_relative_path(&temp_dir, "C:/Windows/System32/cmd.exe"),
            Err(FsError::PathNotAllowed(_))
        ));
        assert!(matches!(
            resolve_relative_path(&temp_dir, "/Windows/System32"),
            Err(FsError::PathNotAllowed(_))
        ));
    }

    // 4. Non-existent file error
    assert!(matches!(
        resolve_relative_path(&temp_dir, "Chapter 1/does_not_exist.jpg"),
        Err(FsError::NotFound(_))
    ));

    let _ = std::fs::remove_dir_all(&temp_dir);
}

#[test]
fn test_revoke_root_and_get_authorized_roots() {
    let temp_dir = std::env::temp_dir().join(format!(
        "manga_roots_{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let _ = std::fs::create_dir_all(&temp_dir);

    let allowed = AllowedRoots::default();
    assert_eq!(allowed.get_roots().len(), 0);

    allowed.add_root(temp_dir.clone());
    assert!(allowed.is_allowed(&temp_dir));
    assert_eq!(allowed.get_roots().len(), 1);

    // Revoke root
    assert!(allowed.revoke_root(&temp_dir));
    assert!(!allowed.is_allowed(&temp_dir));
    assert_eq!(allowed.get_roots().len(), 0);

    // Revoking already revoked root returns false
    assert!(!allowed.revoke_root(&temp_dir));

    let _ = std::fs::remove_dir_all(&temp_dir);
}
