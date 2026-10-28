//! Local-only private builds may seed fresh installations. Never return keys to JS.
use std::collections::BTreeMap;

#[derive(serde::Deserialize)]
struct Preset {
    settings: serde_json::Value,
    credentials: BTreeMap<String, String>,
}
fn parse(raw: &str) -> Result<Option<Preset>, String> {
    if raw.trim() == "null" {
        return Ok(None);
    }
    if raw.len() > 512 * 1024 {
        return Err("体验配置无效。".into());
    }
    let preset: Preset = serde_json::from_str(raw).map_err(|_| "体验配置无效。")?;
    let profiles = preset
        .settings
        .get("profiles")
        .and_then(|v| v.as_array())
        .ok_or("体验配置无效。")?;
    if preset.credentials.len() > 30 {
        return Err("体验配置无效。".into());
    }
    for (id, secret) in &preset.credentials {
        if secret.trim().is_empty()
            || secret.len() > 8192
            || !profiles
                .iter()
                .any(|p| p.get("id").and_then(|v| v.as_str()) == Some(id))
        {
            return Err("体验配置无效。".into());
        }
    }
    Ok(Some(preset))
}
#[tauri::command]
pub async fn private_preset(
    window: tauri::WebviewWindow,
    install: bool,
) -> Result<Option<serde_json::Value>, String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    let Some(preset) = parse(include_str!(concat!(
        env!("OUT_DIR"),
        "/private-preset.json"
    )))?
    else {
        return Ok(None);
    };
    if install {
        for (id, secret) in preset.credentials {
            if !crate::credentials::credential_status(id.clone()).await? {
                crate::credentials::set_credential(id, secret).await?;
            }
        }
    }
    Ok(Some(preset.settings))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn public_build_is_empty_and_invalid_secret_errors_do_not_echo_values() {
        assert!(parse("null").unwrap().is_none());
        let error =
            parse(r#"{"settings":{"profiles":[]},"credentials":{"foreign":"secret-marker"}}"#)
                .err()
                .unwrap();
        assert!(!error.contains("secret-marker"));
        assert!(parse(r#"{"settings":{"profiles":[{"id":"tts-default"}]},"credentials":{"tts-default":"fixture"}}"#).unwrap().is_some());
    }
}
