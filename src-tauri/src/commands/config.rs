use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::RwLock;
use tauri::{AppHandle, Manager};

use super::fs::{write_atomic, AllowedRoots};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowPreferences {
    pub minimize_to_tray: bool,
    pub close_to_tray: bool,
    pub start_maximized: bool,
    pub high_dpi_scaling: bool,
    pub theme: Option<String>,
}

impl Default for WindowPreferences {
    fn default() -> Self {
        Self {
            minimize_to_tray: false,
            close_to_tray: false,
            start_maximized: false,
            high_dpi_scaling: true,
            theme: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub last_opened_roots: Vec<String>,
    pub window_preferences: WindowPreferences,
    pub custom_preferences: HashMap<String, serde_json::Value>,
}

pub struct AppConfigState(pub RwLock<AppConfig>);

impl AppConfigState {
    pub fn new(app: &AppHandle) -> Self {
        let config = load_persisted_config(app);
        Self(RwLock::new(config))
    }

    pub fn get(&self) -> AppConfig {
        self.0.read().unwrap().clone()
    }

    pub fn update<F>(&self, app: &AppHandle, f: F)
    where
        F: FnOnce(&mut AppConfig),
    {
        let mut lock = self.0.write().unwrap();
        f(&mut lock);
        save_persisted_config(app, &lock);
    }
}

fn get_config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let app_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {e}"))?;
    let _ = fs::create_dir_all(&app_dir);
    Ok(app_dir.join("app_config.json"))
}

pub fn load_persisted_config(app: &AppHandle) -> AppConfig {
    if let Ok(path) = get_config_path(app) {
        if path.exists() {
            if let Ok(content) = fs::read_to_string(&path) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    return config;
                }
            }
        }
        // Fallback recovery: check if a valid .tmp file exists from an interrupted rename
        let tmp = path.with_extension("tmp");
        if tmp.exists() {
            if let Ok(content) = fs::read_to_string(&tmp) {
                if let Ok(config) = serde_json::from_str::<AppConfig>(&content) {
                    let _ = fs::rename(&tmp, &path);
                    return config;
                }
            }
        }
    }
    AppConfig::default()
}

pub fn save_persisted_config(app: &AppHandle, config: &AppConfig) {
    if let Ok(path) = get_config_path(app) {
        if let Ok(json) = serde_json::to_string_pretty(config) {
            let _ = write_atomic(&path, json.as_bytes());
        }
    }
}

#[tauri::command]
pub fn get_app_config(app: AppHandle) -> Result<AppConfig, String> {
    let state = app.state::<AppConfigState>();
    Ok(state.get())
}

#[tauri::command]
pub fn save_app_config(app: AppHandle, config: AppConfig) -> Result<(), String> {
    let state = app.state::<AppConfigState>();
    state.update(&app, |cfg| {
        *cfg = config;
    });
    Ok(())
}

#[tauri::command]
pub fn set_app_preference(
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), String> {
    let state = app.state::<AppConfigState>();
    state.update(&app, |cfg| {
        cfg.custom_preferences.insert(key, value);
    });
    Ok(())
}

#[tauri::command]
pub fn get_app_preference(
    app: AppHandle,
    key: String,
) -> Result<Option<serde_json::Value>, String> {
    let state = app.state::<AppConfigState>();
    Ok(state.get().custom_preferences.get(&key).cloned())
}

#[tauri::command]
pub fn record_opened_root(app: AppHandle, root_path: String) -> Result<Vec<String>, String> {
    let trimmed = root_path.trim().to_string();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Register with AllowedRoots as well
    let allowed = app.state::<AllowedRoots>();
    allowed.add_root(PathBuf::from(&trimmed));

    let state = app.state::<AppConfigState>();
    let mut updated = Vec::new();
    state.update(&app, |cfg| {
        // Remove duplicate if already present, push to front
        cfg.last_opened_roots.retain(|r| r != &trimmed);
        cfg.last_opened_roots.insert(0, trimmed.clone());
        // Cap at 25 entries
        if cfg.last_opened_roots.len() > 25 {
            cfg.last_opened_roots.truncate(25);
        }
        updated = cfg.last_opened_roots.clone();
    });

    Ok(updated)
}

#[tauri::command]
pub fn get_last_opened_roots(app: AppHandle) -> Result<Vec<String>, String> {
    let state = app.state::<AppConfigState>();
    Ok(state.get().last_opened_roots)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_window_preferences_defaults() {
        let prefs = WindowPreferences::default();
        assert!(!prefs.minimize_to_tray);
        assert!(!prefs.close_to_tray);
        assert!(!prefs.start_maximized);
        assert!(prefs.high_dpi_scaling);
        assert_eq!(prefs.theme, None);
    }

    #[test]
    fn test_app_config_serde_roundtrip() {
        let mut config = AppConfig::default();
        config.last_opened_roots.push("C:\\Manga\\OnePiece".into());
        config.window_preferences.close_to_tray = true;
        config.custom_preferences.insert("zoom".into(), serde_json::json!(1.25));

        let json = serde_json::to_string(&config).expect("Must serialize to JSON");
        assert!(json.contains("\"closeToTray\":true"));
        assert!(json.contains("\"lastOpenedRoots\":[\"C:\\\\Manga\\\\OnePiece\"]"));

        let deserialized: AppConfig = serde_json::from_str(&json).expect("Must deserialize from JSON");
        assert_eq!(deserialized.last_opened_roots, vec!["C:\\Manga\\OnePiece"]);
        assert!(deserialized.window_preferences.close_to_tray);
        assert_eq!(deserialized.custom_preferences.get("zoom"), Some(&serde_json::json!(1.25)));
    }

    #[test]
    fn test_root_capping_and_deduplication() {
        let mut roots = Vec::new();
        for i in 0..30 {
            let root = format!("C:\\Manga\\Title_{}", i);
            roots.retain(|r| r != &root);
            roots.insert(0, root);
            if roots.len() > 25 {
                roots.truncate(25);
            }
        }

        assert_eq!(roots.len(), 25);
        assert_eq!(roots[0], "C:\\Manga\\Title_29");

        // Re-adding Title_10 should bring it to the front
        let title_10 = "C:\\Manga\\Title_10".to_string();
        roots.retain(|r| r != &title_10);
        roots.insert(0, title_10.clone());
        assert_eq!(roots[0], title_10);
        assert_eq!(roots.len(), 25);
    }
}
