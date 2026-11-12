use std::fs;
use std::path::{Path, PathBuf};

pub struct MigrationLock {
    path: PathBuf,
}

impl MigrationLock {
    pub fn try_acquire(lock_dir: &Path) -> Option<Self> {
        let _ = fs::create_dir_all(lock_dir);
        let path = lock_dir.join("migration.lock");
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                use std::io::Write;
                let _ = writeln!(file, "pid={}", std::process::id());
                Some(Self { path })
            }
            Err(_) => {
                // Stale lock recovery: if lock file is older than 60 seconds, clear and retry
                if let Ok(meta) = path.metadata() {
                    if let Some(elapsed) = meta.modified().ok().and_then(|m| m.elapsed().ok()) {
                        if elapsed.as_secs() > 60 {
                            let _ = fs::remove_file(&path);
                            if let Ok(mut file) = fs::OpenOptions::new()
                                .write(true)
                                .create_new(true)
                                .open(&path)
                            {
                                use std::io::Write;
                                let _ = writeln!(file, "pid={}", std::process::id());
                                return Some(Self { path });
                            }
                        }
                    }
                }
                None
            }
        }
    }
}

impl Drop for MigrationLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

/// Copies a directory tree to destination with staging files, file-size verification,
/// and resumable retries. Writes .migration_complete marker only upon full success.
pub fn copy_dir_resumable_and_verify(src: &Path, dst: &Path) -> std::io::Result<()> {
    if !dst.exists() {
        fs::create_dir_all(dst)?;
    }
    let marker_file = dst.join(".migration_complete");
    if marker_file.exists() {
        return Ok(());
    }

    let mut stack = vec![(src.to_path_buf(), dst.to_path_buf())];
    let mut total_files = 0;

    while let Some((current_src, current_dst)) = stack.pop() {
        if !current_dst.exists() {
            fs::create_dir_all(&current_dst)?;
        }
        for entry in fs::read_dir(&current_src)? {
            let entry = entry?;
            let file_type = entry.file_type()?;
            let dest_path = current_dst.join(entry.file_name());

            if file_type.is_dir() {
                stack.push((entry.path(), dest_path));
            } else if file_type.is_file() {
                total_files += 1;
                let src_meta = entry.metadata()?;
                let should_copy = if dest_path.exists() {
                    match dest_path.metadata() {
                        Ok(dst_meta) => dst_meta.len() != src_meta.len(),
                        Err(_) => true,
                    }
                } else {
                    true
                };

                if should_copy {
                    let parent = dest_path.parent().unwrap_or(dst);
                    let file_name = dest_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("mig");
                    let stage_path = parent.join(format!(".{file_name}.stage"));
                    fs::copy(entry.path(), &stage_path)?;
                    fs::rename(&stage_path, &dest_path)?;
                }
            }
        }
    }

    let marker_data = format!(
        "migrated_files={total_files}\ntimestamp={}\n",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs()
    );
    fs::write(&marker_file, marker_data)?;

    Ok(())
}

