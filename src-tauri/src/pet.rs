use base64::Engine;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

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
    let json_str = std::fs::read_to_string(&json_path)
        .map_err(|e| format!("Cannot read pet.json: {}", e))?;
    let mut meta: PetMeta = serde_json::from_str(&json_str)
        .map_err(|e| format!("Invalid pet.json: {}", e))?;

    let sheet_path = folder_path.join(&meta.spritesheet_path);
    if !sheet_path.exists() {
        return Err(format!("Spritesheet not found: {}", sheet_path.display()));
    }
    meta.spritesheet_path = sheet_path.to_string_lossy().to_string();
    Ok(meta)
}

#[tauri::command]
pub fn load_spritesheet(path: String) -> Result<String, String> {
    let data = std::fs::read(&path)
        .map_err(|e| format!("Cannot read spritesheet: {}", e))?;
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
