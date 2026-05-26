use std::{
    fs::{self, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use super::AiPaths;

#[derive(Clone)]
pub(crate) struct StoragePaths {
    pub workspace_dir: PathBuf,
    pub wimipet_dir: PathBuf,
    pub claude_dir: PathBuf,
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
    path.to_string_lossy().to_string()
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
    let claude_dir = workspace_dir.join(".claude");
    let sessions_dir = wimipet_dir.join("sessions");
    let log_file = wimipet_dir.join("logs").join("ai.log");

    Ok(StoragePaths {
        workspace_dir,
        wimipet_dir,
        claude_dir,
        sessions_dir,
        log_file,
    })
}

pub(crate) fn public_paths(paths: &StoragePaths) -> AiPaths {
    AiPaths {
        workspace_dir: path_to_string(&paths.workspace_dir),
        wimipet_dir: path_to_string(&paths.wimipet_dir),
        claude_dir: path_to_string(&paths.claude_dir),
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
    fs::create_dir_all(paths.claude_dir.join("commands")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("skills")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("agents")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("projects")).map_err(|err| err.to_string())?;
    let pi_dir = paths.workspace_dir.join(".pi");
    fs::create_dir_all(pi_dir.join("skills")).map_err(|err| err.to_string())?;
    fs::create_dir_all(pi_dir.join("prompts")).map_err(|err| err.to_string())?;

    let settings_path = paths.claude_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(&settings_path, "{\n}\n").map_err(|err| err.to_string())?;
    }

    let mcp_path = paths.claude_dir.join("mcp.json");
    if !mcp_path.exists() {
        fs::write(&mcp_path, "{\n  \"mcpServers\": {}\n}\n").map_err(|err| err.to_string())?;
    }

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

static LOG_WRITER: Mutex<Option<(PathBuf, BufWriter<std::fs::File>)>> = Mutex::new(None);

pub(crate) fn append_ai_log(paths: &StoragePaths, message: &str) {
    let timestamp = now_ms();
    let line = format!("[{timestamp}] {message}\n");

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

pub(crate) fn auto_tasks_path(paths: &StoragePaths) -> PathBuf {
    paths.wimipet_dir.join("auto-tasks.json")
}
