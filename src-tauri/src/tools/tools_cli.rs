use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::tools_countdown::handle_countdown;
use super::tools_pomodoro::handle_pomodoro;
use super::tools_todolist::handle_todolist;

fn resolve_data_dir(workspace: &str) -> PathBuf {
    let ws = PathBuf::from(workspace);
    ws.join(".wimipet").join("tools")
}

fn parse_cli_params(args: &[String]) -> Map<String, Value> {
    let mut params = Map::new();
    let mut i = 0;
    while i < args.len() {
        let arg = &args[i];
        if let Some(key) = arg.strip_prefix("--") {
            let next = args.get(i + 1);
            if next.is_some() && !next.unwrap().starts_with("--") {
                params.insert(key.to_string(), json!(next.unwrap()));
                i += 2;
            } else {
                params.insert(key.to_string(), json!(true));
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    params
}

fn print_usage() {
    eprintln!("Usage: wimipet tools [--workspace <path>] <command> <action> [--key value ...]");
    eprintln!();
    eprintln!("Commands:");
    eprintln!("  pomodoro   status | start | pause | resume | stop | history");
    eprintln!("  todolist   list | add | complete | uncomplete | update | delete");
    eprintln!("  countdown  list | add | update | delete");
    eprintln!();
    eprintln!("Options:");
    eprintln!("  --workspace <path>  Pet workspace folder (default: current directory)");
}

pub fn run_cli_with_args(args: &[String]) -> i32 {
    if args.is_empty() || args.iter().any(|a| a == "--help" || a == "-h") {
        print_usage();
        return 0;
    }

    let (workspace, rest) = if args.first().map(|s| s.as_str()) == Some("--workspace") {
        if args.len() < 3 {
            eprintln!("Error: --workspace requires a value");
            return 1;
        }
        (args[1].clone(), args[2..].to_vec())
    } else {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        (cwd, args.to_vec())
    };

    if rest.len() < 2 {
        eprintln!("Error: requires <command> <action>");
        print_usage();
        return 1;
    }

    let command = rest[0].clone();
    let action = rest[1].clone();
    let params = parse_cli_params(&rest[2..]);
    let params_value = Value::Object(params);

    let data_dir = resolve_data_dir(&workspace);
    if let Err(err) = std::fs::create_dir_all(&data_dir) {
        eprintln!("Error: Cannot create data directory: {err}");
        return 1;
    }

    let result = match command.as_str() {
        "pomodoro" => handle_pomodoro(&data_dir, &action, &params_value),
        "todolist" => handle_todolist(&data_dir, &action, &params_value),
        "countdown" => handle_countdown(&data_dir, &action, &params_value),
        _ => Err(format!("Unknown command: {command}")),
    };

    match result {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            0
        }
        Err(err) => {
            eprintln!("Error: {err}");
            1
        }
    }
}
