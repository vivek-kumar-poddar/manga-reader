fn main() {
    let attributes =
        tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&[
            "select_folder",
            "list_folder",
            "read_file",
            "get_image_dimensions",
            "cancel_scan",
            "natural_sort_paths",
            "prepare_chapter_headers",
            "discover_library",
            "is_same_path",
            "resolve_manga_path",
            "check_access",
            "revoke_root",
            "get_authorized_roots",
            "set_progress_bar",
            "show_main_window",
            "save_thumbnail",
            "read_thumbnail",
            "get_thumbnail_url",
            "delete_thumbnail",
            "clear_thumbnails",
            "generate_thumbnail",
            "generate_image_variant",
            "get_app_config",
            "save_app_config",
            "set_window_preferences",
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
            "get_storage_stats",
            "save_file_dialog",
        ]));
    tauri_build::try_build(attributes).expect("failed to run tauri-build");

    // On Windows GNU, pass the specs file to prevent GCC from including a conflicting default manifest
    // and compile manifest.rc to embed the Common Controls v6 manifest for TaskDialogIndirect
    let target = std::env::var("TARGET").unwrap_or_default();
    if target.contains("windows-gnu") {
        let manifest_dir = std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap());
        let specs_path = manifest_dir.join("no-default-manifest.specs");
        if specs_path.exists() {
            println!(
                "cargo:rustc-link-arg=-specs={}",
                specs_path.display().to_string().replace('\\', "/")
            );
        }

        let rc_path = manifest_dir.join("manifest.rc");
        if rc_path.exists() {
            let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
            let out_o = out_dir.join("manifest.o");
            let status = std::process::Command::new("windres")
                .current_dir(&manifest_dir)
                .arg("-i")
                .arg(&rc_path)
                .arg("-o")
                .arg(&out_o)
                .status()
                .expect("Failed to execute windres to compile manifest.rc");

            assert!(
                status.success(),
                "windres failed to compile manifest.rc into manifest.o"
            );

            println!(
                "cargo:rustc-link-arg={}",
                out_o.display().to_string().replace('\\', "/")
            );
        }
    }

    // Ensure WebView2Loader.dll is copied into <profile>/deps/ so cargo test finds it on Windows GNU.
    // Resolve profile directory dynamically from OUT_DIR ancestors to support custom target dirs and triples.
    if let Ok(out_dir_str) = std::env::var("OUT_DIR") {
        let out_dir = std::path::PathBuf::from(out_dir_str);
        if let Some(profile_dir) = out_dir.ancestors().nth(3) {
            let src_dll = profile_dir.join("WebView2Loader.dll");
            let deps_dir = profile_dir.join("deps");
            if src_dll.exists() {
                let _ = std::fs::create_dir_all(&deps_dir);
                let _ = std::fs::copy(&src_dll, deps_dir.join("WebView2Loader.dll"));
            }
        }
    }
}
