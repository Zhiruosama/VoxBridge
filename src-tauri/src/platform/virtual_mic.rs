use super::OutputDevice;
use serde::Serialize;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VirtualMicStatus {
    provider: &'static str,
    output: Option<OutputDevice>,
    input_name: Option<String>,
    partial: bool,
}

#[tauri::command]
pub async fn virtual_mic_status() -> Result<VirtualMicStatus, String> {
    let status = tauri::async_runtime::spawn_blocking(status)
        .await
        .map_err(|_| "无法检测虚拟麦克风。".to_string())??;
    crate::diagnostics::record(crate::diagnostics::DiagnosticEvent {
        operation: "virtual_mic_status".into(),
        kind: "state".into(),
        phase: Some(
            if status.output.is_some() && status.input_name.is_some() && !status.partial {
                "ready"
            } else {
                "waitingDevice"
            }
            .into(),
        ),
        count: Some(u32::from(status.output.is_some()) + u32::from(status.input_name.is_some())),
        failed_count: Some(u32::from(status.partial)),
        ..Default::default()
    });
    Ok(status)
}

fn status() -> Result<VirtualMicStatus, String> {
    #[cfg(target_os = "windows")]
    {
        use cpal::traits::{DeviceTrait, HostTrait};
        let outputs: Vec<_> = super::list_outputs()?
            .into_iter()
            .filter(|d| is_cable_endpoint(&d.name, "input"))
            .collect();
        let inputs: Vec<_> = cpal::default_host()
            .input_devices()
            .map_err(|_| "无法枚举虚拟麦克风输入。")?
            .filter_map(|d| d.description().ok())
            .map(|d| super::device_name(&d))
            .filter(|name| is_cable_endpoint(name, "output"))
            .collect();
        if outputs.len() > 1 || inputs.len() > 1 {
            return Err("检测到多个 VB-CABLE 端点，请在 Windows 声音设置中检查重复设备。".into());
        }
        let partial = outputs.is_empty() != inputs.is_empty();
        Ok(VirtualMicStatus {
            provider: "vb-cable",
            output: outputs.into_iter().next(),
            input_name: inputs.into_iter().next(),
            partial,
        })
    }
    #[cfg(target_os = "macos")]
    {
        let output = super::list_outputs()?
            .into_iter()
            .find(|d| d.id == "macos-output:636f6d2e766f786272696467652e617564696f2e646576696365");
        Ok(VirtualMicStatus {
            provider: "voxbridge",
            input_name: output.as_ref().map(|_| "VoxBridge".into()),
            output,
            partial: false,
        })
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    Ok(VirtualMicStatus {
        provider: "unsupported",
        output: None,
        input_name: None,
        partial: false,
    })
}

fn ready_output(status: VirtualMicStatus) -> Result<String, String> {
    if status.partial || status.input_name.is_none() {
        return Err("虚拟麦克风未就绪，请安装驱动、按提示重启电脑后刷新设备。".into());
    }
    status
        .output
        .map(|output| output.id)
        .ok_or_else(|| "虚拟麦克风未就绪，请安装驱动、按提示重启电脑后刷新设备。".into())
}

pub(super) fn ready_output_id() -> Result<String, String> {
    ready_output(status()?)
}

#[cfg(test)]
mod readiness_tests {
    use super::*;
    #[test]
    fn automatic_send_requires_both_virtual_ends_and_never_falls_back() {
        for (output, input, partial, ready) in [
            (false, false, false, false),
            (true, false, true, false),
            (false, true, true, false),
            (true, true, true, false),
            (true, true, false, true),
        ] {
            let result = ready_output(VirtualMicStatus {
                provider: "fixture",
                output: output.then(|| OutputDevice {
                    id: "virtual-id".into(),
                    name: "Cable".into(),
                }),
                input_name: input.then(|| "Virtual input".into()),
                partial,
            });
            if ready {
                assert_eq!(result.unwrap(), "virtual-id");
            } else {
                assert!(result.unwrap_err().contains("虚拟麦克风未就绪"));
            }
        }
    }
}

#[cfg(target_os = "windows")]
pub(crate) fn is_cable_endpoint(name: &str, direction: &str) -> bool {
    let name = name.to_ascii_lowercase();
    // Only the base cable. A+B/C+D and other virtual devices are different products.
    // The caller enumerates playback/capture separately, so both ends may share
    // the user's VoxBridge alias without confusing their audio direction.
    (name.starts_with(&format!("cable {direction} (")) || name.starts_with("voxbridge ("))
        && name.ends_with("(vb-audio virtual cable)")
}

#[cfg(target_os = "windows")]
fn shell_open(
    verb: &str,
    target: &std::path::Path,
    directory: Option<&std::path::Path>,
) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows::{
        core::PCWSTR,
        Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL},
    };
    let wide = |value: &std::ffi::OsStr| value.encode_wide().chain(Some(0)).collect::<Vec<_>>();
    let verb = wide(std::ffi::OsStr::new(verb));
    let target = wide(target.as_os_str());
    let directory = directory.map(|d| wide(d.as_os_str()));
    let result = unsafe {
        ShellExecuteW(
            None,
            PCWSTR(verb.as_ptr()),
            PCWSTR(target.as_ptr()),
            PCWSTR::null(),
            directory
                .as_ref()
                .map_or(PCWSTR::null(), |d| PCWSTR(d.as_ptr())),
            SW_SHOWNORMAL,
        )
    };
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err("未能打开安装器或网页；如已取消权限请求，可稍后重试。".into())
    }
}

