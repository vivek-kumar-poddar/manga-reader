fn main() {
  let attributes = tauri_build::Attributes::new()
    .app_manifest(tauri_build::AppManifest::new().commands(&[
      "select_folder",
      "list_folder",
      "read_file",
      "get_image_dimensions",
      "cancel_scan",
      "natural_sort_paths",
      "prepare_chapter_headers",
      "discover_library",
      "set_progress_bar",
      "save_thumbnail",
      "read_thumbnail",
      "get_thumbnail_url",
      "delete_thumbnail",
      "clear_thumbnails",
      "generate_thumbnail",
      "generate_image_variant",
      "get_app_config",
      "save_app_config",
      "set_app_preference",
      "get_app_preference",
      "record_opened_root",
      "get_last_opened_roots",
      "is_library_migrated",
      "import_legacy_library",
      "sqlite_list_library",
      "sqlite_get_manga",
      "sqlite_save_manga",
      "sqlite_save_progress",
      "sqlite_add_bookmark",
      "sqlite_remove_bookmark",
      "sqlite_get_bookmarked_manga_ids",
      "sqlite_delete_manga",
      "sqlite_clear_library",
      "sqlite_reset_progress",
      "sqlite_get_settings",
      "sqlite_save_settings",
      "validate_library_backup",
      "export_library_backup",
      "restore_library_backup",
      "index_title",
    ]));
  tauri_build::try_build(attributes).expect("failed to run tauri-build");

  // Ensure WebView2Loader.dll is copied into target/<profile>/deps/ so cargo test finds it on Windows GNU
  if let Ok(profile) = std::env::var("PROFILE") {
    let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
    let target_dir = manifest_dir.join("target").join(&profile);
    let src_dll = target_dir.join("WebView2Loader.dll");
    let deps_dir = target_dir.join("deps");
    if src_dll.exists() {
      let _ = std::fs::create_dir_all(&deps_dir);
      let _ = std::fs::copy(&src_dll, deps_dir.join("WebView2Loader.dll"));
    }
  }
}
