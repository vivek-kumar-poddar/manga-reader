use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, LazyLock, Mutex};

static ATOMIC_WRITE_COUNTER: AtomicU64 = AtomicU64::new(1);
static DESTINATION_LOCKS: LazyLock<Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));

fn get_destination_lock(path: &Path) -> Arc<Mutex<()>> {
    let key = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut locks = DESTINATION_LOCKS.lock().unwrap();
    if locks.len() > 1024 {
        locks.retain(|_, arc| Arc::strong_count(arc) > 1);
    }
    locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone()
}

/// Atomically writes data to path using a unique same-directory temporary file
/// serialized per destination, syncing to disk before renaming over the target.
pub fn write_atomic(path: &Path, data: &[u8]) -> std::io::Result<()> {
    let dest_lock = get_destination_lock(path);
    let _guard = dest_lock.lock().unwrap();

    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    std::fs::create_dir_all(parent)?;

    let file_stem = path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("atomic");
    let pid = std::process::id();
    let counter = ATOMIC_WRITE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = parent.join(format!(".{file_stem}_{pid}_{counter}.tmp"));

    let res = (|| -> std::io::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(data)?;
        file.sync_all()?;
        drop(file);

        #[cfg(target_os = "windows")]
        {
            if path.exists() {
                let mut attempts = 0;
                loop {
                    match std::fs::rename(&tmp, path) {
                        Ok(()) => return Ok(()),
                        Err(_e) if attempts < 3 => {
                            attempts += 1;
                            std::thread::sleep(std::time::Duration::from_millis(15));
                        }
                        Err(e) => return Err(e),
                    }
                }
            } else {
                std::fs::rename(&tmp, path)?;
            }
        }

        #[cfg(not(target_os = "windows"))]
        {
            std::fs::rename(&tmp, path)?;
        }

        Ok(())
    })();

    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}
