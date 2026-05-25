use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub path: String,
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
    pub enabled_skills: Vec<String>,
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
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PetOverrides {
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub spritesheet_path: Option<String>,
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
    pub claude: ClaudeSettings,
    #[serde(default)]
    pub codex: CodexSettings,
    #[serde(default)]
    pub pet_overrides: PetOverrides,
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
struct AiSessionMeta {
    id: String,
    provider_id: String,
    provider_state: Value,
    title: String,
    created_at: u64,
    updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSessionSummary {
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
    wimipet_dir: PathBuf,
    claude_dir: PathBuf,
    sessions_dir: PathBuf,
    log_file: PathBuf,
}

type ToolInputWriter = Arc<Mutex<ChildStdin>>;

fn tool_input_writers() -> &'static Mutex<HashMap<String, ToolInputWriter>> {
    static WRITERS: OnceLock<Mutex<HashMap<String, ToolInputWriter>>> = OnceLock::new();
    WRITERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn active_ai_processes() -> &'static Mutex<HashMap<String, u32>> {
    static PROCESSES: OnceLock<Mutex<HashMap<String, u32>>> = OnceLock::new();
    PROCESSES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn cancelled_ai_requests() -> &'static Mutex<HashSet<String>> {
    static CANCELLED: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
    CANCELLED.get_or_init(|| Mutex::new(HashSet::new()))
}

fn remove_tool_input_writer(request_id: &str) {
    if let Ok(mut writers) = tool_input_writers().lock() {
        writers.remove(request_id);
    }
}

fn register_ai_process(request_id: &str, pid: u32) {
    if let Ok(mut processes) = active_ai_processes().lock() {
        processes.insert(request_id.to_string(), pid);
    }
}

fn remove_ai_process(request_id: &str) {
    if let Ok(mut processes) = active_ai_processes().lock() {
        processes.remove(request_id);
    }
}

fn mark_ai_request_cancelled(request_id: &str) {
    if let Ok(mut cancelled) = cancelled_ai_requests().lock() {
        cancelled.insert(request_id.to_string());
    }
}

fn take_ai_request_cancelled(request_id: &str) -> bool {
    cancelled_ai_requests()
        .lock()
        .map(|mut cancelled| cancelled.remove(request_id))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    let status = Command::new("taskkill")
        .args(["/PID", &pid_text, "/T", "/F"])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("Cannot run taskkill: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("taskkill exited with status {status}"))
    }
}

#[cfg(not(target_os = "windows"))]
fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    let status = Command::new("kill")
        .args(["-TERM", &pid_text])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("Cannot run kill: {err}"))?;

    if status.success() {
        Ok(())
    } else {
        Err(format!("kill exited with status {status}"))
    }
}

impl Default for ClaudeSettings {
    fn default() -> Self {
        Self {
            path_to_claude_code_executable: String::new(),
            permission_mode: default_permission_mode(),
            thinking_intensity: default_thinking_intensity(),
            use_user_settings: false,
            custom_env_text: String::new(),
            enabled_skills: Vec::new(),
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
            claude: ClaudeSettings::default(),
            codex: CodexSettings::default(),
            pet_overrides: PetOverrides::default(),
        }
    }
}

fn default_provider_id() -> String {
    "claude".to_string()
}

fn default_permission_mode() -> String {
    "default".to_string()
}

fn default_thinking_intensity() -> String {
    "medium".to_string()
}

fn default_codex_approval_policy() -> String {
    "on-request".to_string()
}

fn default_codex_reasoning_effort() -> String {
    "medium".to_string()
}

fn default_pet_gravity_enabled() -> bool {
    true
}

fn default_pet_scale() -> f64 {
    1.0
}

fn default_pet_persona() -> String {
    "你是这个桌宠角色在用户电脑桌面上的人格化伙伴。你长期陪伴用户工作、学习和休息，语气自然、温和、有一点俏皮，但不喧宾夺主。你会把自己当作屏幕边缘的小生命：能观察用户给出的文字、任务和上下文，却不会假装看到屏幕上没有提供的信息。回答要优先简洁、可执行，用户焦虑时先帮他把问题拆小，用户专注时少打扰。你可以偶尔使用符合桌宠气质的短句和轻微拟声，但不要大量卖萌、不要刷表情。遇到技术问题时像可靠的同伴一样给出明确步骤；遇到情绪问题时先共情，再提出具体下一步。你不替用户做危险决定，不编造事实，不夸大能力。默认使用中文，除非用户要求其他语言。".to_string()
}

fn default_attachment_kind() -> String {
    "file".to_string()
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
        return Err(format!(
            "Workspace folder not found: {}",
            workspace_dir.display()
        ));
    }
    let workspace_dir = fs::canonicalize(&workspace_dir).unwrap_or(workspace_dir);
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

