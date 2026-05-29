use std::{
    io::Write,
    sync::{Arc, Mutex},
    thread,
};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use super::ai_process::{
    register_ai_process, remove_ai_process, remove_tool_input_writer, take_ai_request_cancelled,
    terminate_process_tree, tool_input_writers,
};
use super::ai_storage::{append_ai_log, LogLevel, StoragePaths};

const STDERR_BUFFER_LIMIT: usize = 64 * 1024; // 64KB

pub(crate) struct RunnerConfig {
    pub request_id: String,
    pub conversation_id: String,
    pub paths: StoragePaths,
    pub helper: std::path::PathBuf,
    pub workspace_dir: std::path::PathBuf,
    pub payload: Value,
}

pub(crate) fn spawn_node_runner(app: &AppHandle, config: RunnerConfig) -> Result<String, String> {
    let RunnerConfig {
        request_id,
        conversation_id,
        paths,
        helper,
        workspace_dir,
        payload,
    } = config;

    append_ai_log(
        &paths,
        LogLevel::Info,
        "runner",
        &format!("Starting Pi request {}", request_id),
    );

    let mut child = match std::process::Command::new("node")
        .arg(helper)
        .current_dir(&workspace_dir)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(err) => {
            let message = format!("Cannot start Node AI runner: {err}");
            append_ai_log(&paths, LogLevel::Error, "runner", &message);
            return Err(message);
        }
    };
    let child_pid = child.id();

    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Cannot write AI runner input".to_string())?;
    let stdin = Arc::new(Mutex::new(stdin));
    {
        let mut writer = stdin
            .lock()
            .map_err(|_| "Cannot lock AI runner input".to_string())?;
        if let Err(err) = writeln!(writer, "{}", payload) {
            let message = format!("Cannot write AI runner input: {err}");
            append_ai_log(&paths, LogLevel::Error, "runner", &message);
            let _ = terminate_process_tree(child_pid);
            return Err(message);
        }
        if let Err(err) = writer.flush() {
            let message = format!("Cannot flush AI runner input: {err}");
            append_ai_log(&paths, LogLevel::Error, "runner", &message);
            let _ = terminate_process_tree(child_pid);
            return Err(message);
        }
    }
    if let Ok(mut writers) = tool_input_writers().lock() {
        writers.insert(request_id.clone(), Arc::clone(&stdin));
    }

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Cannot read AI runner stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Cannot read AI runner stderr".to_string())?;
    register_ai_process(&request_id, child_pid);

    let app_for_stdout = app.clone();
    let app_for_stderr = app.clone();
    let request_id_for_stdout = request_id.clone();
    let request_id_for_stderr = request_id.clone();
    let paths_for_meta = paths.clone();
    let paths_for_log = paths.clone();
    let stderr_buffer = Arc::new(Mutex::new(String::new()));
    let stderr_for_thread = Arc::clone(&stderr_buffer);
    let stderr_log_paths = paths.clone();

    let stderr_handle = thread::spawn(move || {
        use std::io::Read;
        let mut stderr_bytes = Vec::new();
        let mut reader = std::io::BufReader::new(stderr);
        let _ = reader.read_to_end(&mut stderr_bytes);
        // Node.js stderr 默认是 UTF-8，使用 UTF-8 解码
        let decoded = String::from_utf8_lossy(&stderr_bytes);
        for line in decoded.lines() {
            if let Ok(mut buffer) = stderr_for_thread.lock() {
                buffer.push_str(line);
                buffer.push('\n');
                if buffer.len() > STDERR_BUFFER_LIMIT {
                    let truncate_at = buffer.len() - STDERR_BUFFER_LIMIT / 2;
                    if let Some(newline_pos) = buffer[truncate_at..].find('\n') {
                        let cut = truncate_at + newline_pos + 1;
                        let truncated = format!("[truncated]\n{}", &buffer[cut..]);
                        *buffer = truncated;
                    }
                }
            }
            append_ai_log(&stderr_log_paths, LogLevel::Warn, "runner", &format!("stderr: {line}"));
        }
        let _ = app_for_stderr.emit(
            "ai-chat-debug",
            json!({ "requestId": request_id_for_stderr, "stream": "stderr" }),
        );
    });

    thread::spawn(move || {
        use std::io::{BufRead, BufReader};
        // 逐行实时读取 stdout，保持 stream 效果
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            let line = match line_result {
                Ok(l) => l,
                Err(_) => break,
            };
            let line = line.trim();
            if line.is_empty() {
                continue;
            }

            let Ok(event) = serde_json::from_str::<Value>(line) else {
                append_ai_log(&paths_for_log, LogLevel::Warn, "runner", &format!("non-json stdout: {line}"));
                continue;
            };

            if event.get("type").and_then(Value::as_str) == Some("session") {
                if let Some(provider_state) = event.get("providerState") {
                    let _ = super::ai_storage::write_session_meta(
                        &paths_for_meta,
                        &conversation_id,
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
                    .unwrap_or("AI runner emitted an error");
                append_ai_log(&paths_for_log, LogLevel::Error, "runner", &format!("event error: {error}"));
            }

            append_ai_log(&paths_for_log, LogLevel::Info, "runner", &format!("event: {}", event));
            let _ = app_for_stdout.emit("ai-chat-event", event);
        }

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
                    format!("AI runner exited with status {status}")
                } else {
                    stderr_text
                };
                append_ai_log(&paths_for_log, LogLevel::Error, "runner", &format!("process error: {error}"));
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": error }),
                );
            }
            Err(err) => {
                append_ai_log(&paths_for_log, LogLevel::Error, "runner", &format!("wait error: {err}"));
                let _ = app_for_stdout.emit(
                    "ai-chat-event",
                    json!({ "type": "error", "requestId": request_id_for_stdout, "error": err.to_string() }),
                );
            }
        }
        remove_tool_input_writer(&request_id_for_stdout);

        if let Err(e) = stderr_handle.join() {
            append_ai_log(&paths_for_log, LogLevel::Error, "runner", &format!("stderr thread panicked: {e:?}"));
        }
    });

    Ok(request_id)
}
