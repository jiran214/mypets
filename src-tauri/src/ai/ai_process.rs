use std::{
    collections::{HashMap, HashSet},
    io::Write,
    process::{ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
    thread,
    time::Duration,
};

use serde_json::json;

pub(crate) type ToolInputWriter = Arc<Mutex<ChildStdin>>;
const AI_TERMINATION_GRACE_MS: u64 = 800;

pub(crate) fn tool_input_writers() -> &'static Mutex<HashMap<String, ToolInputWriter>> {
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

pub(crate) fn remove_tool_input_writer(request_id: &str) {
    if let Ok(mut writers) = tool_input_writers().lock() {
        writers.remove(request_id);
    }
}

pub(crate) fn send_abort_to_request(request_id: &str) {
    let writer = tool_input_writers()
        .lock()
        .ok()
        .and_then(|writers| writers.get(request_id).cloned());
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
}

pub(crate) fn register_ai_process(request_id: &str, pid: u32) {
    if let Ok(mut processes) = active_ai_processes().lock() {
        processes.insert(request_id.to_string(), pid);
    }
}

pub(crate) fn remove_ai_process(request_id: &str) {
    if let Ok(mut processes) = active_ai_processes().lock() {
        processes.remove(request_id);
    }
}

pub(crate) fn mark_ai_request_cancelled(request_id: &str) {
    if let Ok(mut cancelled) = cancelled_ai_requests().lock() {
        cancelled.insert(request_id.to_string());
    }
}

pub(crate) fn take_ai_request_cancelled(request_id: &str) -> bool {
    cancelled_ai_requests()
        .lock()
        .map(|mut cancelled| cancelled.remove(request_id))
        .unwrap_or(false)
}

pub(crate) fn active_ai_process_pid(request_id: &str) -> Result<Option<u32>, String> {
    Ok(active_ai_processes()
        .lock()
        .map_err(|_| "Cannot access active AI processes".to_string())?
        .get(request_id)
        .copied())
}

pub(crate) fn terminate_process_tree_after_grace(request_id: String, pid: u32) {
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(AI_TERMINATION_GRACE_MS));
        let still_active = active_ai_process_pid(&request_id)
            .map(|active_pid| active_pid == Some(pid))
            .unwrap_or(false);
        if still_active {
            let _ = terminate_process_tree(pid);
            remove_ai_process(&request_id);
        }
        remove_tool_input_writer(&request_id);
    });
}

pub fn terminate_all_ai_processes() {
    let entries = active_ai_processes()
        .lock()
        .map(|processes| {
            processes
                .iter()
                .map(|(request_id, pid)| (request_id.clone(), *pid))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    if entries.is_empty() {
        return;
    }

    for (request_id, _) in &entries {
        mark_ai_request_cancelled(request_id);
        send_abort_to_request(request_id);
    }

    thread::sleep(Duration::from_millis(AI_TERMINATION_GRACE_MS));

    let mut remaining = Vec::new();
    if let Ok(mut processes) = active_ai_processes().lock() {
        for (request_id, pid) in &entries {
            if processes.remove(request_id).is_some() {
                remaining.push((request_id.clone(), *pid));
            }
        }
    }

    for (_, pid) in remaining {
        let _ = terminate_process_tree(pid);
    }

    for (request_id, _) in entries {
        remove_tool_input_writer(&request_id);
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
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
pub(crate) fn terminate_process_tree(pid: u32) -> Result<(), String> {
    let pid_text = pid.to_string();
    let status = Command::new("kill")
        .args(["-TERM", &pid_text])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|err| format!("Cannot run kill: {err}"))?;

    if !status.success() {
        return Err(format!("kill -TERM exited with status {status}"));
    }

    std::thread::sleep(std::time::Duration::from_millis(200));
    let _ = Command::new("kill")
        .args(["-9", &pid_text])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();

    Ok(())
}
