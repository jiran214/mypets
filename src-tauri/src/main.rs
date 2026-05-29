#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// 提取子命令前面的 --flag value 参数（如 --workspace <path>）
fn find_pre_args(args: &[String], subcommand_idx: usize) -> Vec<String> {
    let mut result = Vec::new();
    let mut i = 1; // skip argv[0]
    while i < subcommand_idx {
        result.push(args[i].clone());
        // 如果是 --flag 且下一个不是另一个 --flag，也带上它的值
        if args[i].starts_with("--") && i + 1 < subcommand_idx && !args[i + 1].starts_with("--") {
            i += 2;
        } else {
            i += 1;
        }
    }
    result
}

/// 找到子命令在 args 中的位置，跳过前面的 --flag value 对
fn find_subcommand(args: &[String], name: &str) -> Option<usize> {
    let mut i = 1; // skip argv[0]
    while i < args.len() {
        if args[i] == name {
            return Some(i);
        }
        // 如果是 --flag，跳过它的值
        if args[i].starts_with("--") && i + 1 < args.len() && !args[i + 1].starts_with("--") {
            i += 2;
        } else {
            i += 1;
        }
    }
    None
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(tools_idx) = find_subcommand(&args, "tools") {
        // 把 tools 前面的 --workspace 等参数也传给 CLI
        let pre_args = find_pre_args(&args, tools_idx);
        let mut cli_args = pre_args;
        cli_args.extend_from_slice(&args[tools_idx + 1..]);
        std::process::exit(wimipet_lib::tools::run_cli_with_args(&cli_args));
    }

    // 设置 panic hook 确保即使 panic 也能清理子进程
    let original_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        wimipet_lib::terminate_all_ai_processes();
        original_hook(info);
    }));

    wimipet_lib::run();
}