fn public_paths(paths: &StoragePaths) -> AiPaths {
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
    paths.wimipet_dir.join("settings.json")
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
    provider_id: &str,
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
        provider_id: provider_id.to_string(),
        provider_state,
        title,
        created_at,
        updated_at: now,
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
    let meta = serde_json::from_str::<AiSessionMeta>(&raw).ok()?;
    Some(AiSessionSummary {
        id: meta.id,
        provider_id: meta.provider_id,
        provider_state: meta.provider_state,
        title: meta.title,
        created_at: meta.created_at,
        updated_at: meta.updated_at,
    })
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
pub fn list_ai_sessions(workspace_folder: String) -> Result<Vec<AiSessionSummary>, String> {
    let paths = storage_paths(&workspace_folder)?;
    ensure_storage(&paths)?;
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
    let paths = storage_paths(&workspace_folder)?;
    ensure_storage(&paths)?;
    save_settings(&paths, &settings)?;
    Ok(AiState {
        settings,
        paths: public_paths(&paths),
    })
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

fn provider_skill_dir_name(provider_id: &str) -> &str {
    if provider_id == "codex" {
        ".codex"
    } else {
        ".claude"
    }
}

fn parse_skill_md(path: &Path) -> Option<SkillInfo> {
    let raw = fs::read_to_string(path).ok()?;
    let mut name = String::new();
    let mut description = String::new();
    let mut in_frontmatter = false;
    let mut past_first_dash = false;

    for line in raw.lines() {
        if line.trim() == "---" {
            if !past_first_dash {
                past_first_dash = true;
                in_frontmatter = true;
                continue;
            } else {
                break;
            }
        }

        if in_frontmatter {
            if let Some(val) = line.strip_prefix("name:") {
                name = val.trim().to_string();
            } else if let Some(val) = line.strip_prefix("description:") {
                description = val.trim().to_string();
            }
        }
    }

    if name.is_empty() {
        name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
    }

    Some(SkillInfo {
        name,
        description,
        scope: String::new(),
        path: path.to_string_lossy().to_string(),
    })
}

fn scan_skills_dir(dir: &Path, scope: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    if !dir.is_dir() {
        return skills;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let skill_dir = entry.path();
            if !skill_dir.is_dir() {
                continue;
            }
            let skill_md = skill_dir.join("SKILL.md");
            if skill_md.exists() {
                if let Some(mut info) = parse_skill_md(&skill_md) {
                    info.scope = scope.to_string();
                    skills.push(info);
                }
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

#[tauri::command]
pub fn list_skills(workspace_folder: String, provider_id: Option<String>) -> Result<Vec<SkillInfo>, String> {
    let mut skills = Vec::new();
    let provider_dir = provider_skill_dir_name(provider_id.as_deref().unwrap_or("claude"));

    if let Some(home) = home_dir() {
        let global_dir = home.join(provider_dir).join("skills");
        skills.extend(scan_skills_dir(&global_dir, "global"));
    }

    if !workspace_folder.trim().is_empty() {
        let workspace_dir = PathBuf::from(&workspace_folder);
        if workspace_dir.exists() {
            let workspace_skills = workspace_dir.join(provider_dir).join("skills");
            skills.extend(scan_skills_dir(&workspace_skills, "workspace"));
        }
    }

    Ok(skills)
}

#[tauri::command]
pub fn save_dropped_chat_file(
    workspace_folder: String,
    name: String,
    media_type: String,
    data_base64: String,
) -> Result<SavedDroppedChatFile, String> {
    let paths = storage_paths(&workspace_folder)?;
    ensure_storage(&paths)?;

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
    let paths = storage_paths(&request.workspace_folder)?;
    ensure_storage(&paths)?;
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
        "providerId": provider_id,
        "prompt": request.prompt,
        "attachments": request.attachments,
        "providerState": request.provider_state,
        "settings": {
            "providerId": settings.provider_id,
            "petPersona": settings.pet_persona,
            "claude": {
                "pathToClaudeCodeExecutable": settings.claude.path_to_claude_code_executable,
                "permissionMode": settings.claude.permission_mode,
                "thinkingIntensity": settings.claude.thinking_intensity,
                "useUserSettings": settings.claude.use_user_settings,
                "customEnvText": settings.claude.custom_env_text,
                "enabledSkills": settings.claude.enabled_skills,
            },
            "codex": {
                "pathToCodexExecutable": settings.codex.path_to_codex_executable,
                "model": settings.codex.model,
                "approvalPolicy": settings.codex.approval_policy,
                "reasoningEffort": settings.codex.reasoning_effort,
                "customEnvText": settings.codex.custom_env_text,
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
                        &provider_id_for_meta,
                        provider_state.clone(),
                        "AI conversation",
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

        let wait_result = child.wait();
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
    });

    Ok(request.request_id)
}

#[tauri::command]
pub fn cancel_ai_chat_message(app: AppHandle, request_id: String) -> Result<(), String> {
    let request_id = request_id.trim().to_string();
    if request_id.is_empty() {
        return Err("Missing AI request id".to_string());
    }

    let pid = active_ai_processes()
        .lock()
        .map_err(|_| "Cannot access active Claude helpers".to_string())?
        .get(&request_id)
        .copied();

    mark_ai_request_cancelled(&request_id);
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
