use tauri::window::{ProgressBarState, ProgressBarStatus};
use tauri::WebviewWindow;

/// JavaScript initialization script injected into the webview to lock visual zoom,
/// prevent accidental drag-and-drop navigation away from index.html, and route
/// external HTTP/HTTPS links to the system's default browser.
pub const INIT_SCRIPT: &str = r#"
(function() {
  // Prevent Ctrl + '+', '-', '=', '0' browser zoom
  window.addEventListener('keydown', function(e) {
    if (e.ctrlKey && (e.key === '+' || e.key === '-' || e.key === '=' || e.key === '0')) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent Ctrl + Wheel zoom
  window.addEventListener('wheel', function(e) {
    if (e.ctrlKey) {
      e.preventDefault();
    }
  }, { passive: false });

  // Prevent trackpad / touch gesture zoom on Windows high-DPI displays
  window.addEventListener('gesturestart', function(e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('gesturechange', function(e) { e.preventDefault(); }, { passive: false });
  window.addEventListener('gestureend', function(e) { e.preventDefault(); }, { passive: false });

  // Prevent default drag-over and drag-drop navigation away from index.html
  window.addEventListener('dragover', function(e) {
    e.preventDefault();
  }, false);

  window.addEventListener('drop', function(e) {
    if (!e.defaultPrevented) {
      e.preventDefault();
    }
  }, false);

  // Route external HTTP/HTTPS links to default OS browser
  document.addEventListener('click', function(e) {
    var el = e.target;
    while (el && el.tagName !== 'A') {
      el = el.parentElement;
    }
    if (el && el.tagName === 'A' && el.href) {
      var href = el.href;
      if (href.startsWith('http://') || href.startsWith('https://')) {
        if (!href.startsWith(window.location.origin)) {
          e.preventDefault();
          if (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) {
            window.__TAURI_INTERNALS__.invoke('plugin:opener|open_url', { url: href });
          }
        }
      }
    }
  }, true);
})();
"#;

#[tauri::command]
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
