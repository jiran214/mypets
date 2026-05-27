use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    sync::{Arc, Mutex},
    thread,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use super::tools_models::ToolsCommandPayload;

const STDERR_BUFFER_LIMIT: usize = 32 * 1024;

pub(crate) fn spawn_tools_runner(
    app: &AppHandle,
    paths: &crate::ai::StoragePaths,
    payload: ToolsCommandPayload,
) -> Result<(), String> {
    let helper = tools_helper_path(app)?;
    let data_dir = paths.wimipet_dir.join("tools");
    std::fs::create_dir_all(&data_dir)
        .map_err(|err| format!("Cannot create tools data directory: {err}"))?;

    let mut child = std::process::Command::new("node")
        .arg(helper)
        .current_dir(&paths.workspace_dir)
        .env("TOOLS_DATA_DIR", &data_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|err| format!("Cannot start tools runner: {err}"))?;

    let request_id = payload.request_id.clone();
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| "Cannot write tools runner input".to_string())?;
        let raw = serde_json::to_string(&payload).map_err(|err| err.to_string())?;
        writeln!(stdin, "{raw}").map_err(|err| format!("Cannot write tools runner input: {err}"))?;
        stdin
            .flush()
            .map_err(|err| format!("Cannot flush tools runner input: {err}"))?;
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot read tools runner stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot read tools runner stderr".to_string())?;

    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let request_id_for_stdout = request_id.clone();
    let request_id_for_stderr = request_id.clone();
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);

    let stderr_handle = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                buffer.push_str(&line);
                buffer.push('\n');
                if buffer.len() > STDERR_BUFFER_LIMIT {
                    let truncate_at = buffer.len() - STDERR_BUFFER_LIMIT / 2;
                    if let Some(newline_pos) = buffer[truncate_at..].find('\n') {
                        let cut = truncate_at + newline_pos + 1;
                        *buffer = format!("[truncated]\n{}", &buffer[cut..]);
                    }
                }
            }
        }
        let _ = app_for_stderr.emit(
            "tools-debug",
            json!({ "requestId": request_id_for_stderr, "stream": "stderr" }),
        );
    });

    thread::spawn(move || {
        let mut emitted_error = false;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if event.get("type").and_then(Value::as_str) == Some("error") {
                emitted_error = true;
            }
            let _ = app_for_stdout.emit("tools-event", event);
        }

        match child.wait() {
            Ok(status) if status.success() || emitted_error => {}
            Ok(status) => {
                let stderr_text = stderr_buffer
                    .lock()
                    .map(|buffer| buffer.trim().to_string())
                    .unwrap_or_default();
                let error = if stderr_text.is_empty() {
                    format!("Tools runner exited with status {status}")
                } else {
                    stderr_text
                };
                let _ = app_for_stdout.emit(
                    "tools-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": error }),
                );
            }
            Err(err) => {
                let _ = app_for_stdout.emit(
                    "tools-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": err.to_string() }),
                );
            }
        }

        let _ = stderr_handle.join();
    });

    Ok(())
}

fn tools_helper_path(app: &AppHandle) -> Result<PathBuf, String> {
    let project_helper = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .ok_or_else(|| "Cannot resolve project root".to_string())?
        .join("src-node")
        .join("tools-runner.mjs");
    if project_helper.exists() {
        return Ok(project_helper);
    }

    let resource_helper = app
        .path()
        .resource_dir()
        .map_err(|err| format!("Cannot resolve resource directory: {err}"))?
        .join("tools-runner.mjs");
    if resource_helper.exists() {
        return Ok(resource_helper);
    }

    Err("Tools runner script not found".to_string())
}
