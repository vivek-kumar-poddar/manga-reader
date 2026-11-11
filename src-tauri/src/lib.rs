pub mod commands;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::Manager;


#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
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
            commands::fs::register_allowed_roots,
            commands::fs::natural_sort_paths,
            commands::fs::prepare_chapter_headers,
            commands::fs::discover_library,
            commands::window::set_progress_bar,
            commands::cache::save_thumbnail,
            commands::cache::read_thumbnail,
            commands::cache::delete_thumbnail,
            commands::cache::clear_thumbnails,
            commands::config::get_app_config,
            commands::config::save_app_config,
            commands::config::set_app_preference,
            commands::config::get_app_preference,
            commands::config::record_opened_root,
            commands::config::get_last_opened_roots,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let app = window.app_handle();
                if let Some(config_state) = app.try_state::<commands::config::AppConfigState>() {
                    if config_state.get().window_preferences.close_to_tray {
                        api.prevent_close();
                        let _ = window.hide();
                    }
                }
            }
        })
        .setup(|app| {
            let handle = app.handle();
            let initial_roots = commands::fs::init_allowed_roots(&handle);
            app.manage(initial_roots);
            app.manage(commands::fs::ScanManager::default());
            app.manage(commands::config::AppConfigState::new(&handle));

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

            if let Some(window) = app.get_webview_window("main") {
                // Inject script to freeze zoom, prevent drag-drop navigation, and route external links
                let _ = window.eval(commands::window::INIT_SCRIPT);

                // Show the window now that setup is complete (eliminates cold start white flash)
                let _ = window.show();
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
