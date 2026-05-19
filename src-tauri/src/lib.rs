mod ai;
mod pet;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            ai::load_ai_state,
            ai::save_ai_settings,
            ai::send_ai_chat_message,
            pet::load_pet,
            pet::load_spritesheet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
