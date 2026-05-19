use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    #[serde(default)]
    pub path_to_claude_code_executable: String,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default)]
    pub use_user_settings: bool,
    #[serde(default)]
    pub custom_env_text: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default)]
    pub claude: ClaudeSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPaths {
    pub workspace_dir: String,
    pub mypets_ai_dir: String,
    pub claude_dir: String,
    pub sessions_dir: String,
    pub log_file: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiState {
    pub settings: AiSettings,
    pub paths: AiPaths,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub conversation_id: String,
    pub workspace_folder: String,
    pub prompt: String,
    #[serde(default)]
    pub provider_state: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AiSessionMeta {
    id: String,
    provider_id: String,
    provider_state: Value,
    title: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Clone)]
struct StoragePaths {
    workspace_dir: PathBuf,
    mypets_ai_dir: PathBuf,
    claude_dir: PathBuf,
    sessions_dir: PathBuf,
    log_file: PathBuf,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            path_to_claude_code_executable: String::new(),
            permission_mode: default_permission_mode(),
            use_user_settings: false,
            custom_env_text: String::new(),
        }
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider_id: default_provider_id(),
            claude: ClaudeSettings::default(),
        }
    }
}

fn default_provider_id() -> String {
    "claude".to_string()
}

fn default_permission_mode() -> String {
    "default".to_string()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn path_to_string(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn storage_paths(workspace_folder: &str) -> Result<StoragePaths, String> {
    if workspace_folder.trim().is_empty() {
        return Err("Workspace folder is required".to_string());
    }

    let workspace_dir = PathBuf::from(workspace_folder);
    if !workspace_dir.exists() {
        return Err(format!("Workspace folder not found: {}", workspace_dir.display()));
    }
    let workspace_dir = fs::canonicalize(&workspace_dir).unwrap_or(workspace_dir);
    let mypets_ai_dir = workspace_dir.join(".mypets-ai");
    let claude_dir = workspace_dir.join(".claude");
    let sessions_dir = mypets_ai_dir.join("sessions");
    let log_file = mypets_ai_dir.join("logs").join("ai.log");

    Ok(StoragePaths {
        workspace_dir,
        mypets_ai_dir,
        claude_dir,
        sessions_dir,
        log_file,
    })
}

fn public_paths(paths: &StoragePaths) -> AiPaths {
    AiPaths {
        workspace_dir: path_to_string(&paths.workspace_dir),
        mypets_ai_dir: path_to_string(&paths.mypets_ai_dir),
        claude_dir: path_to_string(&paths.claude_dir),
        sessions_dir: path_to_string(&paths.sessions_dir),
        log_file: path_to_string(&paths.log_file),
    }
}

fn ensure_storage(paths: &StoragePaths) -> Result<(), String> {
    fs::create_dir_all(&paths.mypets_ai_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&paths.sessions_dir).map_err(|err| err.to_string())?;
    if let Some(log_dir) = paths.log_file.parent() {
        fs::create_dir_all(log_dir).map_err(|err| err.to_string())?;
    }
    fs::create_dir_all(paths.claude_dir.join("commands")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("skills")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("agents")).map_err(|err| err.to_string())?;
    fs::create_dir_all(paths.claude_dir.join("projects")).map_err(|err| err.to_string())?;

    let settings_path = paths.claude_dir.join("settings.json");
    if !settings_path.exists() {
        fs::write(&settings_path, "{\n}\n").map_err(|err| err.to_string())?;
    }

    let mcp_path = paths.claude_dir.join("mcp.json");
    if !mcp_path.exists() {
        fs::write(&mcp_path, "{\n  \"mcpServers\": {}\n}\n").map_err(|err| err.to_string())?;
    }

    Ok(())
}

fn append_ai_log(paths: &StoragePaths, message: &str) {
    if let Some(log_dir) = paths.log_file.parent() {
        let _ = fs::create_dir_all(log_dir);
    }

    let timestamp = now_ms();
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&paths.log_file)
    {
        let _ = writeln!(file, "[{timestamp}] {message}");
    }
}

fn ai_settings_path(paths: &StoragePaths) -> PathBuf {
    paths.mypets_ai_dir.join("settings.json")
}

fn load_settings(paths: &StoragePaths) -> Result<AiSettings, String> {
    let path = ai_settings_path(paths);
    if !path.exists() {
        let settings = AiSettings::default();
        save_settings(paths, &settings)?;
        return Ok(settings);
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("Cannot read AI settings: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid AI settings: {err}"))
}

fn save_settings(paths: &StoragePaths, settings: &AiSettings) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(settings).map_err(|err| err.to_string())?;
    fs::write(ai_settings_path(paths), format!("{raw}\n")).map_err(|err| err.to_string())
}

