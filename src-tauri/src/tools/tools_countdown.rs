use serde_json::{json, Value};

use super::tools_storage::{
    create_id, now_seconds, optional_text, parse_date_string, read_json_file, require_text,
    resolve_data_file, today_date, update_by_id, write_json_file,
};

const FILE_NAME: &str = "countdown.json";

fn default_state() -> Value {
    json!({ "events": [] })
}

fn normalize_state(value: &Value) -> Value {
    let events = value
        .get("events")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    json!({ "events": events })
}

fn load_state(data_dir: &std::path::Path) -> Value {
    let path = resolve_data_file(data_dir, FILE_NAME);
    normalize_state(&read_json_file(&path, default_state()))
}

fn save_state(data_dir: &std::path::Path, state: &Value) -> Result<(), String> {
    write_json_file(&resolve_data_file(data_dir, FILE_NAME), state)
}

fn parse_local_date(date_str: &str) -> Option<(i64, u32, u32)> {
    let parts: Vec<&str> = date_str.split('-').collect();
    if parts.len() != 3 {
        return None;
    }
    let year: i64 = parts[0].parse().ok()?;
    let month: u32 = parts[1].parse().ok()?;
    let day: u32 = parts[2].parse().ok()?;
    Some((year, month, day))
}

fn days_between(from: &str, to_year: i64, to_month: u32, to_day: u32) -> i64 {
    let Some((fy, fm, fd)) = parse_local_date(from) else {
        return 0;
    };
    let from_ordinal = ymd_to_ordinal(fy, fm, fd);
    let to_ordinal = ymd_to_ordinal(to_year, to_month, to_day);
    to_ordinal - from_ordinal
}

fn ymd_to_ordinal(year: i64, month: u32, day: u32) -> i64 {
    let m = month as i64;
    let d = day as i64;
    let adj = if m <= 2 { 1 } else { 0 };
    let y = year - adj;
    let m_adj = m + 12 * adj - 3;
    d + (153 * m_adj + 2) / 5 + 365 * y + y / 4 - y / 100 + y / 400 - 719468
}

fn countdown_meta(event: &Value) -> Value {
    let today = today_date();
    let date = event
        .get("date")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let repeat = event.get("repeat").and_then(Value::as_str);

    let Some((target_year, target_month, target_day)) = parse_local_date(&date) else {
        let mut result = event.clone();
        result["nextDate"] = json!(date);
        result["daysRemaining"] = json!(0);
        return result;
    };

    let today_parts = parse_local_date(&today).unwrap_or((2025, 1, 1));
    let today_y = today_parts.0;

    let (actual_year, actual_month, actual_day) = if repeat == Some("yearly") {
        let mut y = today_y;
        let ordinal_target = ymd_to_ordinal(y, target_month, target_day);
        let ordinal_today = ymd_to_ordinal(y, today_parts.1, today_parts.2);
        if ordinal_target < ordinal_today {
            y += 1;
        }
        (y, target_month, target_day)
    } else {
        (target_year, target_month, target_day)
    };

    let days_remaining = days_between(&today, actual_year, actual_month, actual_day);
    let next_date = format!("{actual_year:04}-{actual_month:02}-{actual_day:02}");

    let mut result = event.clone();
    result["nextDate"] = json!(next_date);
    result["daysRemaining"] = json!(days_remaining);
    result
}

fn sort_events(events: &[Value]) -> Vec<Value> {
    let mut with_meta: Vec<Value> = events.iter().map(countdown_meta).collect();
    with_meta.sort_by(|a, b| {
        let days_a = a.get("daysRemaining").and_then(Value::as_i64).unwrap_or(0);
        let days_b = b.get("daysRemaining").and_then(Value::as_i64).unwrap_or(0);
        days_a.cmp(&days_b).then_with(|| {
            let name_a = a.get("name").and_then(Value::as_str).unwrap_or("");
            let name_b = b.get("name").and_then(Value::as_str).unwrap_or("");
            name_a.cmp(name_b)
        })
    });
    with_meta
}

fn normalize_repeat(value: &Value) -> Result<Option<String>, String> {
    match optional_text(value) {
        None => Ok(None),
        Some(s) if s == "yearly" => Ok(Some(s)),
        Some(_) => Err("repeat must be yearly".to_string()),
    }
}

pub(crate) fn handle_countdown(
    data_dir: &std::path::Path,
    action: &str,
    params: &Value,
) -> Result<Value, String> {
    let mut state = load_state(data_dir);

    match action {
        "list" => {
            let events = state
                .get("events")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            Ok(json!({ "events": sort_events(&events) }))
        }
        "add" => {
            let name = require_text(params.get("name").unwrap_or(&Value::Null), "name")?;
            let date = parse_date_string(
                &require_text(params.get("date").unwrap_or(&Value::Null), "date")?,
                "date",
            )?;
            let repeat = normalize_repeat(params.get("repeat").unwrap_or(&Value::Null))?;
            let event = json!({
                "id": create_id("cd"),
                "name": name,
                "date": date,
                "repeat": repeat,
                "createdAt": now_seconds()
            });
            if let Some(arr) = state
                .get_mut("events")
                .and_then(|v| v.as_array_mut())
            {
                arr.push(event.clone());
            }
            save_state(data_dir, &state)?;
            Ok(json!({ "event": countdown_meta(&event) }))
        }
        "update" => {
            let id = require_text(params.get("id").unwrap_or(&Value::Null), "id")?;
            let name = optional_text(params.get("name").unwrap_or(&Value::Null));
            let has_date = params.get("date").is_some();
            let has_repeat = params.get("repeat").is_some();
            let date_val = if has_date {
                Some(parse_date_string(
                    &require_text(params.get("date").unwrap_or(&Value::Null), "date")?,
                    "date",
                )?)
            } else {
                None
            };
            let repeat_val = if has_repeat {
                Some(normalize_repeat(
                    params.get("repeat").unwrap_or(&Value::Null),
                )?)
            } else {
                None
            };
            let events = state
                .get_mut("events")
                .and_then(|v| v.as_array_mut())
                .ok_or("Invalid state")?;
            let event = update_by_id(events, &id, |item| {
                let mut result = item.clone();
                if let Some(n) = &name {
                    result["name"] = json!(n);
                }
                if let Some(d) = &date_val {
                    result["date"] = json!(d);
                }
                if has_repeat {
                    result["repeat"] = match &repeat_val {
                        Some(r) => json!(r),
                        None => Value::Null,
                    };
                }
                result
            })?;
            save_state(data_dir, &state)?;
            Ok(json!({ "event": countdown_meta(&event) }))
        }
        "delete" => {
            let id = require_text(params.get("id").unwrap_or(&Value::Null), "id")?;
            let events = state
                .get_mut("events")
                .and_then(|v| v.as_array_mut())
                .ok_or("Invalid state")?;
            let before = events.len();
            events.retain(|item| item.get("id").and_then(Value::as_str) != Some(&id));
            if events.len() == before {
                return Err(format!("Item not found: {id}"));
            }
            save_state(data_dir, &state)?;
            Ok(json!({ "id": id }))
        }
        _ => Err(format!("Unsupported countdown action: {action}")),
    }
}
