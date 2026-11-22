use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};
use super::types::HEADER_READ_LIMIT;

pub struct ScanHandle {
    pub receiver: tokio::sync::watch::Receiver<bool>,
    pub flag: Arc<AtomicBool>,
}

pub type ActiveScanEntry = (
    tokio::sync::watch::Sender<bool>,
    Arc<AtomicBool>,
);
pub type ActiveScanMap = std::collections::HashMap<String, ActiveScanEntry>;

#[derive(Default)]
pub struct ScanManager {
    active_scans: Mutex<ActiveScanMap>,
}

impl ScanManager {
    pub fn register(&self, id: &str) -> ScanHandle {
        let (tx, rx) = tokio::sync::watch::channel(false);
        let flag = Arc::new(AtomicBool::new(false));
        self.active_scans
            .lock()
            .unwrap()
            .insert(id.to_string(), (tx, Arc::clone(&flag)));
        ScanHandle { receiver: rx, flag }
    }

    pub fn unregister(&self, id: &str) {
        self.active_scans.lock().unwrap().remove(id);
    }

    pub fn cancel(&self, id: &str) -> bool {
        if let Some((tx, flag)) = self.active_scans.lock().unwrap().get(id) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
            let _ = tx.send(true);
            true
        } else {
            false
        }
    }

    pub fn is_cancelled(&self, id: &str) -> bool {
        if let Some((_, flag)) = self.active_scans.lock().unwrap().get(id) {
            flag.load(std::sync::atomic::Ordering::Relaxed)
        } else {
            false
        }
    }
}

/// Parses image dimensions (width, height) without decoding pixel buffers.
/// First reads up to 32 KB to parse headers via blob_size; falls back to size(path)
/// for large EXIF/TIFF headers.
pub fn parse_image_dimensions(path: &Path) -> (Option<u32>, Option<u32>) {
    // 1. Fast header parse: read first 32 KB
    if let Ok(mut file) = File::open(path) {
        let mut buf = vec![0u8; HEADER_READ_LIMIT];
        let mut total = 0;
        while total < HEADER_READ_LIMIT {
            match file.read(&mut buf[total..]) {
                Ok(0) => break,
                Ok(n) => total += n,
                Err(_) => break,
            }
        }
        buf.truncate(total);

        if !buf.is_empty() {
            if let Ok(dim) = imagesize::blob_size(&buf) {
                if dim.width > 0 && dim.height > 0 {
                    let w = dim.width as u64;
                    let h = dim.height as u64;
                    if w <= u32::MAX as u64
                        && h <= u32::MAX as u64
                        && w.saturating_mul(h) < (1u64 << 40)
                    {
                        return (Some(dim.width as u32), Some(dim.height as u32));
                    }
                }
            }
        }
    }

    // 2. Fallback: stream through reader if metadata chunk is located past 32 KB
    if let Ok(dim) = imagesize::size(path) {
        if dim.width > 0 && dim.height > 0 {
            let w = dim.width as u64;
            let h = dim.height as u64;
            if w <= u32::MAX as u64 && h <= u32::MAX as u64 && w.saturating_mul(h) < (1u64 << 40) {
                return (Some(dim.width as u32), Some(dim.height as u32));
            }
        }
    }

    (None, None)
}
