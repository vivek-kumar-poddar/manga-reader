use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::WebviewWindow;

/// JavaScript initialization script injected into the webview to lock visual zoom,
/// prevent accidental drag-and-drop navigation away from index.html, route
/// external HTTP/HTTPS links to the system's default browser, and signal frontend readiness.
pub const INIT_SCRIPT: &str = include_str!("../../scripts/init.js");

#[tauri::command(async)]
pub fn show_main_window(window: WebviewWindow) -> Result<(), String> {
    window.show().map_err(|e| e.to_string())?;
    let _ = window.set_focus();
    Ok(())
}

#[tauri::command(async)]
pub fn set_progress_bar(window: WebviewWindow, progress: f64) -> Result<(), String> {
    let state = if progress < 0.0 {
        ProgressBarState {
            progress: None,
            status: Some(ProgressBarStatus::None),
        }
    } else if progress > 1.0 {
        ProgressBarState {
            progress: None,
            status: Some(ProgressBarStatus::Indeterminate),
        }
    } else {
        let percent = (progress * 100.0).round().clamp(0.0, 100.0) as u64;
        ProgressBarState {
            progress: Some(percent),
            status: Some(ProgressBarStatus::Normal),
        }
    };

    let _ = window.set_progress_bar(state);
    Ok(())
}
