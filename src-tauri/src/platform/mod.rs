#[cfg(not(target_os = "macos"))]
use cpal::traits::DeviceTrait;
use cpal::traits::HostTrait;
use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;

#[derive(Serialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}

pub(crate) const SYSTEM_DEFAULT_OUTPUT: &str = "__system_default__";

pub(crate) fn output_id(device: &cpal::Device) -> Result<String, String> {
    #[cfg(target_os = "macos")]
    {
        macos::output_id(device)
    }
    #[cfg(not(target_os = "macos"))]
    {
        device
            .description()
            .map(|description| description.name().to_string())
            .map_err(|_| "无法读取设备名称。".into())
    }
}

#[cfg(not(target_os = "macos"))]
fn output_entries() -> Result<Vec<(cpal::Device, OutputDevice)>, String> {
    cpal::default_host()
        .output_devices()
        .map_err(|_| "无法枚举输出设备。".to_string())?
        .map(|device| {
            let name = device
                .description()
                .map_err(|_| "无法读取设备名称。".to_string())?
                .name()
                .to_string();
            let id = output_id(&device)?;
            Ok((device, OutputDevice { id, name }))
        })
        .collect()
}

pub fn list_outputs() -> Result<Vec<OutputDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        macos::list_outputs()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok(output_entries()?
            .into_iter()
            .map(|(_, description)| description)
            .collect())
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn list_inputs() -> Result<Vec<OutputDevice>, String> {
    macos::list_inputs()
}

fn select_unique<T>(entries: impl Iterator<Item = (T, String)>, id: &str) -> Result<T, String> {
    if id.is_empty() {
        return Err("请先选择输出设备。".into());
    }
    let mut matches = entries.filter(|(_, candidate)| candidate == id);
    let (device, _) = matches.next().ok_or("输出设备已断开，请刷新并重新选择。")?;
    if matches.next().is_some() {
        return Err("输出设备标识存在歧义，请重新选择设备。".into());
    }
    Ok(device)
}

