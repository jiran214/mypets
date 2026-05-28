use serde_json::{json, Value};

use super::tools_storage::{
    create_id, now_seconds, optional_text, read_json_file, resolve_data_file, today_date,
    write_json_file,
};

const FILE_NAME: &str = "pomodoro.json";

fn default_state() -> Value {
    json!({
        "current": null,
        "todayCompleted": [],
        "todayDate": today_date()
    })
}

fn normalize_state(value: &Value) -> Value {
    let current = value
        .get("current")
        .filter(|v| v.is_object())
        .cloned()
        .unwrap_or(Value::Null);
    let today_completed = value
        .get("todayCompleted")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let today_date_val = value
        .get("todayDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    json!({
        "current": current,
        "todayCompleted": today_completed,
        "todayDate": if today_date_val.is_empty() { today_date() } else { today_date_val }
    })
}

fn load_state(data_dir: &std::path::Path) -> Value {
    let path = resolve_data_file(data_dir, FILE_NAME);
    let mut state = normalize_state(&read_json_file(&path, default_state()));
    let today = today_date();
    let state_date = state
        .get("todayDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if state_date != today {
        state["todayCompleted"] = json!([]);
        state["todayDate"] = json!(today);
    }
    state
}

fn save_state(data_dir: &std::path::Path, state: &Value) -> Result<(), String> {
    write_json_file(&resolve_data_file(data_dir, FILE_NAME), state)
}

