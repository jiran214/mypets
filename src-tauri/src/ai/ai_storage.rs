use serde_json::Value;
use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use chrono::Local;

use super::ai_models::AiSessionSummary;
use super::ai_skills::home_dir;
use super::AiPaths;

#[derive(Clone)]
pub(crate) struct StoragePaths {
    pub workspace_dir: PathBuf,
    pub wimipet_dir: PathBuf,
    pub sessions_dir: PathBuf,
    pub log_file: PathBuf,
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

pub(crate) fn path_to_string(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    // Strip Windows extended-length prefix \\?\ so Node.js can handle the path
    s.strip_prefix("\\\\?\\").unwrap_or(&s).to_string()
}

fn validate_workspace_path(workspace_folder: &str) -> Result<PathBuf, String> {
    if workspace_folder.trim().is_empty() {
        return Err("Workspace folder is required".to_string());
    }
    if workspace_folder.contains('\0') {
        return Err("Workspace path contains invalid characters".to_string());
    }
    let workspace_dir = PathBuf::from(workspace_folder);
    if !workspace_dir.exists() {
        return Err(format!(
            "Workspace folder not found: {}",
            workspace_dir.display()
        ));
    }
    let canonical = fs::canonicalize(&workspace_dir)
        .map_err(|e| format!("Cannot resolve workspace path: {e}"))?;
    let home = dirs::home_dir().ok_or("Cannot determine home directory")?;
    let home_canonical = fs::canonicalize(&home).unwrap_or(home);
    if !canonical.starts_with(&home_canonical) {
        return Err("Workspace must be under home directory".to_string());
    }
    Ok(canonical)
}

fn storage_paths(workspace_folder: &str) -> Result<StoragePaths, String> {
    let workspace_dir = validate_workspace_path(workspace_folder)?;
    let wimipet_dir = workspace_dir.join(".wimipet");
    let sessions_dir = wimipet_dir.join("sessions");
    let log_file = wimipet_dir.join("logs").join("ai.log");

    Ok(StoragePaths {
        workspace_dir,
        wimipet_dir,
        sessions_dir,
        log_file,
    })
}

pub(crate) fn public_paths(paths: &StoragePaths) -> AiPaths {
    AiPaths {
        workspace_dir: path_to_string(&paths.workspace_dir),
        wimipet_dir: path_to_string(&paths.wimipet_dir),
        sessions_dir: path_to_string(&paths.sessions_dir),
        log_file: path_to_string(&paths.log_file),
    }
}

fn ensure_storage(paths: &StoragePaths) -> Result<(), String> {
    fs::create_dir_all(&paths.wimipet_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&paths.sessions_dir).map_err(|err| err.to_string())?;
    if let Some(log_dir) = paths.log_file.parent() {
        fs::create_dir_all(log_dir).map_err(|err| err.to_string())?;
    }
    let pi_dir = paths.workspace_dir.join(".pi");
    fs::create_dir_all(pi_dir.join("skills")).map_err(|err| err.to_string())?;
    fs::create_dir_all(pi_dir.join("prompts")).map_err(|err| err.to_string())?;

    let pi_settings_path = pi_dir.join("settings.json");
    if !pi_settings_path.exists() {
        fs::write(&pi_settings_path, "{\n}\n").map_err(|err| err.to_string())?;
    }

    Ok(())
}

pub(crate) fn resolve_storage(workspace_folder: &str) -> Result<StoragePaths, String> {
    let paths = storage_paths(workspace_folder)?;
    ensure_storage(&paths)?;
    Ok(paths)
}

#[derive(Debug, Clone, Copy)]
pub(crate) enum LogLevel {
    Info,
    Warn,
    Error,
}

impl std::fmt::Display for LogLevel {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LogLevel::Info => write!(f, "INFO"),
            LogLevel::Warn => write!(f, "WARN"),
            LogLevel::Error => write!(f, "ERROR"),
        }
    }
}

static LOG_WRITER: Mutex<Option<(PathBuf, BufWriter<std::fs::File>)>> = Mutex::new(None);

pub(crate) fn append_ai_log(paths: &StoragePaths, level: LogLevel, module: &str, message: &str) {
    let now = Local::now();
    let timestamp = now.format("%Y-%m-%d %H:%M:%S").to_string();
    let line = format!("[{timestamp}] [{level}] [{module}] {message}\n");

    if let Ok(mut guard) = LOG_WRITER.lock() {
        let needs_reopen = match &*guard {
            Some((path, _)) => *path != paths.log_file,
            None => true,
        };
        if needs_reopen {
            if let Some(log_dir) = paths.log_file.parent() {
                let _ = fs::create_dir_all(log_dir);
            }
            if let Ok(file) = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&paths.log_file)
            {
                *guard = Some((paths.log_file.clone(), BufWriter::new(file)));
            }
        }
        if let Some((_, writer)) = guard.as_mut() {
            let _ = writer.write_all(line.as_bytes());
            let _ = writer.flush();
        }
    }
}