#[cfg(target_os = "windows")]
pub(super) fn open_installer(window: &tauri::WebviewWindow) -> Result<(), String> {
    use tauri::Manager;
    let directory = window
        .app_handle()
        .path()
        .resource_dir()
        .map_err(|_| "无法定位虚拟麦克风安装包。")?
        .join("virtual-microphone/vb-cable");
    #[cfg(debug_assertions)]
    let directory = if directory.join("VBCABLE_Setup_x64.exe").is_file() {
        directory
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../native/windows/.build/VBCABLE_Driver_Pack45")
    };
    verify_package(&directory)?;
    // Keep the complete original vendor package beside the elevated installer.
    let directory = directory.canonicalize().map_err(|_| "无法定位安装目录。")?;
    // All entry points use the same non-elevated wrapper. It snapshots the
    // caller's defaults, elevates only vendor setup, and restores any displaced
    // defaults. Launching the EXE directly bypasses that protection.
    let helper = directory
        .parent()
        .ok_or("无法定位驱动管理器。")?
        .join("Manage-Virtual-Microphone.ps1");
    #[cfg(debug_assertions)]
    let helper = if helper.is_file() {
        helper
    } else {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../native/windows/Manage-Virtual-Microphone.ps1")
    };
    if !helper.is_file() || !helper.with_file_name("Audio-Defaults.cs").is_file() {
        return Err("虚拟麦克风管理器缺失，请重新安装 VoxBridge。".into());
    }
    use std::os::windows::process::CommandExt;
    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-WindowStyle",
            "Hidden",
            "-File",
        ])
        .arg(helper.to_string_lossy().trim_start_matches(r"\\?\"))
        .arg("-PackageDirectory")
        .arg(directory.to_string_lossy().trim_start_matches(r"\\?\"))
        .creation_flags(0x08000000)
        .spawn()
        .map(|_| ())
        .map_err(|_| "未能打开驱动管理器，请稍后重试。".into())
}

#[cfg(target_os = "windows")]
fn verify_package(directory: &std::path::Path) -> Result<(), String> {
    let manifest: std::collections::BTreeMap<String, String> = serde_json::from_str(include_str!(
        "../../../native/windows/vb-cable-manifest.json"
    ))
    .map_err(|_| "安装包校验信息无效。")?;
    for (name, expected) in manifest {
        let data = std::fs::read(directory.join(name))
            .map_err(|_| "虚拟麦克风安装包缺失，请重新安装 VoxBridge。")?;
        if hex::encode(ring::digest::digest(&ring::digest::SHA256, &data)) != expected {
            return Err("虚拟麦克风安装包校验失败，请重新安装 VoxBridge。".into());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn open_audio_settings(window: tauri::WebviewWindow, page: String) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    #[cfg(target_os = "windows")]
    {
        let target = match page.as_str() {
            "microphone" => "ms-settings:privacy-microphone",
            "devices" => "ms-settings:sound",
            _ => return Err("无效的音频设置页面。".into()),
        };
        shell_open("open", std::path::Path::new(target), None)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = page;
        Err("此入口仅用于 Windows。".into())
    }
}

#[tauri::command]
pub fn open_virtual_mic_vendor(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("此操作仅限主窗口。".into());
    }
    #[cfg(target_os = "windows")]
    {
        shell_open(
            "open",
            std::path::Path::new("https://vb-audio.com/Cable/"),
            None,
        )
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("此链接仅用于 Windows VB-CABLE。".into())
    }
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;
    #[test]
    #[ignore = "manual read-only: installed base VB-CABLE required; no audio streams"]
    fn automatic_virtual_output_resolves_to_the_verified_cable_pair() {
        let expected = ready_output_id().unwrap();
        let device =
            crate::platform::resolve_output(crate::platform::VIRTUAL_MICROPHONE_OUTPUT).unwrap();
        assert_eq!(crate::platform::output_id(&device).unwrap(), expected);
        let stop = tokio_util::sync::CancellationToken::new();
        let waited = tauri::async_runtime::block_on(crate::platform::wait_for_output(
            crate::platform::VIRTUAL_MICROPHONE_OUTPUT,
            &stop,
            || {},
        ))
        .unwrap();
        assert_eq!(waited, expected);
    }
    #[test]
    #[ignore = "manual: requires verified vendor resources; does not install or open audio streams"]
    fn verify_vendor_resources_and_read_only_inventory() {
        let directory = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../native/windows/.build/VBCABLE_Driver_Pack45");
        verify_package(&directory).unwrap();
        let temporary =
            std::env::temp_dir().join(format!("voxbridge-vbcable-check-{}", std::process::id()));
        std::fs::create_dir_all(&temporary).unwrap();
        // A missing package and a modified first file must both fail before elevation.
        assert!(verify_package(&temporary).unwrap_err().contains("缺失"));
        let manifest: std::collections::BTreeMap<String, String> = serde_json::from_str(
            include_str!("../../../native/windows/vb-cable-manifest.json"),
        )
        .unwrap();
        let first = manifest.keys().next().unwrap();
        std::fs::write(temporary.join(first), b"modified").unwrap();
        assert!(verify_package(&temporary).unwrap_err().contains("校验失败"));
        std::fs::remove_file(temporary.join(first)).unwrap();
        std::fs::remove_dir(&temporary).unwrap();
        let status = status().unwrap();
        println!(
            "VB-CABLE inventory: {}",
            serde_json::to_string(&status).unwrap()
        );
    }
    #[test]
    fn base_cable_direction_and_vendor_are_required() {
        assert!(is_cable_endpoint(
            "VoxBridge (VB-Audio Virtual Cable)",
            "output"
        ));
        assert!(!is_cable_endpoint("VoxBridge (Other Device)", "output"));
        assert!(is_cable_endpoint(
            "VoxBridge (VB-Audio Virtual Cable)",
            "input"
        ));
        assert!(is_cable_endpoint(
            "CABLE Input (VB-Audio Virtual Cable)",
            "input"
        ));
        assert!(is_cable_endpoint(
            "CABLE Output (VB-Audio Virtual Cable)",
            "output"
        ));
        assert!(!is_cable_endpoint(
            "CABLE Output (VB-Audio Virtual Cable)",
            "input"
        ));
        assert!(!is_cable_endpoint(
            "CABLE-A Input (VB-Audio Cable A)",
            "input"
        ));
        assert!(!is_cable_endpoint(
            "CABLE Input (Unrelated Device)",
            "input"
        ));
        assert!(!is_cable_endpoint("Steam Streaming Microphone", "output"));
    }
}
