use serde_json::Value;
use tauri::AppHandle;

use super::tools_countdown::handle_countdown;
use super::tools_pomodoro::handle_pomodoro;
use super::tools_storage::tools_data_dir;
use super::tools_todolist::handle_todolist;

#[tauri::command]
pub fn send_tools_command(
    _app: AppHandle,
    workspace_folder: String,
    command: String,
    action: String,
    params: Value,
) -> Result<Value, String> {
    let command = command.trim().to_string();
    let action = action.trim().to_string();

    if command.is_empty() {
        return Err("Missing tools command".to_string());
    }
    if action.is_empty() {
        return Err("Missing tools action".to_string());
    }

    crate::ai::resolve_storage(&workspace_folder)?;
    let data_dir = tools_data_dir();
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Cannot create tools data directory: {err}"))?;

    match command.as_str() {
        "pomodoro" => handle_pomodoro(&data_dir, &action, &params),
        "todolist" => handle_todolist(&data_dir, &action, &params),
        "countdown" => handle_countdown(&data_dir, &action, &params),
        _ => Err(format!("Unsupported tools command: {command}")),
    }
}
