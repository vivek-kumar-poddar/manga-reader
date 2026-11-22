use serde::{Deserialize, Serialize};

#[derive(Debug, thiserror::Error, Serialize, Deserialize, PartialEq, Clone)]
#[serde(tag = "code", content = "message")]
pub enum DbError {
    #[error("Database error: {0}")]
    Sqlite(String),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Lock error: {0}")]
    Lock(String),

    #[error("Validation error: {0}")]
    Validation(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Stale revision conflict: {0}")]
    Conflict(String),

    #[error("Task execution error: {0}")]
    Task(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),
}

impl From<rusqlite::Error> for DbError {
    fn from(err: rusqlite::Error) -> Self {
        DbError::Sqlite(err.to_string())
    }
}

impl From<serde_json::Error> for DbError {
    fn from(err: serde_json::Error) -> Self {
        DbError::Serialization(err.to_string())
    }
}

pub type DbResult<T> = std::result::Result<T, DbError>;