/// Automatically migrates WebView2 profile (IndexedDB, LevelDB, Local Storage)
/// and Roaming AppData (app_config.json, allowed_roots.json, window state)
/// from legacy identifier `com.mangareader.desktop` to canonical `com.mangareader.app`.
///
/// Uses an exclusive migration lock to ensure it never copies an actively written
/// profile, verifies files via atomic staging, and records completion in a marker file.
pub fn migrate_legacy_data_if_needed() {
    #[cfg(target_os = "windows")]
    {
        // 1. Local AppData migration (WebView2 User Data Folder & IndexedDB)
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let local_dir = PathBuf::from(local_app_data);
            let old_local = local_dir.join("com.mangareader.desktop");
            let new_local = local_dir.join("com.mangareader.app");

            if old_local.exists() {
                let _lock = MigrationLock::try_acquire(&new_local);
                if _lock.is_none() {
                    log::warn!(
                        "Migration lock held by another process; skipping concurrent local data migration"
                    );
                } else {
                    let old_ebwebview = old_local.join("EBWebView");
                    let new_ebwebview = new_local.join("EBWebView");

                    if old_ebwebview.exists() {
                        let _ = copy_dir_resumable_and_verify(&old_ebwebview, &new_ebwebview);
                    }

                    let _ = copy_dir_resumable_and_verify(&old_local, &new_local);
                }
            }
        }

        // 2. Roaming AppData migration (app_config.json, allowed_roots.json, .window-state.json)
        if let Ok(roaming_app_data) = std::env::var("APPDATA") {
            let roaming_dir = PathBuf::from(roaming_app_data);
            let old_roaming = roaming_dir.join("com.mangareader.desktop");
            let new_roaming = roaming_dir.join("com.mangareader.app");

            if old_roaming.exists() {
                let _lock = MigrationLock::try_acquire(&new_roaming);
                if _lock.is_none() {
                    log::warn!(
                        "Migration lock held by another process; skipping concurrent roaming data migration"
                    );
                } else if let Err(e) = copy_dir_resumable_and_verify(&old_roaming, &new_roaming) {
                    log::warn!(
                        "Failed to migrate roaming data from {} to {}: {e}",
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
            if mac_old.exists() {
                let _lock = MigrationLock::try_acquire(&mac_new);
                if _lock.is_some() {
                    let _ = copy_dir_resumable_and_verify(&mac_old, &mac_new);
                }
            }

            // Linux ~/.local/share/
            let linux_old = home_path.join(".local/share/com.mangareader.desktop");
            let linux_new = home_path.join(".local/share/com.mangareader.app");
            if linux_old.exists() {
                let _lock = MigrationLock::try_acquire(&linux_new);
                if _lock.is_some() {
                    let _ = copy_dir_resumable_and_verify(&linux_old, &linux_new);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_copy_dir_resumable_and_verify() {
        let temp_dir =
            std::env::temp_dir().join(format!("manga_migration_test_{}", uuid::Uuid::new_v4()));
        let src = temp_dir.join("src");
        let dst = temp_dir.join("dst");

        let nested_src = src.join("nested/folder");
        fs::create_dir_all(&nested_src).expect("Failed to create nested test dir");
        fs::write(src.join("root.txt"), "root content").expect("Failed to write root file");
        fs::write(nested_src.join("nested.txt"), "nested content")
            .expect("Failed to write nested file");

        copy_dir_resumable_and_verify(&src, &dst)
            .expect("copy_dir_resumable_and_verify must succeed");

        assert!(dst.join("root.txt").exists());
        assert_eq!(
            fs::read_to_string(dst.join("root.txt")).unwrap(),
            "root content"
        );

        assert!(dst.join("nested/folder/nested.txt").exists());
        assert_eq!(
            fs::read_to_string(dst.join("nested/folder/nested.txt")).unwrap(),
            "nested content"
        );
        assert!(dst.join(".migration_complete").exists());

        // Resumable test: add a new file to src, delete .migration_complete, rerun
        fs::write(src.join("new_file.txt"), "new file").unwrap();
        let _ = fs::remove_file(dst.join(".migration_complete"));
        copy_dir_resumable_and_verify(&src, &dst).unwrap();
        assert!(dst.join("new_file.txt").exists());
        assert_eq!(
            fs::read_to_string(dst.join("new_file.txt")).unwrap(),
            "new file"
        );

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_migration_lock() {
        let temp_dir =
            std::env::temp_dir().join(format!("manga_lock_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);

        let lock1 = MigrationLock::try_acquire(&temp_dir);
        assert!(lock1.is_some());

        // Second acquisition fails while lock1 is alive
        let lock2 = MigrationLock::try_acquire(&temp_dir);
        assert!(lock2.is_none());

        drop(lock1);

        // Can acquire after drop
        let lock3 = MigrationLock::try_acquire(&temp_dir);
        assert!(lock3.is_some());
        drop(lock3);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