pub fn resolve_output(id: &str) -> Result<cpal::Device, String> {
    if id == SYSTEM_DEFAULT_OUTPUT {
        return cpal::default_host()
            .default_output_device()
            .ok_or_else(|| "系统当前没有默认输出设备，请连接耳机或扬声器。".into());
    }
    #[cfg(target_os = "macos")]
    {
        macos::validate_output_id(id)?;
        select_unique(
            cpal::default_host()
                .devices()
                .map_err(|_| "无法枚举输出设备。".to_string())?
                .filter_map(|device| output_id(&device).ok().map(|id| (device, id))),
            id,
        )
    }
    #[cfg(not(target_os = "macos"))]
    {
        select_unique(
            output_entries()?
                .into_iter()
                .map(|(device, description)| (device, description.id)),
            id,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selection_is_exact_and_never_falls_back() {
        let entries = || vec![(1, "uid-a".into()), (2, "uid-b".into())].into_iter();
        assert_eq!(select_unique(entries(), "uid-b").unwrap(), 2);
        assert!(select_unique(entries(), "missing").is_err());
        assert!(select_unique(entries(), "").is_err());
        assert!(select_unique(std::iter::empty::<(u8, String)>(), "uid-a").is_err());
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "manual read-only macOS output inventory; does not open streams"]
    fn macos_output_inventory_has_stable_resolvable_ids() {
        let first = list_outputs().unwrap();
        assert!(
            !first.is_empty(),
            "connect an output device before validation"
        );
        let mut ids = std::collections::HashSet::new();
        for device in &first {
            assert!(device.id.starts_with("macos-output:"));
            assert!(ids.insert(device.id.clone()), "duplicate native UID");
            let resolved = resolve_output(&device.id).unwrap();
            assert_eq!(output_id(&resolved).unwrap(), device.id);
        }
        let default = resolve_output(SYSTEM_DEFAULT_OUTPUT).unwrap();
        assert_eq!(
            output_id(&default).unwrap(),
            output_id(&cpal::default_host().default_output_device().unwrap()).unwrap()
        );
        let second = list_outputs().unwrap();
        assert_eq!(
            ids,
            second.into_iter().map(|device| device.id).collect(),
            "device inventory changed during validation"
        );
        assert!(resolve_output("macos-output:646973636f6e6e65637465642d74657374").is_err());
        println!(
            "Validated {} stable output identifiers without opening audio streams.",
            first.len()
        );
    }

    #[test]
    fn duplicate_identifiers_are_rejected_instead_of_selecting_first() {
        let entries = vec![(1, "same".into()), (2, "same".into())];
        assert!(select_unique(entries.into_iter(), "same").is_err());
    }
}

async fn wait_until_available<F: std::future::Future<Output = Result<bool, String>>>(
    stop: &tokio_util::sync::CancellationToken,
    mut check: impl FnMut() -> F,
    mut waiting: impl FnMut(),
) -> Result<(), String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(20);
    let mut notified = false;
    loop {
        let available = tokio::select! { biased;
            _ = stop.cancelled() => return Err("语音已停止。".into()),
            result = check() => result?,
            _ = tokio::time::sleep_until(deadline) => return Err("等待输出设备恢复超时，请重新连接后发送。".into()),
        };
        if available {
            return Ok(());
        }
        if !notified {
            waiting();
            notified = true;
        }
        tokio::select! { biased;
            _ = stop.cancelled() => return Err("语音已停止。".into()),
            _ = tokio::time::sleep_until(deadline) => return Err("等待输出设备恢复超时，请重新连接后发送。".into()),
            _ = tokio::time::sleep(std::time::Duration::from_millis(500)) => {},
        }
    }
}

pub(crate) async fn wait_for_output(
    id: &str,
    stop: &tokio_util::sync::CancellationToken,
    waiting: impl FnMut(),
) -> Result<(), String> {
    if id == SYSTEM_DEFAULT_OUTPUT {
        return wait_until_available(
            stop,
            || async { Ok(cpal::default_host().default_output_device().is_some()) },
            waiting,
        )
        .await;
    }
    #[cfg(target_os = "macos")]
    macos::validate_output_id(id)?;
    wait_until_available(
        stop,
        || {
            let id = id.to_owned();
            async move {
                tauri::async_runtime::spawn_blocking(move || {
                    let matches = list_outputs()?
                        .into_iter()
                        .filter(|device| device.id == id)
                        .count();
                    match matches {
                        0 => Ok(false),
                        1 => Ok(true),
                        _ => Err("输出设备标识存在歧义，请重新选择设备。".into()),
                    }
                })
                .await
                .map_err(|_| "读取输出设备失败。".to_string())?
            }
        },
        waiting,
    )
    .await
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    use tokio_util::sync::CancellationToken;
    #[tokio::test(start_paused = true)]
    async fn waits_for_same_device_and_stops_or_times_out_without_fallback() {
        let token = CancellationToken::new();
        let mut polls = 0;
        let mut notices = 0;
        wait_until_available(
            &token,
            || {
                polls += 1;
                let ready = polls == 3;
                async move { Ok(ready) }
            },
            || notices += 1,
        )
        .await
        .unwrap();
        assert_eq!(polls, 3);
        assert_eq!(notices, 1);
        let error = wait_until_available(&token, || async { Ok(false) }, || {})
            .await
            .unwrap_err();
        assert!(error.contains("超时"));
        let mut polls = 0;
        wait_until_available(
            &token,
            || {
                polls += 1;
                async { Ok(false) }
            },
            || token.cancel(),
        )
        .await
        .unwrap_err();
        assert_eq!(polls, 1);
    }
}

#[tauri::command]
pub fn open_virtual_mic_installer(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    #[cfg(target_os = "macos")]
    {
        use tauri::Manager;
        let packaged = window
            .app_handle()
            .path()
            .resource_dir()
            .map_err(|_| "无法定位安装包。")?
            .join("VoxBridgeAudio.pkg");
        #[cfg(debug_assertions)]
        let packaged = if packaged.is_file() {
            packaged
        } else {
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../native/macos/.build/VoxBridgeAudio.pkg")
        };
        if !packaged.is_file() {
            return Err("虚拟麦克风安装包缺失，请重新打包应用。".into());
        }
        objc2::rc::autoreleasepool(|_| {
            let path = objc2_foundation::NSString::from_str(&packaged.to_string_lossy());
            let url = objc2_foundation::NSURL::fileURLWithPath(&path);
            if objc2_app_kit::NSWorkspace::sharedWorkspace().openURL(&url) {
                Ok(())
            } else {
                Err("无法打开系统安装器。".into())
            }
        })
    }
    #[cfg(not(target_os = "macos"))]
    Err("虚拟麦克风安装目前仅支持 Mac。".into())
}
