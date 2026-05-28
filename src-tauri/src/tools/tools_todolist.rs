use serde_json::{json, Value};

use super::tools_storage::{
    create_id, now_seconds, optional_text, parse_date_string, read_json_file, require_text,
    resolve_data_file, update_by_id, write_json_file,
};

const FILE_NAME: &str = "todolist.json";

fn default_state() -> Value {
    json!({ "todos": [] })
}

fn normalize_state(value: &Value) -> Value {
    let todos = value
        .get("todos")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    json!({ "todos": todos })
}

fn load_state(data_dir: &std::path::Path) -> Value {
    let path = resolve_data_file(data_dir, FILE_NAME);
    normalize_state(&read_json_file(&path, default_state()))
}

fn save_state(data_dir: &std::path::Path, state: &Value) -> Result<(), String> {
    write_json_file(&resolve_data_file(data_dir, FILE_NAME), state)
}

fn sort_todos(todos: &[Value]) -> Vec<Value> {
    let mut sorted: Vec<Value> = todos.to_vec();
    sorted.sort_by(|a, b| {
        let a_completed = a.get("completed").and_then(Value::as_bool).unwrap_or(false);
        let b_completed = b.get("completed").and_then(Value::as_bool).unwrap_or(false);
        if a_completed != b_completed {
            return a_completed.cmp(&b_completed);
        }
        let due_a = a
            .get("dueDate")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("9999-99-99");
        let due_b = b
            .get("dueDate")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .unwrap_or("9999-99-99");
        let due_cmp = due_a.cmp(due_b);
        if due_cmp != std::cmp::Ordering::Equal {
            return due_cmp;
        }
        let a_created = a.get("createdAt").and_then(Value::as_u64).unwrap_or(0);
        let b_created = b.get("createdAt").and_then(Value::as_u64).unwrap_or(0);
        b_created.cmp(&a_created)
    });
    sorted
}

fn filter_todos(todos: &[Value], status: &str) -> Vec<Value> {
    match status {
        "pending" => todos
            .iter()
            .filter(|t| !t.get("completed").and_then(Value::as_bool).unwrap_or(false))
            .cloned()
            .collect(),
        "done" => todos
            .iter()
            .filter(|t| t.get("completed").and_then(Value::as_bool).unwrap_or(false))
            .cloned()
            .collect(),
        _ => todos.to_vec(),
    }
}

pub(crate) fn handle_todolist(
    data_dir: &std::path::Path,
    action: &str,
    params: &Value,
) -> Result<Value, String> {
    let mut state = load_state(data_dir);

    match action {
        "list" => {
            let status = optional_text(params.get("status").unwrap_or(&Value::Null))
                .unwrap_or_else(|| "all".to_string());
            if !["pending", "done", "all"].contains(&status.as_str()) {
                return Err("status must be pending, done, or all".to_string());
            }
            let todos = state
                .get("todos")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let filtered = filter_todos(&todos, &status);
            let sorted = sort_todos(&filtered);
            Ok(json!({ "todos": sorted, "status": status }))
        }
        "add" => {
            let text = require_text(params.get("text").unwrap_or(&Value::Null), "text")?;
            let due_date_raw = optional_text(params.get("dueDate").unwrap_or(&Value::Null));
            let due_date = match due_date_raw {
                Some(d) => Some(parse_date_string(&d, "dueDate")?),
                None => None,
            };
            let todo = json!({
                "id": create_id("todo"),
                "text": text,
                "completed": false,
                "createdAt": now_seconds(),
                "completedAt": null,
                "dueDate": due_date
            });
            if let Some(arr) = state.get_mut("todos").and_then(|v| v.as_array_mut()) {
                arr.push(todo.clone());
            }
            save_state(data_dir, &state)?;
            Ok(json!({ "todo": todo }))
        }
        "complete" | "uncomplete" => {
            let id = require_text(params.get("id").unwrap_or(&Value::Null), "id")?;
            let completed = action == "complete";
            let todos = state
                .get_mut("todos")
                .and_then(|v| v.as_array_mut())
                .ok_or("Invalid state")?;
            let todo = update_by_id(todos, &id, |item| {
                let mut result = item.clone();
                result["completed"] = json!(completed);
                result["completedAt"] = if completed {
                    json!(now_seconds())
                } else {
                    Value::Null
                };
                result
            })?;
            save_state(data_dir, &state)?;
            Ok(json!({ "todo": todo }))
        }
        "delete" => {
            let id = require_text(params.get("id").unwrap_or(&Value::Null), "id")?;
            let todos = state
                .get_mut("todos")
                .and_then(|v| v.as_array_mut())
                .ok_or("Invalid state")?;
            let before = todos.len();
            todos.retain(|item| item.get("id").and_then(Value::as_str) != Some(&id));
            if todos.len() == before {
                return Err(format!("Item not found: {id}"));
            }
            save_state(data_dir, &state)?;
            Ok(json!({ "id": id }))
        }
        "update" => {
            let id = require_text(params.get("id").unwrap_or(&Value::Null), "id")?;
            let text = optional_text(params.get("text").unwrap_or(&Value::Null));
            let has_due_date = params.get("dueDate").is_some();
            let due_date_val = if has_due_date {
                optional_text(params.get("dueDate").unwrap_or(&Value::Null))
                    .map(|d| parse_date_string(&d, "dueDate"))
                    .transpose()?
            } else {
                None
            };
            let todos = state
                .get_mut("todos")
                .and_then(|v| v.as_array_mut())
                .ok_or("Invalid state")?;
            let todo = update_by_id(todos, &id, |item| {
                let mut result = item.clone();
                if let Some(t) = &text {
                    result["text"] = json!(t);
                }
                if has_due_date {
                    result["dueDate"] = match &due_date_val {
                        Some(d) => json!(d),
                        None => Value::Null,
                    };
                }
                result
            })?;
            save_state(data_dir, &state)?;
            Ok(json!({ "todo": todo }))
        }
        _ => Err(format!("Unsupported todolist action: {action}")),
    }
}
