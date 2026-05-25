use base64::Engine;
use serde::{Deserialize, Serialize};
use std::{path::PathBuf, process::Command};

use crate::ai::{AiSettings, PetOverrides};

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

    // Merge overrides from .wimipet/settings.json
    let settings_path = folder_path.join(".wimipet").join("settings.json");
    if settings_path.exists() {
        if let Ok(raw) = std::fs::read_to_string(&settings_path) {
            if let Ok(settings) = serde_json::from_str::<AiSettings>(&raw) {
                if let Some(name) = settings.pet_overrides.display_name {
                    if !name.trim().is_empty() {
                        meta.display_name = name;
                    }
                }
                if let Some(desc) = settings.pet_overrides.description {
                    meta.description = desc;
                }
                if let Some(sheet) = settings.pet_overrides.spritesheet_path {
                    if !sheet.trim().is_empty() {
                        meta.spritesheet_path = sheet;
                    }
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
pub fn update_pet_overrides(
    folder: String,
    display_name: Option<String>,
    description: Option<String>,
    spritesheet_path: Option<String>,
) -> Result<PetMeta, String> {
    if let Some(ref name) = display_name {
        if name.trim().is_empty() {
            return Err("桌宠名不能为空".to_string());
        }
    }

    let folder_path = PathBuf::from(&folder);
    let wimipet_dir = folder_path.join(".wimipet");
    std::fs::create_dir_all(&wimipet_dir)
        .map_err(|e| format!("Cannot create .wimipet dir: {}", e))?;
    let settings_path = wimipet_dir.join("settings.json");

    let mut settings: AiSettings = if settings_path.exists() {
        let raw = std::fs::read_to_string(&settings_path)
            .map_err(|e| format!("Cannot read settings: {}", e))?;
        serde_json::from_str(&raw).map_err(|e| format!("Invalid settings: {}", e))?
    } else {
        AiSettings::default()
    };

    settings.pet_overrides = PetOverrides {
        display_name,
        description,
        spritesheet_path,
    };

    let raw = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    std::fs::write(&settings_path, format!("{raw}\n"))
        .map_err(|e| format!("Cannot write settings: {}", e))?;

    load_pet(folder)
}

#[tauri::command]
pub fn load_spritesheet(path: String) -> Result<String, String> {
    let data = std::fs::read(&path).map_err(|e| format!("Cannot read spritesheet: {}", e))?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&data);
    Ok(format!("data:image/png;base64,{}", b64))
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
