use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PiSettings {
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
pub struct AiSettings {
    #[serde(default)]
    pub pet_always_on_top: bool,
    #[serde(default = "default_pet_gravity_enabled")]
    pub pet_gravity_enabled: bool,
    #[serde(default = "default_pet_scale")]
    pub pet_scale: f64,
    #[serde(default)]
    pub pet_resize_enabled: bool,
    #[serde(default)]
    pub display_name: String,
    #[serde(default)]
    pub pi: PiSettings,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiPaths {
    pub workspace_dir: String,
    pub wimipet_dir: String,
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

impl Default for PiSettings {
    fn default() -> Self {
        Self {
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

impl Default for AiSettings {
    fn default() -> Self {
        Self {
            pet_always_on_top: false,
            pet_gravity_enabled: default_pet_gravity_enabled(),
            pet_scale: default_pet_scale(),
            pet_resize_enabled: false,
            display_name: String::new(),
            pi: PiSettings::default(),
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
default_fn!(default_pet_gravity_enabled, bool, true);
default_fn!(default_pet_scale, f64, 1.0);
default_fn!(default_attachment_kind, String, "file");
default_fn!(default_auto_task_schedule_kind, String, "interval");
default_fn!(default_auto_task_status, String, "idle");
