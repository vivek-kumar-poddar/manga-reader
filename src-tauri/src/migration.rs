use std::fs;
use std::path::{Path, PathBuf};

fn copy_dir_recursive(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    for entry in fs::read_dir(src)? {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                log::warn!("Failed to read dir entry in {}: {e}", src.display());
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(ft) => ft,
            Err(e) => {
                log::warn!("Failed to read file type for {}: {e}", entry.path().display());
                continue;
            }
        };
        let dest_path = dst.join(entry.file_name());
        if file_type.is_dir() {
            if let Err(e) = copy_dir_recursive(&entry.path(), &dest_path) {
                log::warn!(
                    "Failed to recursively copy directory {} to {}: {e}",
                    entry.path().display(),
                    dest_path.display()
                );
            }
        } else if !dest_path.exists() {
            if let Err(e) = fs::copy(entry.path(), &dest_path) {
                log::warn!(
                    "Failed to copy file {} to {}: {e}",
                    entry.path().display(),
                    dest_path.display()
                );
            }
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
                if let Err(e) = copy_dir_recursive(&old_roaming, &new_roaming) {
                    log::warn!(
                        "Failed to recursively migrate roaming data from {} to {}: {e}",
                        old_roaming.display(),
                        new_roaming.display()
                    );
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_dir_recursive() {
        let temp_dir = std::env::temp_dir().join(format!("manga_migration_test_{}", uuid::Uuid::new_v4()));
        let src = temp_dir.join("src");
        let dst = temp_dir.join("dst");

        let nested_src = src.join("nested/folder");
        fs::create_dir_all(&nested_src).expect("Failed to create nested test dir");
        fs::write(src.join("root.txt"), "root content").expect("Failed to write root file");
        fs::write(nested_src.join("nested.txt"), "nested content").expect("Failed to write nested file");

        copy_dir_recursive(&src, &dst).expect("copy_dir_recursive must succeed");

        assert!(dst.join("root.txt").exists());
        assert_eq!(fs::read_to_string(dst.join("root.txt")).unwrap(), "root content");

        assert!(dst.join("nested/folder/nested.txt").exists());
        assert_eq!(fs::read_to_string(dst.join("nested/folder/nested.txt")).unwrap(), "nested content");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