pub(crate) fn ai_settings_path(paths: &StoragePaths) -> PathBuf {
    paths.wimipet_dir.join("settings.json")
}

pub(crate) fn soul_md_path(paths: &StoragePaths) -> PathBuf {
    paths.workspace_dir.join("SOUL.md")
}

pub(crate) fn load_soul_md(paths: &StoragePaths) -> String {
    let path = soul_md_path(paths);
    if !path.exists() {
        return String::new();
    }
    fs::read_to_string(&path).unwrap_or_default()
}

pub(crate) fn save_soul_md(paths: &StoragePaths, content: &str) -> Result<(), String> {
    let path = soul_md_path(paths);
    fs::write(&path, content).map_err(|err| format!("Cannot write SOUL.md: {err}"))
}

pub(crate) fn auto_tasks_path(paths: &StoragePaths) -> PathBuf {
    paths.wimipet_dir.join("auto-tasks.json")
}

pub(crate) fn load_settings(paths: &StoragePaths) -> Result<super::ai_models::AiSettings, String> {
    let path = ai_settings_path(paths);
    if !path.exists() {
        let settings = super::ai_models::AiSettings::default();
        save_settings(paths, &settings)?;
        return Ok(settings);
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("Cannot read AI settings: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid AI settings: {err}"))
}

pub(crate) fn save_settings(paths: &StoragePaths, settings: &super::ai_models::AiSettings) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(ai_settings_path(paths), format!("{raw}\n")).map_err(|err| err.to_string())
}

pub(crate) fn load_auto_tasks(paths: &StoragePaths) -> Result<Vec<super::ai_models::AutoTask>, String> {
    let path = auto_tasks_path(paths);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("Cannot read auto tasks: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid auto tasks: {err}"))
}

pub(crate) fn save_auto_tasks_file(paths: &StoragePaths, tasks: &[super::ai_models::AutoTask]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(tasks).map_err(|err| err.to_string())?;
    fs::write(auto_tasks_path(paths), format!("{raw}\n")).map_err(|err| err.to_string())
}

pub(crate) fn session_meta_path(paths: &StoragePaths, conversation_id: &str) -> PathBuf {
    let file_name: String = conversation_id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect();
    paths.sessions_dir.join(format!("{file_name}.meta.json"))
}

pub(crate) fn write_session_meta(
    paths: &StoragePaths,
    conversation_id: &str,
    provider_state: serde_json::Value,
    prompt: &str,
    title: &str,
    auto_task_id: &str,
    auto_task_name: &str,
) -> Result<(), String> {
    let path = session_meta_path(paths, conversation_id);
    let now = now_ms();
    let existing_meta = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AiSessionSummary>(&raw).ok())
    } else {
        None
    };
    let existing_auto_task_id = existing_meta
        .as_ref()
        .and_then(|meta| meta.auto_task_id.clone());
    let existing_auto_task_name = existing_meta
        .as_ref()
        .and_then(|meta| meta.auto_task_name.clone());
    let meta_title = if title.trim().is_empty() {
        existing_meta
            .as_ref()
            .map(|meta| meta.title.clone())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| prompt.chars().take(40).collect::<String>())
    } else {
        title.trim().to_string()
    };
    let created_at = existing_meta.map(|meta| meta.created_at).unwrap_or(now);
    let auto_task_id = if auto_task_id.trim().is_empty() {
        existing_auto_task_id
    } else {
        Some(auto_task_id.trim().to_string())
    };
    let auto_task_name = if auto_task_name.trim().is_empty() {
        existing_auto_task_name
    } else {
        Some(auto_task_name.trim().to_string())
    };

    let meta = AiSessionSummary {
        id: conversation_id.to_string(),
        provider_state,
        title: meta_title,
        created_at,
        updated_at: now,
        auto_task_id,
        auto_task_name,
    };
    let raw = serde_json::to_string_pretty(&meta).map_err(|err| err.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|err| err.to_string())
}

pub(crate) fn pi_auth_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve user home directory".to_string())?;
    Ok(home.join(".pi").join("agent").join("auth.json"))
}

pub(crate) fn safe_pi_auth_key(provider: &str, auth_key: &str) -> Result<String, String> {
    let key = if auth_key.trim().is_empty() {
        provider.trim()
    } else {
        auth_key.trim()
    };
    if key.is_empty() {
        return Err("Pi provider is required".to_string());
    }
    if !key
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("Invalid Pi auth key".to_string());
    }
    Ok(key.to_string())
}

pub(crate) fn read_pi_auth_file(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
    if !path.exists() {
        return Ok(serde_json::Map::new());
    }
    let raw = fs::read_to_string(path).map_err(|err| format!("Cannot read Pi auth file: {err}"))?;
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }
    let value: Value =
        serde_json::from_str(&raw).map_err(|err| format!("Invalid Pi auth file: {err}"))?;
    Ok(value.as_object().cloned().unwrap_or_default())
}
