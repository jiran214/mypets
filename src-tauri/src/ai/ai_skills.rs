use std::{fs, path::{Path, PathBuf}};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillInfo {
    pub name: String,
    pub description: String,
    pub scope: String,
    pub path: String,
}

pub(crate) fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

pub(crate) fn default_provider_id() -> String {
    "pi".to_string()
}

fn parse_skill_md(path: &Path) -> Option<SkillInfo> {
    let raw = fs::read_to_string(path).ok()?;
    let mut name = String::new();
    let mut description = String::new();
    let mut in_frontmatter = false;
    let mut past_first_dash = false;

    for line in raw.lines() {
        if line.trim() == "---" {
            if !past_first_dash {
                past_first_dash = true;
                in_frontmatter = true;
                continue;
            } else {
                break;
            }
        }

        if in_frontmatter {
            if let Some(val) = line.strip_prefix("name:") {
                name = val.trim().to_string();
            } else if let Some(val) = line.strip_prefix("description:") {
                description = val.trim().to_string();
            }
        }
    }

    if name.is_empty() {
        name = path
            .parent()
            .and_then(|p| p.file_name())
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();
    }

    Some(SkillInfo {
        name,
        description,
        scope: String::new(),
        path: path.to_string_lossy().to_string(),
    })
}

fn scan_skills_dir(dir: &Path, scope: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();
    if !dir.is_dir() {
        return skills;
    }

    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let skill_dir = entry.path();
            let skill_md = if skill_dir.is_dir() {
                skill_dir.join("SKILL.md")
            } else if skill_dir
                .extension()
                .and_then(|value| value.to_str())
                .is_some_and(|ext| ext.eq_ignore_ascii_case("md"))
            {
                skill_dir.clone()
            } else {
                continue;
            };
            if skill_md.exists() {
                if let Some(mut info) = parse_skill_md(&skill_md) {
                    info.scope = scope.to_string();
                    skills.push(info);
                }
            } else if skill_dir.is_dir() {
                skills.extend(scan_skills_dir(&skill_dir, scope));
            }
        }
    }

    skills.sort_by(|a, b| a.name.cmp(&b.name));
    skills
}

pub(crate) fn collect_all_skills(workspace_dir: &Path, _provider_id: &str) -> Vec<SkillInfo> {
    let mut skills = Vec::new();

    skills.extend(scan_skills_dir(
        &workspace_dir.join(".pi").join("skills"),
        "workspace",
    ));
    skills.extend(scan_skills_dir(
        &workspace_dir.join(".agents").join("skills"),
        "workspace",
    ));

    if let Some(home) = home_dir() {
        skills.extend(scan_skills_dir(&home.join(".wimipet").join("skills"), "builtin"));
        skills.extend(scan_skills_dir(
            &home.join(".pi").join("agent").join("skills"),
            "global",
        ));
        skills.extend(scan_skills_dir(
            &home.join(".agents").join("skills"),
            "global",
        ));
    }

    skills
}
