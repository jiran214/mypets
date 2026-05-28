use std::{
    collections::{HashMap, HashSet},
    process::{ChildStdin, Command, Stdio},
    sync::{Arc, Mutex, OnceLock},
};

pub(crate) type ToolInputWriter = Arc<Mutex<ChildStdin>>;

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

pub fn terminate_all_ai_processes() {
    if let Ok(mut processes) = active_ai_processes().lock() {
        for (_, pid) in processes.drain() {
            let _ = terminate_process_tree(pid);
        }
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
