use base64::{engine::general_purpose, Engine as _};
use serde_json::{json, Value};
use std::{
    fs,
    io::Write,
    path::Path,
};
use tauri::{AppHandle, Emitter};

use super::ai_models::*;
use super::ai_payload::{build_chat_payload, helper_path, session_prompt};
use super::ai_process::{
    active_ai_process_pid, mark_ai_request_cancelled, remove_tool_input_writer,
    terminate_process_tree, tool_input_writers,
};
use super::ai_runner::{spawn_node_runner, RunnerConfig};
use super::ai_skills::{collect_all_skills, default_provider_id, SkillInfo};
use super::ai_storage::{
    append_ai_log, load_agents_md, load_auto_tasks, load_settings, now_ms, path_to_string,
    pi_auth_path, public_paths, read_pi_auth_file, resolve_storage, safe_pi_auth_key,
    save_agents_md, save_auto_tasks_file, save_settings, write_session_meta, LogLevel,
};

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
pub fn load_agents_md_content(workspace_folder: String) -> Result<String, String> {
    let paths = resolve_storage(&workspace_folder)?;
    Ok(load_agents_md(&paths))
}

#[tauri::command]
pub fn save_agents_md_content(workspace_folder: String, content: String) -> Result<(), String> {
    let paths = resolve_storage(&workspace_folder)?;
    save_agents_md(&paths, &content)
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
    tasks.retain(|item| item.id != task_id);
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
    let workspace_dir = std::path::PathBuf::from(&workspace_folder);
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
    let session_prompt = session_prompt(&request);
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
            append_ai_log(&paths, LogLevel::Error, "commands", &format!("Cannot resolve AI runner: {err}"));
            return Err(err);
        }
    };

    let all_skill_names: Vec<String> = collect_all_skills(&paths.workspace_dir, &provider_id)
        .into_iter()
        .map(|s| s.name)
        .collect();
    let payload = build_chat_payload(&request, &settings, &all_skill_names, &paths);

    let config = RunnerConfig {
        request_id: request.request_id.clone(),
        conversation_id: request.conversation_id.clone(),
        provider_id: provider_id.clone(),
        paths: paths.clone(),
        helper,
        workspace_dir: paths.workspace_dir.clone(),
        payload,
    };

    spawn_node_runner(&app, config)
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
        .map_err(|_| "Cannot access AI runner input".to_string())?
        .get(&request.request_id)
        .cloned()
        .ok_or_else(|| "AI request is no longer waiting for input".to_string())?;

    let payload = json!({
        "type": "tool_response",
        "requestId": request.request_id,
        "questionId": request.question_id,
        "response": request.response,
    });
    let mut writer = writer
        .lock()
        .map_err(|_| "Cannot lock AI runner input".to_string())?;
    writeln!(writer, "{}", payload).map_err(|err| format!("Cannot write tool response: {err}"))?;
    writer
        .flush()
        .map_err(|err| format!("Cannot flush tool response: {err}"))
}

fn read_session_meta(path: &Path) -> Option<AiSessionSummary> {
    let raw = fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
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
