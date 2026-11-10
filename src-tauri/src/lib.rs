pub mod commands;

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
        ])
        .setup(|app| {
            let handle = app.handle();
            let initial_roots = commands::fs::init_allowed_roots(&handle);
            app.manage(initial_roots);
            app.manage(commands::fs::ScanManager::default());

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
