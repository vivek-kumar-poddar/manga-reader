use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

pub const MAX_DIAGNOSTICS: usize = 50;
pub const DEDUP_WINDOW_MS: u64 = 2_000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticInput {
    pub operation: String,
    pub level: String,
    pub message: String,
    #[serde(default)]
    pub code: Option<String>,
    #[serde(default)]
    pub safe_identifier: Option<String>,
    #[serde(default)]
    pub retryable: Option<bool>,
    #[serde(default)]
    pub duration_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticRecord {
    pub id: String,
    pub timestamp: u64,
    pub operation: String,
    pub level: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub safe_identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub retryable: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

struct DiagnosticsStore {
    ring_buffer: VecDeque<DiagnosticRecord>,
    next_id: u64,
}

impl Default for DiagnosticsStore {
    fn default() -> Self {
        Self {
            ring_buffer: VecDeque::with_capacity(MAX_DIAGNOSTICS),
            next_id: 1,
        }
    }
}

#[derive(Default)]
pub struct DiagnosticsState(Mutex<DiagnosticsStore>);

pub fn sanitize_identifier(raw: Option<&str>) -> Option<String> {
    let raw_str = raw?;
    if raw_str.is_empty() {
        return None;
    }
    let normalized = raw_str.replace('\\', "/");
    let parts: Vec<&str> = normalized.split('/').filter(|s| !s.is_empty()).collect();
    if parts.is_empty() {
        return None;
    }
    let start = parts.len().saturating_sub(2);
    Some(parts[start..].join("/"))
}

fn current_timestamp_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

impl DiagnosticsState {
    pub fn record_with_timestamp(
        &self,
        entry: DiagnosticInput,
        now: u64,
    ) -> Option<DiagnosticRecord> {
        if entry.code.as_deref() == Some("AbortError")
            || entry.message.contains("Import cancelled")
            || entry.message.contains("aborted")
        {
            return None;
        }

        let mut store = self.0.lock().unwrap();

        if let Some(recent) = store.ring_buffer.back() {
            if recent.operation == entry.operation
                && recent.level == entry.level
                && recent.message == entry.message
                && now.saturating_sub(recent.timestamp) < DEDUP_WINDOW_MS
            {
                return Some(recent.clone());
            }
        }

        let id = format!("diag-{}", store.next_id);
        store.next_id += 1;

        let record = DiagnosticRecord {
            id,
            timestamp: now,
            operation: entry.operation,
            level: entry.level,
            message: entry.message,
            code: entry.code,
            safe_identifier: sanitize_identifier(entry.safe_identifier.as_deref()),
            retryable: entry.retryable,
            duration_ms: entry.duration_ms,
        };

        store.ring_buffer.push_back(record.clone());
        if store.ring_buffer.len() > MAX_DIAGNOSTICS {
            store.ring_buffer.pop_front();
        }

        Some(record)
    }

    pub fn record(&self, entry: DiagnosticInput) -> Option<DiagnosticRecord> {
        self.record_with_timestamp(entry, current_timestamp_ms())
    }

    pub fn get_all(&self) -> Vec<DiagnosticRecord> {
        let store = self.0.lock().unwrap();
        store.ring_buffer.iter().cloned().collect()
    }

    pub fn clear(&self) {
        let mut store = self.0.lock().unwrap();
        store.ring_buffer.clear();
    }
}

#[tauri::command(async)]
pub fn sanitize_diagnostic_identifier(raw: Option<String>) -> Option<String> {
    sanitize_identifier(raw.as_deref())
}

#[tauri::command(async)]
pub fn record_diagnostic(
    state: State<'_, DiagnosticsState>,
    entry: DiagnosticInput,
) -> Option<DiagnosticRecord> {
    state.record(entry)
}

#[tauri::command(async)]
pub fn get_diagnostics(state: State<'_, DiagnosticsState>) -> Vec<DiagnosticRecord> {
    state.get_all()
}

#[tauri::command(async)]
pub fn clear_diagnostics(state: State<'_, DiagnosticsState>) {
    state.clear();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sanitize_identifier() {
        assert_eq!(sanitize_identifier(None), None);
        assert_eq!(sanitize_identifier(Some("")), None);
        assert_eq!(
            sanitize_identifier(Some("C:\\Users\\VKPs\\Manga\\OnePiece\\01.jpg")),
            Some("OnePiece/01.jpg".to_string())
        );
        assert_eq!(
            sanitize_identifier(Some("/home/user/manga/chapter1")),
            Some("manga/chapter1".to_string())
        );
        assert_eq!(
            sanitize_identifier(Some("SingleSegment")),
            Some("SingleSegment".to_string())
        );
    }

    #[test]
    fn test_abort_filtering_and_deduplication() {
        let state = DiagnosticsState::default();

        // AbortError must be ignored
        let abort_entry = DiagnosticInput {
            operation: "import".into(),
            level: "warn".into(),
            message: "Something failed".into(),
            code: Some("AbortError".into()),
            safe_identifier: None,
            retryable: None,
            duration_ms: None,
        };
        assert!(state.record_with_timestamp(abort_entry, 1000).is_none());

        // "Import cancelled" message must be ignored
        let cancel_entry = DiagnosticInput {
            operation: "import".into(),
            level: "info".into(),
            message: "Import cancelled by user".into(),
            code: None,
            safe_identifier: None,
            retryable: None,
            duration_ms: None,
        };
        assert!(state.record_with_timestamp(cancel_entry, 1000).is_none());

        // Normal entry recorded and deduplicated within 2000ms
        let valid_entry = DiagnosticInput {
            operation: "import".into(),
            level: "error".into(),
            message: "Disk read error".into(),
            code: Some("IoError".into()),
            safe_identifier: Some("C:\\Manga\\Berserk\\ch1.jpg".into()),
            retryable: Some(true),
            duration_ms: Some(45),
        };
        let r1 = state.record_with_timestamp(valid_entry.clone(), 1000).unwrap();
        assert_eq!(r1.id, "diag-1");
        assert_eq!(r1.safe_identifier.as_deref(), Some("Berserk/ch1.jpg"));

        // Duplicate within 2000ms returns the same record without adding a second entry
        let r2 = state.record_with_timestamp(valid_entry.clone(), 2500).unwrap();
        assert_eq!(r2.id, "diag-1");
        assert_eq!(state.get_all().len(), 1);

        // After 2000ms window, records a new entry
        let r3 = state.record_with_timestamp(valid_entry, 3500).unwrap();
        assert_eq!(r3.id, "diag-2");
        assert_eq!(state.get_all().len(), 2);
    }

    #[test]
    fn test_ring_buffer_cap_and_clear() {
        let state = DiagnosticsState::default();
        for i in 0..60 {
            let entry = DiagnosticInput {
                operation: "reader".into(),
                level: "info".into(),
                message: format!("Event {i}"),
                code: None,
                safe_identifier: None,
                retryable: None,
                duration_ms: None,
            };
            state.record_with_timestamp(entry, i * 3000);
        }

        let all = state.get_all();
        assert_eq!(all.len(), MAX_DIAGNOSTICS);
        assert_eq!(all.first().unwrap().message, "Event 10");
        assert_eq!(all.last().unwrap().message, "Event 59");

        state.clear();
        assert!(state.get_all().is_empty());
    }
}