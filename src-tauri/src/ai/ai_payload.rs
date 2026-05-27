use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use super::ai_models::{AiChatAttachment, AiChatRequest, AiSettings};
use super::ai_storage::{public_paths, StoragePaths};

pub(crate) fn attachment_title(attachment: &AiChatAttachment) -> String {
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

pub(crate) fn session_prompt(request: &AiChatRequest) -> String {
    if request.prompt.trim().is_empty() {
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
    }
}

pub(crate) fn build_chat_payload(
    request: &AiChatRequest,
    settings: &AiSettings,
    all_skill_names: &[String],
    paths: &StoragePaths,
) -> Value {
    json!({
        "requestId": request.request_id,
        "conversationId": request.conversation_id,
        "providerId": settings.provider_id,
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
        "paths": public_paths(paths),
    })
}

pub(crate) fn helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let project_helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Cannot resolve project root".to_string())?
        .join("src-node")
        .join("runner.mjs");
    if project_helper.exists() {
        return Ok(project_helper);
    }

    let resource_helper = app
        .path()
        .resource_dir()
        .map_err(|err| format!("Cannot resolve resource directory: {err}"))?
        .join("runner.mjs");
    if resource_helper.exists() {
        return Ok(resource_helper);
    }

    Err("Runner script not found".to_string())
}
