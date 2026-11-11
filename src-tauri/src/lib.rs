pub mod commands;
pub mod db;
pub mod migration;
pub mod validation;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Migrate any profile data from legacy identifier com.mangareader.desktop before WebView2 launches
    migration::migrate_legacy_data_if_needed();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(tauri::generate_handler![
            commands::fs::select_folder,
            commands::fs::list_folder,
            commands::fs::read_file,
            commands::fs::get_image_dimensions,
            commands::fs::cancel_scan,
            commands::fs::natural_sort_paths,
            commands::fs::prepare_chapter_headers,
            commands::fs::discover_library,
            commands::window::set_progress_bar,
            commands::cache::save_thumbnail,
            commands::cache::read_thumbnail,
            commands::cache::delete_thumbnail,
            commands::cache::clear_thumbnails,
            commands::image::generate_thumbnail,
            commands::image::generate_image_variant,
            commands::config::get_app_config,
            commands::config::save_app_config,
            commands::config::set_app_preference,
            commands::config::get_app_preference,
            commands::config::record_opened_root,
            commands::config::get_last_opened_roots,
            db::is_library_migrated,
            db::import_legacy_library,
            db::sqlite_list_library,
            db::sqlite_get_manga,
            db::sqlite_save_manga,
            db::sqlite_save_progress,
            db::sqlite_add_bookmark,
            db::sqlite_remove_bookmark,
            db::sqlite_get_bookmarked_manga_ids,
            db::sqlite_delete_manga,
            db::sqlite_clear_library,
            db::sqlite_reset_progress,
            db::sqlite_get_settings,
            db::sqlite_save_settings,
            db::validate_library_backup,
            db::export_library_backup,
            db::restore_library_backup,
            commands::indexing::index_title,
        ])
        .on_window_event(|window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let app = window.app_handle();
                    if let Some(config_state) = app.try_state::<commands::config::AppConfigState>() {
                        if config_state.get().window_preferences.close_to_tray {
                            api.prevent_close();
                            let _ = window.hide();
                        }
                    }
                }
                tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }) => {
                    let app = window.app_handle();
                    if let Some(allowed) = app.try_state::<commands::fs::AllowedRoots>() {
                        for path in paths {
                            if path.is_dir() {
                                allowed.add_root(path.clone());
                            } else if let Some(parent) = path.parent() {
                                allowed.add_root(parent.to_path_buf());
                            }
                        }
                        commands::fs::save_persisted_roots(app, &allowed.0.read().unwrap());
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            let handle = app.handle();
            let initial_roots = commands::fs::init_allowed_roots(&handle);
            let config_state = commands::config::AppConfigState::new(&handle);
            {
                let cfg = config_state.get();
                for root in &cfg.last_opened_roots {
                    initial_roots.add_root(std::path::PathBuf::from(root));
                }
            }
            commands::fs::save_persisted_roots(&handle, &initial_roots.0.read().unwrap());
            app.manage(initial_roots);
            app.manage(commands::fs::ScanManager::default());
            app.manage(config_state);

            // Initialize SQLite library database
            let db_path = handle
                .path()
                .app_data_dir()
                .map_err(|e| format!("Failed to resolve app data dir: {e}"))?
                .join("library.db");
            if let Some(parent) = db_path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let conn = rusqlite::Connection::open(&db_path)
                .map_err(|e| format!("Failed to open SQLite database at {:?}: {e}", db_path))?;
            db::init_db(&conn)
                .map_err(|e| format!("Failed to initialize SQLite schema: {e}"))?;
            app.manage(db::DbState(std::sync::Mutex::new(conn)));

            // System tray menu & icon
            let show_item = MenuItem::with_id(app, "show", "Show Manga Reader", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::new().menu(&tray_menu).show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _tray = tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            let win_cfg = app
                .config()
                .app
                .windows
                .iter()
                .find(|w| w.label == "main")
                .ok_or_else(|| "main window config not found".to_string())?;

            let window = tauri::WebviewWindowBuilder::from_config(app, win_cfg)?
                .initialization_script(commands::window::INIT_SCRIPT)
                .build()?;

            // Show the window now that setup is complete (eliminates cold start white flash)
            let _ = window.show();

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
