use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::ai_skills::default_provider_id;

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
    pub id: String,
    pub provider_id: String,
    pub provider_state: Value,
    pub title: String,
    pub created_at: u64,
    pub updated_at: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_task_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_task_name: Option<String>,
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
        pub(crate) fn $name() -> String { $val.to_string() }
    };
    ($name:ident, $ty:ty, $val:expr) => {
        pub(crate) fn $name() -> $ty { $val }
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
