use serde_json::Value;
use tauri::AppHandle;

use super::tools_models::ToolsCommandPayload;
use super::tools_runner::spawn_tools_runner;

#[tauri::command]
pub fn send_tools_command(
    app: AppHandle,
    workspace_folder: String,
    request_id: String,
    command: String,
    action: String,
    params: Value,
) -> Result<String, String> {
    let request_id = request_id.trim().to_string();
    let command = command.trim().to_string();
    let action = action.trim().to_string();

    if request_id.is_empty() {
        return Err("Missing tools request id".to_string());
    }
    if command.is_empty() {
        return Err("Missing tools command".to_string());
    }
    if action.is_empty() {
        return Err("Missing tools action".to_string());
    }

    let paths = crate::ai::resolve_storage(&workspace_folder)?;
    let payload = ToolsCommandPayload {
        request_id: request_id.clone(),
        command,
        action,
        params,
    };
    spawn_tools_runner(&app, &paths, payload)?;
    Ok(request_id)
}
