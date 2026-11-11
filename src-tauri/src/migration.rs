use std::fs;
use std::path::{Path, PathBuf};

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = match entry {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(_) => continue,
        };
        let dest_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            let _ = copy_dir_recursive(&entry.path(), &dest_path);
        } else if !dest_path.exists() {
            let _ = fs::copy(entry.path(), dest_path);
        }
    }
    Ok(())
}

fn is_dir_empty_or_missing(dir: &Path) -> bool {
    if !dir.exists() {
        return true;
    }
    match fs::read_dir(dir) {
        Ok(mut entries) => entries.next().is_none(),
        Err(_) => true,
    }
}

/// Automatically migrates WebView2 profile (IndexedDB, LevelDB, Local Storage)
/// and Roaming AppData (app_config.json, allowed_roots.json, window state)
/// from legacy identifier `com.mangareader.desktop` to canonical `com.mangareader.app`.
///
/// This runs synchronously before the WebView2 window is created, ensuring
/// no user's library ever appears empty upon upgrading.
pub fn migrate_legacy_data_if_needed() {
    #[cfg(target_os = "windows")]
    {
        // 1. Local AppData migration (WebView2 User Data Folder & IndexedDB)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let local_dir = PathBuf::from(local_app_data);
            let old_local = local_dir.join("com.mangareader.desktop");
            let new_local = local_dir.join("com.mangareader.app");

            if old_local.exists() {
                let old_ebwebview = old_local.join("EBWebView");
                let new_ebwebview = new_local.join("EBWebView");

                if old_ebwebview.exists() && is_dir_empty_or_missing(&new_ebwebview) {
                    let _ = copy_dir_recursive(&old_ebwebview, &new_ebwebview);
                }

                if is_dir_empty_or_missing(&new_local) {
                    let _ = copy_dir_recursive(&old_local, &new_local);
                }
            }
        }

        // 2. Roaming AppData migration (app_config.json, allowed_roots.json, .window-state.json)
        if let Ok(roaming_app_data) = std::env::var("APPDATA") {
            let roaming_dir = PathBuf::from(roaming_app_data);
            let old_roaming = roaming_dir.join("com.mangareader.desktop");
            let new_roaming = roaming_dir.join("com.mangareader.app");

            if old_roaming.exists() {
                let _ = fs::create_dir_all(&new_roaming);
                if let Ok(entries) = fs::read_dir(&old_roaming) {
                    for entry in entries.flatten() {
                        let dest_file = new_roaming.join(entry.file_name());
                        if !dest_file.exists() {
                            let _ = fs::copy(entry.path(), dest_file);
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home_path = PathBuf::from(home);
            // macOS ~/Library/Application Support/
            let mac_old = home_path.join("Library/Application Support/com.mangareader.desktop");
            let mac_new = home_path.join("Library/Application Support/com.mangareader.app");
            if mac_old.exists() && is_dir_empty_or_missing(&mac_new) {
                let _ = copy_dir_recursive(&mac_old, &mac_new);
            }

            // Linux ~/.local/share/
            let linux_old = home_path.join(".local/share/com.mangareader.desktop");
            let linux_new = home_path.join(".local/share/com.mangareader.app");
            if linux_old.exists() && is_dir_empty_or_missing(&linux_new) {
                let _ = copy_dir_recursive(&linux_old, &linux_new);
            }
        }
    }
}

