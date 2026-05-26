mod ai_process;
mod ai_skills;
mod ai_storage;

use ai_process::{
    active_ai_process_pid, mark_ai_request_cancelled, register_ai_process, remove_ai_process,
    remove_tool_input_writer, take_ai_request_cancelled, terminate_process_tree,
    tool_input_writers,
};
use ai_skills::{collect_all_skills, default_provider_id, home_dir, SkillInfo};
use ai_storage::{
    append_ai_log, path_to_string, public_paths, resolve_storage, now_ms,
    ai_settings_path, auto_tasks_path, StoragePaths,
};

use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PiSettings {
    #[serde(default)]
    pub path_to_pi_executable: String,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_pi_thinking_level")]
    pub thinking_level: String,
    #[serde(default)]
    pub session_dir: String,
    #[serde(default)]
    pub use_no_session: bool,
    #[serde(default = "default_pi_auto_compaction_enabled")]
    pub auto_compaction_enabled: bool,
    #[serde(default = "default_pi_auto_retry_enabled")]
    pub auto_retry_enabled: bool,
    #[serde(default = "default_pi_queue_mode")]
    pub steering_mode: String,
    #[serde(default = "default_pi_queue_mode")]
    pub follow_up_mode: String,
    #[serde(default)]
    pub custom_env_text: String,
    #[serde(default)]
    pub disabled_skills: Vec<String>,
    #[serde(default)]
    pub extra_skill_paths: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeSettings {
    #[serde(default)]
    pub path_to_claude_code_executable: String,
    #[serde(default = "default_permission_mode")]
    pub permission_mode: String,
    #[serde(default = "default_thinking_intensity")]
    pub thinking_intensity: String,
    #[serde(default)]
    pub use_user_settings: bool,
    #[serde(default)]
    pub custom_env_text: String,
    #[serde(default)]
    pub disabled_skills: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CodexSettings {
    #[serde(default)]
    pub path_to_codex_executable: String,
    #[serde(default)]
    pub model: String,
    #[serde(default = "default_codex_approval_policy")]
    pub approval_policy: String,
    #[serde(default = "default_codex_reasoning_effort")]
    pub reasoning_effort: String,
    #[serde(default)]
    pub custom_env_text: String,
    #[serde(default)]
    pub disabled_skills: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AiSettings {
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default)]
    pub pet_always_on_top: bool,
    #[serde(default = "default_pet_gravity_enabled")]
    pub pet_gravity_enabled: bool,
    #[serde(default = "default_pet_scale")]
    pub pet_scale: f64,
    #[serde(default)]
    pub pet_resize_enabled: bool,
    #[serde(default = "default_pet_persona")]
    pub pet_persona: String,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub pi: PiSettings,
    #[serde(default)]
    pub claude: ClaudeSettings,
    #[serde(default)]
    pub codex: CodexSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPaths {
    pub workspace_dir: String,
    pub wimipet_dir: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PiProviderAuth {
    pub provider: String,
    pub auth_key: String,
    pub key: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatAttachment {
    #[serde(default = "default_attachment_kind")]
    pub kind: String,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub media_type: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDroppedChatFile {
    pub path: String,
    pub name: String,
    pub media_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatRequest {
    pub request_id: String,
    pub conversation_id: String,
    pub workspace_folder: String,
    #[serde(default = "default_provider_id")]
    pub provider_id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub auto_task_id: String,
    #[serde(default)]
    pub auto_task_name: String,
    pub prompt: String,
    #[serde(default)]
    pub attachments: Vec<AiChatAttachment>,
    #[serde(default)]
    pub provider_state: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiToolQuestionAnswerRequest {
    pub request_id: String,
    pub question_id: String,
    pub response: Value,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSummary {
    id: String,
    provider_id: String,
    provider_state: Value,
    title: String,
    created_at: u64,
    updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    auto_task_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutoTaskSchedule {
    #[serde(default = "default_auto_task_schedule_kind")]
    pub kind: String,
    #[serde(default)]
    pub time: String,
    #[serde(default)]
    pub weekday: Option<u8>,
    #[serde(default)]
    pub interval_value: Option<u32>,
    #[serde(default)]
    pub interval_unit: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AutoTask {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default)]
    pub schedule: AutoTaskSchedule,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub created_at: u64,
    #[serde(default)]
    pub updated_at: u64,
    #[serde(default)]
    pub next_run_at: Option<u64>,
    #[serde(default)]
    pub last_run_at: Option<u64>,
    #[serde(default)]
    pub last_status_at: Option<u64>,
    #[serde(default = "default_auto_task_status")]
    pub last_status: String,
    #[serde(default)]
    pub last_error: String,
    #[serde(default)]
    pub run_count: u32,
    #[serde(default)]
    pub current_conversation_id: String,
}


impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            path_to_claude_code_executable: String::new(),
            permission_mode: default_permission_mode(),
            thinking_intensity: default_thinking_intensity(),
            use_user_settings: false,
            custom_env_text: String::new(),
            disabled_skills: Vec::new(),
        }
    }
}

impl Default for PiSettings {
    fn default() -> Self {
        Self {
            path_to_pi_executable: String::new(),
            provider: String::new(),
            model: String::new(),
            thinking_level: default_pi_thinking_level(),
            session_dir: String::new(),
            use_no_session: false,
            auto_compaction_enabled: default_pi_auto_compaction_enabled(),
            auto_retry_enabled: default_pi_auto_retry_enabled(),
            steering_mode: default_pi_queue_mode(),
            follow_up_mode: default_pi_queue_mode(),
            custom_env_text: String::new(),
            disabled_skills: Vec::new(),
            extra_skill_paths: String::new(),
        }
    }
}

impl Default for CodexSettings {
    fn default() -> Self {
        Self {
            path_to_codex_executable: String::new(),
            model: String::new(),
            approval_policy: default_codex_approval_policy(),
            reasoning_effort: default_codex_reasoning_effort(),
            custom_env_text: String::new(),
            disabled_skills: Vec::new(),
        }
    }
}

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            provider_id: default_provider_id(),
            pet_always_on_top: false,
            pet_gravity_enabled: default_pet_gravity_enabled(),
            pet_scale: default_pet_scale(),
            pet_resize_enabled: false,
            pet_persona: default_pet_persona(),
            display_name: String::new(),
            pi: PiSettings::default(),
            claude: ClaudeSettings::default(),
            codex: CodexSettings::default(),
        }
    }
}

impl Default for AutoTaskSchedule {
    fn default() -> Self {
        Self {
            kind: default_auto_task_schedule_kind(),
            time: "09:00".to_string(),
            weekday: Some(1),
            interval_value: Some(30),
            interval_unit: "minutes".to_string(),
        }
    }
}

macro_rules! default_fn {
    ($name:ident, String, $val:expr) => {
        fn $name() -> String { $val.to_string() }
    };
    ($name:ident, $ty:ty, $val:expr) => {
        fn $name() -> $ty { $val }
    };
}

default_fn!(default_pi_thinking_level, String, "medium");
default_fn!(default_pi_auto_compaction_enabled, bool, true);
default_fn!(default_pi_auto_retry_enabled, bool, true);
default_fn!(default_pi_queue_mode, String, "one-at-a-time");
default_fn!(default_permission_mode, String, "default");
default_fn!(default_thinking_intensity, String, "medium");
default_fn!(default_codex_approval_policy, String, "on-request");
default_fn!(default_codex_reasoning_effort, String, "medium");
default_fn!(default_pet_gravity_enabled, bool, true);
default_fn!(default_pet_scale, f64, 1.0);
default_fn!(default_pet_persona, String, "你是这个桌宠角色在用户电脑桌面上的人格化伙伴。你长期陪伴用户工作、学习和休息，语气自然、温和、有一点俏皮，但不喧宾夺主。你会把自己当作屏幕边缘的小生命：能观察用户给出的文字、任务和上下文，却不会假装看到屏幕上没有提供的信息。回答要优先简洁、可执行，用户焦虑时先帮他把问题拆小，用户专注时少打扰。你可以偶尔使用符合桌宠气质的短句和轻微拟声，但不要大量卖萌、不要刷表情。遇到技术问题时像可靠的同伴一样给出明确步骤；遇到情绪问题时先共情，再提出具体下一步。你不替用户做危险决定，不编造事实，不夸大能力。默认使用中文，除非用户要求其他语言。");
default_fn!(default_attachment_kind, String, "file");
default_fn!(default_auto_task_schedule_kind, String, "interval");
default_fn!(default_auto_task_status, String, "idle");


fn pi_auth_path() -> Result<PathBuf, String> {
    let home = home_dir().ok_or_else(|| "Cannot resolve user home directory".to_string())?;
    Ok(home.join(".pi").join("agent").join("auth.json"))
}

fn safe_pi_auth_key(provider: &str, auth_key: &str) -> Result<String, String> {
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

fn read_pi_auth_file(path: &Path) -> Result<serde_json::Map<String, Value>, String> {
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

fn load_auto_tasks(paths: &StoragePaths) -> Result<Vec<AutoTask>, String> {
    let path = auto_tasks_path(paths);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(&path).map_err(|err| format!("Cannot read auto tasks: {err}"))?;
    serde_json::from_str(&raw).map_err(|err| format!("Invalid auto tasks: {err}"))
}

fn save_auto_tasks_file(paths: &StoragePaths, tasks: &[AutoTask]) -> Result<(), String> {
    let raw = serde_json::to_string_pretty(tasks).map_err(|err| err.to_string())?;
    fs::write(auto_tasks_path(paths), format!("{raw}\n")).map_err(|err| err.to_string())
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
    provider_id: &str,
    provider_state: Value,
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
        provider_id: provider_id.to_string(),
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

fn attachment_title(attachment: &AiChatAttachment) -> String {
    if !attachment.name.trim().is_empty() {
        return attachment.name.clone();
    }
    if attachment.kind == "text" {
        let title = attachment.text.chars().take(40).collect::<String>();
        return if title.trim().is_empty() {
            "拖入文本".to_string()
        } else {
            title
        };
    }
    Path::new(&attachment.path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&attachment.path)
        .to_string()
}

fn safe_dropped_file_name(name: &str) -> String {
    let base = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("dropped-file")
        .trim();
    let sanitized: String = base
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches([' ', '.']);
    if trimmed.is_empty() {
        "dropped-file".to_string()
    } else {
        trimmed.to_string()
    }
}

fn read_session_meta(path: &Path) -> Option<AiSessionSummary> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
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
    let paths = resolve_storage(&workspace_folder)?;
    let settings = load_settings(&paths)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn list_ai_sessions(workspace_folder: String) -> Result<Vec<AiSessionSummary>, String> {
    let paths = resolve_storage(&workspace_folder)?;
    let mut sessions = Vec::new();

    for entry in fs::read_dir(&paths.sessions_dir).map_err(|err| err.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        let path = entry.path();
        let is_meta = path
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name.ends_with(".meta.json"));
        if is_meta {
            if let Some(meta) = read_session_meta(&path) {
                sessions.push(meta);
            }
        }
    }

    sessions.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(sessions)
}

#[tauri::command]
pub fn save_ai_settings(workspace_folder: String, settings: AiSettings) -> Result<AiState, String> {
    let paths = resolve_storage(&workspace_folder)?;
    save_settings(&paths, &settings)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

#[tauri::command]
pub fn load_pi_provider_auth(provider: String, auth_key: String) -> Result<PiProviderAuth, String> {
    let auth_key = safe_pi_auth_key(&provider, &auth_key)?;
    let path = pi_auth_path()?;
    let auth = read_pi_auth_file(&path)?;
    let key = auth
        .get(&auth_key)
        .and_then(Value::as_object)
        .and_then(|entry| entry.get("key"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    Ok(PiProviderAuth {
        provider,
        auth_key,
        key,
    })
}

#[tauri::command]
pub fn save_pi_provider_auth(
    provider: String,
    auth_key: String,
    key: String,
) -> Result<PiProviderAuth, String> {
    let auth_key = safe_pi_auth_key(&provider, &auth_key)?;
    let path = pi_auth_path()?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|err| format!("Cannot create Pi auth directory: {err}"))?;
    }

    let mut auth = read_pi_auth_file(&path)?;
    let trimmed_key = key.trim().to_string();
    if trimmed_key.is_empty() {
        auth.remove(&auth_key);
    } else {
        auth.insert(
            auth_key.clone(),
            json!({
                "type": "api_key",
                "key": trimmed_key,
            }),
        );
    }

    let raw = serde_json::to_string_pretty(&auth).map_err(|err| err.to_string())?;
    fs::write(&path, format!("{raw}\n"))
        .map_err(|err| format!("Cannot write Pi auth file: {err}"))?;

    Ok(PiProviderAuth {
        provider,
        auth_key,
        key: trimmed_key,
    })
}

#[tauri::command]
pub fn list_auto_tasks(workspace_folder: String) -> Result<Vec<AutoTask>, String> {
    let paths = resolve_storage(&workspace_folder)?;
    load_auto_tasks(&paths)
}

#[tauri::command]
pub fn save_auto_task(workspace_folder: String, mut task: AutoTask) -> Result<AutoTask, String> {
    let paths = resolve_storage(&workspace_folder)?;

    task.id = task.id.trim().to_string();
    if task.id.is_empty() {
        return Err("Auto task id is required".to_string());
    }

    let now = now_ms();
    if task.created_at == 0 {
        task.created_at = now;
    }
    task.updated_at = now;

    let mut tasks = load_auto_tasks(&paths)?;
    if let Some(existing) = tasks.iter_mut().find(|item| item.id == task.id) {
        *existing = task.clone();
    } else {
        tasks.push(task.clone());
    }

    tasks.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    save_auto_tasks_file(&paths, &tasks)?;
    Ok(task)
}

#[tauri::command]
pub fn delete_auto_task(workspace_folder: String, task_id: String) -> Result<(), String> {
    let paths = resolve_storage(&workspace_folder)?;
    let mut tasks = load_auto_tasks(&paths)?;
    let before = tasks.len();
    tasks.retain(|task| task.id != task_id);
    if tasks.len() != before {
        save_auto_tasks_file(&paths, &tasks)?;
    }
    Ok(())
}

#[tauri::command]
pub fn list_skills(
    workspace_folder: String,
    provider_id: Option<String>,
) -> Result<Vec<SkillInfo>, String> {
    let provider_id = provider_id.unwrap_or_else(default_provider_id);
    let workspace_dir = PathBuf::from(&workspace_folder);
    Ok(collect_all_skills(&workspace_dir, &provider_id))
}

#[tauri::command]
pub fn save_dropped_chat_file(
    workspace_folder: String,
    name: String,
    media_type: String,
    data_base64: String,
) -> Result<SavedDroppedChatFile, String> {
    let paths = resolve_storage(&workspace_folder)?;

    let file_bytes = general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|err| format!("Cannot decode dropped file: {err}"))?;
    let file_name = safe_dropped_file_name(&name);
    let drop_dir = paths.wimipet_dir.join("dropped-files");
    fs::create_dir_all(&drop_dir).map_err(|err| err.to_string())?;

    let path = drop_dir.join(format!("{}-{file_name}", now_ms()));
    fs::write(&path, file_bytes).map_err(|err| format!("Cannot save dropped file: {err}"))?;

    Ok(SavedDroppedChatFile {
        path: path_to_string(&path),
        name: file_name,
        media_type,
    })
}

#[tauri::command]
pub fn send_ai_chat_message(app: AppHandle, request: AiChatRequest) -> Result<String, String> {
    let paths = resolve_storage(&request.workspace_folder)?;
    let settings = load_settings(&paths)?;
    let provider_id = if request.provider_id.trim().is_empty() {
        settings.provider_id.clone()
    } else {
        request.provider_id.clone()
    };
    let session_prompt = if request.prompt.trim().is_empty() {
        let file_names = request
            .attachments
            .iter()
            .map(attachment_title)
            .collect::<Vec<_>>()
            .join(", ");
        if file_names.is_empty() {
            "文件".to_string()
        } else {
            file_names
        }
    } else {
        request.prompt.clone()
    };
    write_session_meta(
        &paths,
        &request.conversation_id,
        &provider_id,
        request.provider_state.clone(),
        &session_prompt,
        &request.title,
        &request.auto_task_id,
        &request.auto_task_name,
    )?;

    let helper = match helper_path(&app) {
        Ok(path) => path,
        Err(err) => {
            append_ai_log(&paths, &format!("Cannot resolve Claude helper: {err}"));
            return Err(err);
        }
    };

    let all_skill_names: Vec<String> = collect_all_skills(&paths.workspace_dir, &provider_id)
        .into_iter()
        .map(|s| s.name)
        .collect();
    let current_dir = paths.workspace_dir.clone();
    let claude_dir = paths.claude_dir.clone();
    let payload = json!({
        "requestId": request.request_id,
        "conversationId": request.conversation_id,
        "providerId": provider_id,
        "prompt": request.prompt,
        "attachments": request.attachments,
        "providerState": request.provider_state,
        "allSkillNames": all_skill_names,
        "settings": {
            "providerId": settings.provider_id,
            "petPersona": settings.pet_persona,
            "pi": {
                "pathToPiExecutable": settings.pi.path_to_pi_executable,
                "provider": settings.pi.provider,
                "model": settings.pi.model,
                "thinkingLevel": settings.pi.thinking_level,
                "sessionDir": settings.pi.session_dir,
                "useNoSession": settings.pi.use_no_session,
                "autoCompactionEnabled": settings.pi.auto_compaction_enabled,
                "autoRetryEnabled": settings.pi.auto_retry_enabled,
                "steeringMode": settings.pi.steering_mode,
                "followUpMode": settings.pi.follow_up_mode,
                "customEnvText": settings.pi.custom_env_text,
                "disabledSkills": settings.pi.disabled_skills,
                "extraSkillPaths": settings.pi.extra_skill_paths,
            },
            "claude": {
                "pathToClaudeCodeExecutable": settings.claude.path_to_claude_code_executable,
                "permissionMode": settings.claude.permission_mode,
                "thinkingIntensity": settings.claude.thinking_intensity,
                "useUserSettings": settings.claude.use_user_settings,
                "customEnvText": settings.claude.custom_env_text,
                "disabledSkills": settings.claude.disabled_skills,
            },
            "codex": {
                "pathToCodexExecutable": settings.codex.path_to_codex_executable,
                "model": settings.codex.model,
                "approvalPolicy": settings.codex.approval_policy,
                "reasoningEffort": settings.codex.reasoning_effort,
                "customEnvText": settings.codex.custom_env_text,
                "disabledSkills": settings.codex.disabled_skills,
            },
        },
        "paths": public_paths(&paths),
    });

    append_ai_log(
        &paths,
        &format!("Starting {} request {}", provider_id, request.request_id),
    );

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
    let child_pid = child.id();

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Cannot write Claude helper input".to_string())?;
    let stdin = Arc::new(Mutex::new(stdin));
    {
        let mut writer = stdin
            .lock()
            .map_err(|_| "Cannot lock Claude helper input".to_string())?;
        if let Err(err) = writeln!(writer, "{}", payload) {
            let message = format!("Cannot write Claude helper input: {err}");
            append_ai_log(&paths, &message);
            let _ = terminate_process_tree(child_pid);
            return Err(message);
        }
        if let Err(err) = writer.flush() {
            let message = format!("Cannot flush Claude helper input: {err}");
            append_ai_log(&paths, &message);
            let _ = terminate_process_tree(child_pid);
            return Err(message);
        }
    }
    if let Ok(mut writers) = tool_input_writers().lock() {
        writers.insert(request.request_id.clone(), Arc::clone(&stdin));
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot read Claude helper stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot read Claude helper stderr".to_string())?;
    register_ai_process(&request.request_id, child_pid);
    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let request_id_for_stdout = request.request_id.clone();
    let request_id_for_stderr = request.request_id.clone();
    let conversation_id = request.conversation_id.clone();
    let provider_id_for_meta = provider_id.clone();
    let paths_for_meta = paths.clone();
    let paths_for_log = paths.clone();
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);
    let stderr_log_paths = paths.clone();

    const STDERR_BUFFER_LIMIT: usize = 64 * 1024; // 64KB

    let stderr_handle = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
                // Cap buffer size to prevent unbounded growth
                if buffer.len() > STDERR_BUFFER_LIMIT {
                    let truncate_at = buffer.len() - STDERR_BUFFER_LIMIT / 2;
                    if let Some(newline_pos) = buffer[truncate_at..].find('\n') {
                        let cut = truncate_at + newline_pos + 1;
                        let truncated = format!("[truncated]\n{}", &buffer[cut..]);
                        *buffer = truncated;
                    }
                }
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
                append_ai_log(&paths_for_log, &format!("non-json stdout: {line}"));
                continue;
            };

            if event.get("type").and_then(Value::as_str) == Some("session") {
                if let Some(provider_state) = event.get("providerState") {
                    let _ = write_session_meta(
                        &paths_for_meta,
                        &conversation_id,
                        &provider_id_for_meta,
                        provider_state.clone(),
                        "AI conversation",
                        "",
                        "",
                        "",
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

        // Wait for child with timeout to prevent thread leak
        const WAIT_TIMEOUT_SECS: u64 = 30;
        let wait_result = {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(WAIT_TIMEOUT_SECS);
            loop {
                match child.try_wait() {
                    Ok(Some(status)) => break Ok(status),
                    Ok(None) => {
                        if std::time::Instant::now() >= deadline {
                            let _ = terminate_process_tree(child_pid);
                            break Err(std::io::Error::new(
                                std::io::ErrorKind::TimedOut,
                                format!("Process did not exit within {WAIT_TIMEOUT_SECS}s"),
                            ));
                        }
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(e) => break Err(e),
                }
            }
        };

        let was_cancelled = take_ai_request_cancelled(&request_id_for_stdout);
        remove_ai_process(&request_id_for_stdout);

        match wait_result {
            Ok(status) if status.success() || was_cancelled => {}
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
        remove_tool_input_writer(&request_id_for_stdout);

        // Join stderr thread to detect panics
        if let Err(e) = stderr_handle.join() {
            append_ai_log(&paths_for_log, &format!("stderr thread panicked: {e:?}"));
        }
    });

    Ok(request.request_id)
}

#[tauri::command]
pub fn cancel_ai_chat_message(app: AppHandle, request_id: String) -> Result<(), String> {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("Missing AI request id".to_string());
    }

    let pid = active_ai_process_pid(&request_id)?;

    mark_ai_request_cancelled(&request_id);
    let writer = tool_input_writers()
        .lock()
        .ok()
        .and_then(|writers| writers.get(&request_id).cloned());
    if let Some(writer) = writer {
        if let Ok(mut writer) = writer.lock() {
            let _ = writeln!(
                writer,
                "{}",
                json!({ "type": "abort", "requestId": request_id })
            );
            let _ = writer.flush();
        }
    }
    remove_tool_input_writer(&request_id);
    if let Some(pid) = pid {
        let _ = terminate_process_tree(pid);
    }

    let _ = app.emit(
        "ai-chat-event",
        json!({ "type": "cancelled", "requestId": request_id }),
    );
    Ok(())
}

#[tauri::command]
pub fn answer_ai_tool_question(request: AiToolQuestionAnswerRequest) -> Result<(), String> {
    let writer = tool_input_writers()
        .lock()
        .map_err(|_| "Cannot access Claude helper input".to_string())?
        .get(&request.request_id)
        .cloned()
        .ok_or_else(|| "Claude request is no longer waiting for input".to_string())?;

    let payload = json!({
        "type": "tool_response",
        "requestId": request.request_id,
        "questionId": request.question_id,
        "response": request.response,
    });
    let mut writer = writer
        .lock()
        .map_err(|_| "Cannot lock Claude helper input".to_string())?;
    writeln!(writer, "{}", payload).map_err(|err| format!("Cannot write tool response: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("Cannot flush tool response: {err}"))
}
