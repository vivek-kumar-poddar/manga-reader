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