use base64::Engine;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{path::PathBuf, process::Command};

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

    let sheet_path = folder_path.join(&meta.spritesheet_path);
    if !sheet_path.exists() {
        return Err(format!("Spritesheet not found: {}", sheet_path.display()));
    }
    meta.spritesheet_path = sheet_path.to_string_lossy().to_string();
    Ok(meta)
}

#[tauri::command]
pub fn update_pet_display_name(folder: String, display_name: String) -> Result<PetMeta, String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("桌宠名不能为空".to_string());
    }

    let folder_path = PathBuf::from(&folder);
    let json_path = folder_path.join("pet.json");
    let json_str =
        std::fs::read_to_string(&json_path).map_err(|e| format!("Cannot read pet.json: {}", e))?;
    let mut value: Value =
        serde_json::from_str(&json_str).map_err(|e| format!("Invalid pet.json: {}", e))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "Invalid pet.json: root must be an object".to_string())?;

    object.insert("displayName".to_string(), Value::String(name.to_string()));
    let raw = serde_json::to_string_pretty(&value).map_err(|e| e.to_string())?;
    std::fs::write(&json_path, format!("{raw}\n"))
        .map_err(|e| format!("Cannot write pet.json: {}", e))?;

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