fn elapsed_seconds(current: &Value, now: u64) -> u64 {
    let Some(started_at) = current.get("startedAt").and_then(Value::as_u64) else {
        return 0;
    };
    let end = if current.get("status").and_then(Value::as_str) == Some("paused") {
        current
            .get("pausedAt")
            .and_then(Value::as_u64)
            .unwrap_or(now)
    } else {
        now
    };
    let total_paused = current
        .get("totalPausedSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    end.saturating_sub(started_at + total_paused)
}

fn remaining_seconds(current: &Value, now: u64) -> u64 {
    let Some(duration_min) = current.get("durationMinutes").and_then(Value::as_u64) else {
        return 0;
    };
    let total = duration_min * 60;
    let elapsed = elapsed_seconds(current, now);
    total.saturating_sub(elapsed)
}

fn complete_current_if_elapsed(state: &mut Value, now: u64) -> bool {
    let current = match state.get("current") {
        Some(c) if c.is_object() => c.clone(),
        _ => return false,
    };
    if current.get("status").and_then(Value::as_str) != Some("running") {
        return false;
    }
    if remaining_seconds(&current, now) > 0 {
        return false;
    }

    let started_at = current.get("startedAt").and_then(Value::as_u64).unwrap_or(0);
    let total_paused = current
        .get("totalPausedSeconds")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let duration_min = current
        .get("durationMinutes")
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let ended_at = started_at + total_paused + duration_min * 60;

    let mut completed = current.clone();
    completed["endedAt"] = json!(ended_at);
    completed["status"] = json!("completed");

    if let Some(arr) = state.get_mut("todayCompleted").and_then(|v| v.as_array_mut()) {
        arr.push(completed);
    }
    state["current"] = Value::Null;
    true
}

fn current_status(current: &Value) -> Value {
    let now = now_seconds();
    let mut result = current.clone();
    result["elapsedSeconds"] = json!(elapsed_seconds(current, now));
    result["remainingSeconds"] = json!(remaining_seconds(current, now));
    result
}

fn summary(state: &Value) -> Value {
    let current = state.get("current").filter(|v| v.is_object());
    let current_status = current.map(current_status);
    let today_completed = state
        .get("todayCompleted")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    let completed_count = today_completed
        .iter()
        .filter(|item| item.get("status").and_then(Value::as_str) == Some("completed"))
        .count();
    let today_date_val = state
        .get("todayDate")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    json!({
        "current": current_status,
        "todayCompleted": today_completed,
        "todayCompletedCount": completed_count,
        "todayDate": today_date_val,
        "serverTime": now_seconds()
    })
}

fn parse_duration(value: &Value) -> Result<u64, String> {
    let duration = match value {
        Value::Number(n) => n.as_u64().unwrap_or(25),
        Value::String(s) => s.parse::<u64>().unwrap_or(25),
        _ => 25,
    };
    if duration < 1 || duration > 180 {
        return Err("duration must be between 1 and 180 minutes".to_string());
    }
    Ok(duration)
}

pub(crate) fn handle_pomodoro(
    data_dir: &std::path::Path,
    action: &str,
    params: &Value,
) -> Result<Value, String> {
    let mut state = load_state(data_dir);
    let changed = complete_current_if_elapsed(&mut state, now_seconds());

    match action {
        "status" => {
            if changed {
                save_state(data_dir, &state)?;
            }
            Ok(summary(&state))
        }
        "history" => {
            if changed {
                save_state(data_dir, &state)?;
            }
            Ok(json!({
                "todayCompleted": state.get("todayCompleted").and_then(|v| v.as_array()).cloned().unwrap_or_default(),
                "todayDate": state.get("todayDate").and_then(|v| v.as_str()).unwrap_or("")
            }))
        }
        "start" => {
            if state.get("current").is_some() && !state["current"].is_null() {
                return Err("A pomodoro is already active".to_string());
            }
            let label = optional_text(params.get("label").unwrap_or(&Value::Null))
                .unwrap_or_default();
            let duration = parse_duration(params.get("duration").unwrap_or(&Value::Null))?;
            let now = now_seconds();
            state["current"] = json!({
                "id": create_id("pomo"),
                "label": label,
                "durationMinutes": duration,
                "startedAt": now,
                "pausedAt": null,
                "totalPausedSeconds": 0,
                "status": "running"
            });
            save_state(data_dir, &state)?;
            Ok(summary(&state))
        }
        "pause" => {
            let current = state.get("current").filter(|v| v.is_object());
            if current.is_none()
                || current.unwrap().get("status").and_then(Value::as_str) != Some("running")
            {
                return Err("No running pomodoro".to_string());
            }
            let mut current = current.unwrap().clone();
            current["pausedAt"] = json!(now_seconds());
            current["status"] = json!("paused");
            state["current"] = current;
            save_state(data_dir, &state)?;
            Ok(summary(&state))
        }
        "resume" => {
            let current = state.get("current").filter(|v| v.is_object());
            if current.is_none()
                || current.unwrap().get("status").and_then(Value::as_str) != Some("paused")
            {
                return Err("No paused pomodoro".to_string());
            }
            let mut current = current.unwrap().clone();
            let now = now_seconds();
            let paused_at = current
                .get("pausedAt")
                .and_then(Value::as_u64)
                .unwrap_or(now);
            let prev_paused = current
                .get("totalPausedSeconds")
                .and_then(Value::as_u64)
                .unwrap_or(0);
            current["totalPausedSeconds"] = json!(prev_paused + now.saturating_sub(paused_at));
            current["pausedAt"] = Value::Null;
            current["status"] = json!("running");
            state["current"] = current;
            save_state(data_dir, &state)?;
            Ok(summary(&state))
        }
        "stop" => {
            if state.get("current").is_none() || state["current"].is_null() {
                return Err("No active pomodoro".to_string());
            }
            let mut current = state["current"].clone();
            current["endedAt"] = json!(now_seconds());
            current["status"] = json!("stopped");
            if let Some(arr) = state
                .get_mut("todayCompleted")
                .and_then(|v| v.as_array_mut())
            {
                arr.push(current);
            }
            state["current"] = Value::Null;
            save_state(data_dir, &state)?;
            Ok(summary(&state))
        }
        _ => Err(format!("Unsupported pomodoro action: {action}")),
    }
}
