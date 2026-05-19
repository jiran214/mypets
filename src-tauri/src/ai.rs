use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
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
    #[serde(default)]
    pub cwd: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default)]
    pub max_turns: Option<u32>,
    #[serde(default)]
    pub system_prompt: String,
    #[serde(default)]
    pub use_project_settings: bool,
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
    pub app_data_dir: String,
    pub mypets_ai_dir: String,
    pub claude_dir: String,
    pub sessions_dir: String,
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

struct StoragePaths {
    app_data_dir: PathBuf,
    mypets_ai_dir: PathBuf,
    claude_dir: PathBuf,
    sessions_dir: PathBuf,
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            path_to_claude_code_executable: String::new(),
            cwd: String::new(),
            model: String::new(),
            permission_mode: default_permission_mode(),
            max_turns: Some(8),
            system_prompt: "你是一个简洁、可靠的桌宠助手。".to_string(),
            use_project_settings: false,
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

fn storage_paths(app: &AppHandle) -> Result<StoragePaths, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|err| format!("Cannot resolve app data directory: {err}"))?;
    let mypets_ai_dir = app_data_dir.join(".mypets-ai");
    let claude_dir = app_data_dir.join(".claude");
    let sessions_dir = mypets_ai_dir.join("sessions");

    Ok(StoragePaths {
        app_data_dir,
        mypets_ai_dir,
        claude_dir,
        sessions_dir,
    })
}

fn public_paths(paths: &StoragePaths) -> AiPaths {
    AiPaths {
        app_data_dir: path_to_string(&paths.app_data_dir),
        mypets_ai_dir: path_to_string(&paths.mypets_ai_dir),
        claude_dir: path_to_string(&paths.claude_dir),
        sessions_dir: path_to_string(&paths.sessions_dir),
    }
}

fn ensure_storage(paths: &StoragePaths) -> Result<(), String> {
    fs::create_dir_all(&paths.mypets_ai_dir).map_err(|err| err.to_string())?;
    fs::create_dir_all(&paths.sessions_dir).map_err(|err| err.to_string())?;
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
pub fn load_ai_state(app: AppHandle) -> Result<AiState, String> {
    let paths = storage_paths(&app)?;
    ensure_storage(&paths)?;
    let settings = load_settings(&paths)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn save_ai_settings(app: AppHandle, settings: AiSettings) -> Result<AiState, String> {
    let paths = storage_paths(&app)?;
    ensure_storage(&paths)?;
    save_settings(&paths, &settings)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn send_ai_chat_message(app: AppHandle, request: AiChatRequest) -> Result<String, String> {
    let paths = storage_paths(&app)?;
    ensure_storage(&paths)?;
    let settings = load_settings(&paths)?;
    write_session_meta(
        &paths,
        &request.conversation_id,
        request.provider_state.clone(),
        &request.prompt,
    )?;

    let helper = helper_path(&app)?;
    let payload = json!({
        "requestId": request.request_id,
        "prompt": request.prompt,
        "providerState": request.provider_state,
        "settings": settings.claude,
        "paths": public_paths(&paths),
    });

    let mut child = Command::new("node")
        .arg(helper)
        .current_dir(
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .unwrap_or_else(|| Path::new(".")),
        )
        .env("CLAUDE_CONFIG_DIR", &paths.claude_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|err| format!("Cannot start Node Claude helper: {err}"))?;

    if let Some(stdin) = child.stdin.as_mut() {
        stdin
            .write_all(payload.to_string().as_bytes())
            .map_err(|err| format!("Cannot write Claude helper input: {err}"))?;
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
    let paths_for_meta = paths;
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);

    thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
            }
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
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": error }),
                );
            }
            Err(err) => {
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": err.to_string() }),
                );
            }
        }
    });

    Ok(request.request_id)
}