fn session_meta_path(paths: &StoragePaths, conversation_id: &str) -> PathBuf {
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

fn write_session_meta(
    paths: &StoragePaths,
    conversation_id: &str,
    provider_state: Value,
    prompt: &str,
) -> Result<(), String> {
    let path = session_meta_path(paths, conversation_id);
    let now = now_ms();
    let existing_meta = if path.exists() {
        fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<AiSessionMeta>(&raw).ok())
    } else {
        None
    };
    let title = existing_meta
        .as_ref()
        .map(|meta| meta.title.clone())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| prompt.chars().take(40).collect::<String>());
    let created_at = existing_meta.map(|meta| meta.created_at).unwrap_or(now);

    let meta = AiSessionMeta {
        id: conversation_id.to_string(),
        provider_id: default_provider_id(),
        provider_state,
        title,
        created_at,
        updated_at: now,
    };
    let raw = serde_json::to_string_pretty(&meta).map_err(|err| err.to_string())?;
    fs::write(path, format!("{raw}\n")).map_err(|err| err.to_string())
}

fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let project_helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Cannot resolve project root".to_string())?
        .join("src-node")
        .join("claude-runner.mjs");
    if project_helper.exists() {
        return Ok(project_helper);
    }

    let resource_helper = app
        .path()
        .resource_dir()
        .map_err(|err| format!("Cannot resolve resource directory: {err}"))?
        .join("claude-runner.mjs");
    if resource_helper.exists() {
        return Ok(resource_helper);
    }

    Err("Claude helper script not found".to_string())
}

#[tauri::command]
pub fn load_ai_state(workspace_folder: String) -> Result<AiState, String> {
    let paths = storage_paths(&workspace_folder)?;
    ensure_storage(&paths)?;
    let settings = load_settings(&paths)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn save_ai_settings(workspace_folder: String, settings: AiSettings) -> Result<AiState, String> {
    let paths = storage_paths(&workspace_folder)?;
    ensure_storage(&paths)?;
    save_settings(&paths, &settings)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn send_ai_chat_message(app: AppHandle, request: AiChatRequest) -> Result<String, String> {
    let paths = storage_paths(&request.workspace_folder)?;
    ensure_storage(&paths)?;
    let settings = load_settings(&paths)?;
    write_session_meta(
        &paths,
        &request.conversation_id,
        request.provider_state.clone(),
        &request.prompt,
    )?;

    let helper = match helper_path(&app) {
        Ok(path) => path,
        Err(err) => {
            append_ai_log(&paths, &format!("Cannot resolve Claude helper: {err}"));
            return Err(err);
        }
    };
    let current_dir = paths.workspace_dir.clone();
    let claude_dir = paths.claude_dir.clone();
    let payload = json!({
        "requestId": request.request_id,
        "conversationId": request.conversation_id,
        "prompt": request.prompt,
        "providerState": request.provider_state,
        "settings": settings.claude,
        "paths": public_paths(&paths),
    });

    append_ai_log(&paths, &format!("Starting Claude request {}", request.request_id));

    let mut child = match Command::new("node")
        .arg(helper)
        .current_dir(&current_dir)
        .env("CLAUDE_CONFIG_DIR", &claude_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            let message = format!("Cannot start Node Claude helper: {err}");
            append_ai_log(&paths, &message);
            return Err(message);
        }
    };

    if let Some(stdin) = child.stdin.as_mut() {
        if let Err(err) = stdin.write_all(payload.to_string().as_bytes()) {
            let message = format!("Cannot write Claude helper input: {err}");
            append_ai_log(&paths, &message);
            return Err(message);
        }
    }
    drop(child.stdin.take());

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot read Claude helper stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot read Claude helper stderr".to_string())?;
    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let request_id_for_stdout = request.request_id.clone();
    let request_id_for_stderr = request.request_id.clone();
    let conversation_id = request.conversation_id.clone();
    let paths_for_meta = paths.clone();
    let paths_for_log = paths.clone();
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);
    let stderr_log_paths = paths.clone();

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
            append_ai_log(&stderr_log_paths, &format!("stderr: {line}"));
        }
        let _ = app_for_stderr.emit(
            "ai-chat-debug",
            json!({ "requestId": request_id_for_stderr, "stream": "stderr" }),
        );
    });

    thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };

            if event.get("type").and_then(Value::as_str) == Some("session") {
                if let Some(provider_state) = event.get("providerState") {
                    let _ = write_session_meta(
                        &paths_for_meta,
                        &conversation_id,
                        provider_state.clone(),
                        "Claude conversation",
                    );
                }
            }

            if event.get("type").and_then(Value::as_str) == Some("error") {
                let error = event
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("Claude helper emitted an error");
                append_ai_log(&paths_for_log, &format!("event error: {error}"));
            }

            let _ = app_for_stdout.emit("ai-chat-event", event);
        }

        match child.wait() {
            Ok(status) if status.success() => {}
            Ok(status) => {
                let stderr_text = stderr_buffer
                    .lock()
                    .map(|buffer| buffer.trim().to_string())
                    .unwrap_or_default();
                let error = if stderr_text.is_empty() {
                    format!("Claude helper exited with status {status}")
                } else {
                    stderr_text
                };
                append_ai_log(&paths_for_log, &format!("process error: {error}"));
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": error }),
                );
            }
            Err(err) => {
                append_ai_log(&paths_for_log, &format!("wait error: {err}"));
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": err.to_string() }),
                );
            }
        }
    });

    Ok(request.request_id)
}
