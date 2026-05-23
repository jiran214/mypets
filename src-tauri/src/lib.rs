mod ai;
mod pet;

use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

const MAIN_WINDOW_LABEL: &str = "main";
const PET_WINDOW_PREFIX: &str = "pet-";
const TRAY_SHOW_MAIN_ID: &str = "tray-show-main";
const TRAY_QUIT_ID: &str = "tray-quit-app";

fn show_main_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn close_pet_windows<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    for (label, window) in app.webview_windows() {
        if label.starts_with(PET_WINDOW_PREFIX) {
            let _ = window.destroy();
        }
    }
}

fn setup_tray(app: &mut tauri::App) -> tauri::Result<()> {
    let tray_menu = MenuBuilder::new(app)
        .text(TRAY_SHOW_MAIN_ID, "打开主窗口")
        .separator()
        .text(TRAY_QUIT_ID, "退出")
        .build()?;

    let mut tray = TrayIconBuilder::with_id("mypets-main-tray")
        .menu(&tray_menu)
        .tooltip("Mypets")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_SHOW_MAIN_ID => show_main_window(app),
            TRAY_QUIT_ID => {
                close_pet_windows(app);
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            }
            | TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_main_window(tray.app_handle()),
            _ => {}
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        tray = tray.icon(icon);
    }

    tray.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            setup_tray(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != MAIN_WINDOW_LABEL {
                return;
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            ai::load_ai_state,
            ai::list_ai_sessions,
            ai::save_ai_settings,
            ai::list_skills,
            ai::save_dropped_chat_file,
            ai::send_ai_chat_message,
            pet::delete_pet_workspace,
            pet::load_pet,
            pet::load_spritesheet,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
