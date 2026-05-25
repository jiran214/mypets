use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Command};

use crate::ai::AiSettings;

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PetMeta {
    pub id: String,
    pub display_name: String,
    pub description: String,
    pub spritesheet_path: String,
    #[serde(default)]
    pub kind: Option<String>,
}

#[tauri::command]
pub fn load_pet(folder: String) -> Result<PetMeta, String> {
    let folder_path = PathBuf::from(&folder);
    let json_path = folder_path.join("pet.json");
    let json_str =
        std::fs::read_to_string(&json_path).map_err(|e| format!("Cannot read pet.json: {}", e))?;
    let mut meta: PetMeta =
        serde_json::from_str(&json_str).map_err(|e| format!("Invalid pet.json: {}", e))?;

    // Merge displayName from .wimipet/settings.json
    let settings_path = folder_path.join(".wimipet").join("settings.json");
    if settings_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<AiSettings>(&raw) {
                if !settings.display_name.trim().is_empty() {
                    meta.display_name = settings.display_name;
                }
            }
        }
    }

    let sheet_path = folder_path.join(&meta.spritesheet_path);
    if !sheet_path.exists() {
        return Err(format!("Spritesheet not found: {}", sheet_path.display()));
    }
    meta.spritesheet_path = sheet_path.to_string_lossy().to_string();
    Ok(meta)
}

#[tauri::command]
pub fn load_spritesheet(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Cannot read spritesheet: {}", e))?;
    let mime = image_mime_type(&path, &data);
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:{};base64,{}", mime, b64))
}

fn image_mime_type(path: &str, data: &[u8]) -> &'static str {
    if data.starts_with(b"\x89PNG\r\n\x1a\n") {
        return "image/png";
    }
    if data.starts_with(b"\xff\xd8\xff") {
        return "image/jpeg";
    }
    if data.len() >= 12 && &data[0..4] == b"RIFF" && &data[8..12] == b"WEBP" {
        return "image/webp";
    }
    if data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a") {
        return "image/gif";
    }
    if data.starts_with(b"BM") {
        return "image/bmp";
    }

    match PathBuf::from(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("gif") => "image/gif",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        _ => "image/png",
    }
}

#[tauri::command]
pub fn delete_pet_workspace(folder: String) -> Result<(), String> {
    if folder.trim().is_empty() {
        return Err("Workspace folder is required".to_string());
    }

    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(format!(
            "Workspace folder not found: {}",
            folder_path.display()
        ));
    }

    let folder_path = std::fs::canonicalize(&folder_path).unwrap_or(folder_path);
    let json_path = folder_path.join("pet.json");
    if !json_path.is_file() {
        return Err(format!("pet.json not found: {}", json_path.display()));
    }

    trash::delete(&folder_path).map_err(|e| format!("Cannot move workspace to recycle bin: {}", e))
}

#[tauri::command]
pub fn open_workspace_in_file_manager(folder: String) -> Result<(), String> {
    if folder.trim().is_empty() {
        return Err("Workspace folder is required".to_string());
    }

    let folder_path = PathBuf::from(&folder);
    if !folder_path.is_dir() {
        return Err(format!(
            "Workspace folder not found: {}",
            folder_path.display()
        ));
    }

    let folder_path = std::fs::canonicalize(&folder_path).unwrap_or(folder_path);

    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(&folder_path).spawn();

    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(&folder_path).spawn();

    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(&folder_path).spawn();

    result
        .map(|_| ())
        .map_err(|e| format!("Cannot open workspace folder: {}", e))
}
