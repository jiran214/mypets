use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::Local;
use serde_json::Value;

pub(crate) fn tools_data_dir(paths: &crate::ai::StoragePaths) -> PathBuf {
    paths.wimipet_dir.join("tools")
}

pub(crate) fn resolve_data_file(data_dir: &Path, file_name: &str) -> PathBuf {
    data_dir.join(file_name)
}

pub(crate) fn read_json_file(path: &Path, fallback: Value) -> Value {
    let Ok(raw) = fs::read_to_string(path) else {
        return fallback;
    };
    if raw.trim().is_empty() {
        return fallback;
    }
    serde_json::from_str(&raw).unwrap_or(fallback)
}

pub(crate) fn write_json_file(path: &Path, value: &Value) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("Cannot create directory: {err}"))?;
    }
    let temp_path = path.with_extension(format!("{}.tmp", std::process::id()));
    let content = serde_json::to_string_pretty(value).map_err(|err| err.to_string())?;
    fs::write(&temp_path, format!("{content}\n"))
        .map_err(|err| format!("Cannot write file: {err}"))?;
    fs::rename(&temp_path, path)
        .map_err(|err| format!("Cannot rename file: {err}"))
}

pub(crate) fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(crate) fn today_date() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

pub(crate) fn create_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let a = ((nanos >> 32) & 0xFFFF_FFFF) as u32;
    let b = ((nanos >> 16) & 0xFFFF) as u16;
    let c = 4000 | (((nanos >> 4) & 0x0FFF) as u16);
    let d = (nanos & 0x0F) as u16;
    let e1 = ((nanos >> 48) & 0xFFFF) as u16;
    let e2 = ((nanos >> 20) & 0xFFFF) as u16;
    let e3 = ((nanos >> 36) & 0xFFFF) as u16;
    format!(
        "{prefix}-{a:08x}-{b:04x}-{c:04x}-{:04x}{e1:04x}{e2:04x}{e3:04x}",
        (d & 0x3FFF) | 0x8000
    )
}

pub(crate) fn optional_text(value: &Value) -> Option<String> {
    match value {
        Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()),
        _ => None,
    }
}

pub(crate) fn require_text(value: &Value, field_name: &str) -> Result<String, String> {
    optional_text(value).ok_or_else(|| format!("{field_name} is required"))
}

pub(crate) fn parse_date_string(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    let parts: Vec<&str> = trimmed.split('-').collect();
    if parts.len() != 3 {
        return Err(format!("{field_name} must use YYYY-MM-DD"));
    }
    let year: i64 = parts[0]
        .parse()
        .map_err(|_| format!("{field_name} must use YYYY-MM-DD"))?;
    let month: u32 = parts[1]
        .parse()
        .map_err(|_| format!("{field_name} must use YYYY-MM-DD"))?;
    let day: u32 = parts[2]
        .parse()
        .map_err(|_| format!("{field_name} must use YYYY-MM-DD"))?;
    if month < 1 || month > 12 || day < 1 || day > 31 || year < 1 || year > 9999 {
        return Err(format!("{field_name} is invalid"));
    }
    Ok(format!("{year:04}-{month:02}-{day:02}"))
}

pub(crate) fn update_by_id<F>(
    items: &mut Vec<Value>,
    id: &str,
    update_fn: F,
) -> Result<Value, String>
where
    F: FnOnce(&Value) -> Value,
{
    let index = items
        .iter()
        .position(|item| item.get("id").and_then(Value::as_str) == Some(id))
        .ok_or_else(|| format!("Item not found: {id}"))?;
    items[index] = update_fn(&items[index]);
    Ok(items[index].clone())
}
