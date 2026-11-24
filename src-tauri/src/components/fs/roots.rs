use super::atomic::write_atomic;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

#[derive(Default)]
pub struct AllowedRoots {
    pub active: RwLock<HashSet<PathBuf>>,
    pub unavailable: RwLock<HashSet<PathBuf>>,
}

pub fn resolve_canonical_path(path: &Path) -> Option<PathBuf> {
    if let Ok(c) = dunce::canonicalize(path) {
        return Some(c);
    }
    // If the leaf does not exist on disk, canonicalize its closest existing ancestor
    let mut remaining = Vec::new();
    let mut current = path;
    while let Some(parent) = current.parent() {
        if let Some(file_name) = current.file_name() {
            remaining.push(file_name);
        }
        if let Ok(c) = dunce::canonicalize(parent) {
            let mut resolved = c;
            for comp in remaining.into_iter().rev() {
                resolved.push(comp);
            }
            return Some(resolved);
        }
        current = parent;
    }
    None
}

impl AllowedRoots {
    pub fn new(active: HashSet<PathBuf>, unavailable: HashSet<PathBuf>) -> Self {
        Self {
            active: RwLock::new(active),
            unavailable: RwLock::new(unavailable),
        }
    }

    pub fn is_allowed(&self, path: &Path) -> bool {
        // Fail closed if path cannot be canonicalized to an existing ancestor
        let canonical = match resolve_canonical_path(path) {
            Some(c) => c,
            None => return false,
        };
        if canonical
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
        {
            return false;
        }

        // 1. Check currently active canonical roots
        {
            let active = self.active.read().unwrap();
            if !active.is_empty() && active.iter().any(|root| canonical.starts_with(root)) {
                return true;
            }
        }

        // 2. Check if an unavailable root (e.g. re-attached drive) has become reachable
        let mut promoted = false;
        {
            let mut unavail = self.unavailable.write().unwrap();
            let mut to_promote = Vec::new();
            for unavail_root in unavail.iter() {
                if let Ok(c_root) = dunce::canonicalize(unavail_root) {
                    if canonical.starts_with(&c_root) {
                        to_promote.push((unavail_root.clone(), c_root));
                    }
                }
            }
            for (u, c) in to_promote {
                unavail.remove(&u);
                self.active.write().unwrap().insert(c);
                promoted = true;
            }
        }
        promoted
    }

    pub fn add_root(&self, path: PathBuf) {
        if let Ok(canonical) = dunce::canonicalize(&path) {
            self.active.write().unwrap().insert(canonical);
        } else {
            // Fail closed for active authorization; preserve separately for relinking
            self.unavailable.write().unwrap().insert(path);
        }
    }

    pub fn revoke_root(&self, path: &Path) -> bool {
        let canonical = dunce::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
        let mut active = self.active.write().unwrap();
        let mut unavail = self.unavailable.write().unwrap();

        let removed_active = active.remove(&canonical);
        let removed_unavail = unavail.remove(path) || unavail.remove(&canonical);

        let to_remove_active: Vec<PathBuf> = active
            .iter()
            .filter(|r| **r == canonical || r.starts_with(&canonical))
            .cloned()
            .collect();
        for r in to_remove_active {
            active.remove(&r);
        }

        let to_remove_unavail: Vec<PathBuf> = unavail
            .iter()
            .filter(|r| **r == canonical || r.starts_with(&canonical))
            .cloned()
            .collect();
        for r in to_remove_unavail {
            unavail.remove(&r);
        }

        removed_active || removed_unavail
    }

    pub fn get_roots(&self) -> Vec<PathBuf> {
        let mut all: Vec<PathBuf> = self.active.read().unwrap().iter().cloned().collect();
        for unavail in self.unavailable.read().unwrap().iter() {
            if !all.contains(unavail) {
                all.push(unavail.clone());
            }
        }
        all
    }

    pub fn get_active_roots(&self) -> HashSet<PathBuf> {
        self.active.read().unwrap().clone()
    }
}

pub fn load_persisted_roots(app: &AppHandle) -> (HashSet<PathBuf>, HashSet<PathBuf>) {
    let mut active = HashSet::new();
    let mut unavailable = HashSet::new();
    if let Ok(app_dir) = app.path().app_data_dir() {
        let file_path = app_dir.join("allowed_roots.json");
        let candidates = [file_path.clone(), file_path.with_extension("tmp")];
        for candidate in &candidates {
            if candidate.exists() {
                if let Ok(data) = std::fs::read_to_string(candidate) {
                    if let Ok(paths) = serde_json::from_str::<Vec<String>>(&data) {
                        for p in paths {
                            let pb = PathBuf::from(p);
                            if let Ok(canonical) = dunce::canonicalize(&pb) {
                                active.insert(canonical);
                            } else {
                                // Unavailable at startup (e.g. disconnected drive), preserve separately
                                unavailable.insert(pb);
                            }
                        }
                        if !active.is_empty() || !unavailable.is_empty() {
                            if candidate != &file_path {
                                let _ = std::fs::rename(candidate, &file_path);
                            }
                            break;
                        }
                    }
                }
            }
        }
    }
    (active, unavailable)
}

pub fn save_persisted_roots(app: &AppHandle, allowed: &AllowedRoots) {
    if let Ok(app_dir) = app.path().app_data_dir() {
        let _ = std::fs::create_dir_all(&app_dir);
        let file_path = app_dir.join("allowed_roots.json");
        let list: Vec<String> = allowed
            .get_roots()
            .iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect();
        if let Ok(data) = serde_json::to_string(&list) {
            let _ = write_atomic(&file_path, data.as_bytes());
        }
    }
}

pub fn init_allowed_roots(app: &AppHandle) -> AllowedRoots {
    let (active, unavailable) = load_persisted_roots(app);
    AllowedRoots::new(active, unavailable)
}
