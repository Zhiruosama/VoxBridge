//! Windows installer UI. Installation stays delegated to the existing NSIS engine.
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};
use tauri::Manager;

#[derive(Default)]
pub struct SetupState {
    busy: AtomicBool,
    installed: Mutex<Option<PathBuf>>,
}

pub fn requested() -> bool {
    cfg!(target_os = "windows")
        && std::env::args()
            .any(|arg| matches!(arg.as_str(), "--voxbridge-setup" | "--voxbridge-uninstall"))
}

fn uninstall_requested() -> bool {
    cfg!(target_os = "windows") && std::env::args().any(|arg| arg == "--voxbridge-uninstall")
}

pub fn create_window(app: &mut tauri::App) -> Result<bool, Box<dyn std::error::Error>> {
    if !requested() {
        return Ok(false);
    }
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "setup",
        tauri::WebviewUrl::App(
            if uninstall_requested() {
                "index.html?window=setup&mode=uninstall"
            } else {
                "index.html?window=setup"
            }
            .into(),
        ),
    )
    .title(if uninstall_requested() {
        "VoxBridge 卸载"
    } else {
        "VoxBridge 安装"
    })
    .inner_size(900.0, 640.0)
    .min_inner_size(820.0, 580.0)
    .resizable(true)
    .maximizable(true)
    .decorations(false)
    .background_color(tauri::window::Color(30, 30, 30, 255));
    #[cfg(target_os = "windows")]
    let window = window.data_directory(std::env::temp_dir().join(if uninstall_requested() {
        "VoxBridgeUninstall-Webview"
    } else {
        "VoxBridgeSetup-Webview"
    }));
    let window = window.build()?;
    let handle = app.handle().clone();
    window.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            let state = handle.state::<SetupState>();
            if state.busy.load(Ordering::SeqCst) {
                api.prevent_close();
            } else {
                handle.exit(if state.installed.lock().is_ok_and(|p| p.is_some()) {
                    0
                } else {
                    1
                });
            }
        }
    });
    Ok(true)
}

fn ensure_setup() -> Result<(), String> {
    if requested() {
        Ok(())
    } else {
        Err("安装界面未启动。".into())
    }
}

#[cfg(target_os = "windows")]
fn powershell(script: &str) -> Result<String, String> {
    use std::os::windows::process::CommandExt;
    let result = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x08000000)
        .output()
        .map_err(|_| "无法读取安装信息。")?;
    if !result.status.success() {
        return Err("无法读取安装信息，请重试。".into());
    }
    Ok(String::from_utf8_lossy(&result.stdout).trim().to_owned())
}

#[tauri::command]
pub async fn setup_inspect() -> Result<serde_json::Value, String> {
    ensure_setup()?;
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(|| {
        let json = powershell(r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $p=$null; if(Test-Path 'HKCU:\Software\voxbridge\VoxBridge'){$p=(Get-Item 'HKCU:\Software\voxbridge\VoxBridge').GetValue('')}; @{path=if($p){$p}else{Join-Path $env:LOCALAPPDATA 'VoxBridge'};upgrade=[bool]$p;driver=(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME');language=(Get-UICulture).TwoLetterISOLanguageName}|ConvertTo-Json -Compress"#)?;
        serde_json::from_str(&json).map_err(|_| "无法读取安装信息。".into())
    }).await.map_err(|_| "无法读取安装信息。".to_owned())?;
    #[cfg(not(target_os = "windows"))]
    Err("此安装器仅适用于 Windows。".into())
}

#[tauri::command]
pub async fn setup_choose_folder() -> Result<Option<String>, String> {
    ensure_setup()?;
    #[cfg(target_os = "windows")]
    return tauri::async_runtime::spawn_blocking(|| {
        let path = powershell(r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); Add-Type -AssemblyName System.Windows.Forms; $d=[System.Windows.Forms.FolderBrowserDialog]::new(); $d.Description='选择 VoxBridge 安装位置'; if($d.ShowDialog() -eq 'OK') { [Console]::Write($d.SelectedPath) }; $d.Dispose()"#)?;
        Ok(if path.is_empty() {None} else {Some(path)})
    }).await.map_err(|_| "无法打开文件夹选择器。".to_owned())?;
    #[cfg(not(target_os = "windows"))]
    Err("此安装器仅适用于 Windows。".into())
}

fn validate_path(path: &str) -> Result<(), String> {
    let bytes = path.as_bytes();
    if bytes.len() < 4
        || !bytes[0].is_ascii_alphabetic()
        || bytes[1] != b':'
        || bytes[2] != b'\\'
        || path[3..]
            .chars()
            .any(|c| c.is_control() || "<>\"|?*:".contains(c))
        || path[3..]
            .split(['\\', '/'])
            .any(|p| p.is_empty() || p == "." || p == ".." || p.ends_with([' ', '.']))
    {
        return Err("请选择有效的本地安装文件夹，不能使用磁盘根目录。".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn setup_install(
    app: tauri::AppHandle,
    path: String,
    driver: bool,
    desktop_shortcut: bool,
) -> Result<serde_json::Value, String> {
    ensure_setup()?;
    if uninstall_requested() {
        return Err("当前为卸载界面。".into());
    }
    validate_path(&path)?;
    let state = app.state::<SetupState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("安装正在进行中。".into());
    }
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        install(&task_app, &path, driver, desktop_shortcut)
    })
    .await
    .map_err(|_| "安装任务未能完成，请重试。".to_string())
    .and_then(|r| r);
    state.busy.store(false, Ordering::SeqCst);
    result
}

fn install(
    app: &tauri::AppHandle,
    path: &str,
    driver: bool,
    desktop_shortcut: bool,
) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let folder = PathBuf::from(path);
        if let Ok(windows) = std::env::var("SystemRoot") {
            if folder
                .to_string_lossy()
                .to_lowercase()
                .starts_with(&windows.to_lowercase())
            {
                return Err("请选择 Windows 系统目录以外的文件夹。".into());
            }
        }
        let payload = std::env::current_exe()
            .map_err(|_| "无法读取安装文件。")?
            .with_file_name("setup-payload.exe");
        if !payload.is_file() {
            return Err("安装文件不完整，请重新下载安装包。".into());
        }
        let inspect: serde_json::Value = serde_json::from_str(&powershell(r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); @{upgrade=(Test-Path 'HKCU:\Software\voxbridge\VoxBridge');driver=(Test-Path 'HKLM:\SYSTEM\CurrentControlSet\Services\VBAudioVACMME')}|ConvertTo-Json -Compress"#)?).map_err(|_| "无法检查已有安装。")?;
        let mut command = std::process::Command::new(payload);
        command.arg("/S");
        if inspect["upgrade"] == true {
            command.arg("/UPDATE");
        }
        command.arg(if desktop_shortcut {
            "/DESKTOP"
        } else {
            "/NODESKTOP"
        });
        // NSIS requires /D last and unquoted. The validated path contains no quotes
        // or control characters; no shell interprets it.
        let status = command
            .raw_arg(format!("/D={path}"))
            .creation_flags(0x08000000)
            .status()
            .map_err(|_| "无法启动安装任务。")?;
        if !status.success() || !folder.join("voxbridge.exe").is_file() {
            return Err("安装未完成，请退出 VoxBridge 后重试。原有配置不会被删除。".into());
        }
        *app.state::<SetupState>()
            .installed
            .lock()
            .map_err(|_| "无法保存安装结果。")? = Some(folder.clone());
        let mut warning = false;
        if driver && inspect["driver"] != true && inspect["upgrade"] != true {
            let helper = folder.join("virtual-microphone/Manage-Virtual-Microphone.ps1");
            let status = std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-WindowStyle",
                    "Hidden",
                    "-File",
                ])
                .arg(helper)
                .creation_flags(0x08000000)
                .status();
            warning = !status.is_ok_and(|s| s.success());
        }
        Ok(serde_json::json!({"driverWarning":warning}))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, path, driver, desktop_shortcut);
        Err("此安装器仅适用于 Windows。".into())
    }
}

#[tauri::command]
pub fn setup_finish(app: tauri::AppHandle, open: bool) -> Result<(), String> {
    ensure_setup()?;
    if app.state::<SetupState>().busy.load(Ordering::SeqCst) {
        return Err("安装正在进行中，请稍候。".into());
    }
    let folder = app
        .state::<SetupState>()
        .installed
        .lock()
        .map_err(|_| "无法读取安装结果。")?
        .clone()
        .ok_or("安装尚未完成。")?;
    if open && !uninstall_requested() {
        std::process::Command::new(folder.join("voxbridge.exe"))
            .spawn()
            .map_err(|_| "无法打开 VoxBridge，请从开始菜单启动。")?;
    }
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn setup_uninstall(
    app: tauri::AppHandle,
    remove_data: bool,
    remove_driver: bool,
) -> Result<(), String> {
    if !uninstall_requested() {
        return Err("卸载界面未启动。".into());
    }
    let state = app.state::<SetupState>();
    if state.busy.swap(true, Ordering::SeqCst) {
        return Err("卸载正在进行中。".into());
    }
    let task_app = app.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        uninstall(&task_app, remove_data, remove_driver)
    })
    .await
    .map_err(|_| "卸载任务未完成。".to_string())
    .and_then(|r| r);
    state.busy.store(false, Ordering::SeqCst);
    result
}

fn uninstall(app: &tauri::AppHandle, remove_data: bool, remove_driver: bool) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let path = std::env::args()
            .find_map(|arg| {
                arg.strip_prefix("--voxbridge-uninstall-root=")
                    .map(str::to_owned)
            })
            .ok_or("请从系统设置或原安装目录打开卸载程序。")?;
        let path = path.trim_end_matches(['\\', '/']);
        validate_path(path)?;
        let registered = powershell(
            r#"[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); if(Test-Path 'HKCU:\Software\voxbridge\VoxBridge'){[Console]::Write((Get-Item 'HKCU:\Software\voxbridge\VoxBridge').GetValue(''))}"#,
        )?;
        if !path.eq_ignore_ascii_case(registered.trim_end_matches(['\\', '/'])) {
            return Err("卸载位置与已安装应用不一致，操作已停止。".into());
        }
        let folder = PathBuf::from(path);
        let payload = std::env::current_exe()
            .map_err(|_| "无法读取卸载文件。")?
            .with_file_name("uninstall-payload.exe");
        if !payload.is_file() || !folder.join("uninstall.exe").is_file() {
            return Err("卸载文件不完整，请重新安装后再卸载。".into());
        }
        // Refuse rather than force-ending an app that may contain live work.
        let executable = folder.join("voxbridge.exe");
        let escaped = executable.to_string_lossy().replace('\'', "''");
        let running = powershell(&format!("$p='{escaped}'; if(Get-Process voxbridge -ErrorAction SilentlyContinue | Where-Object {{$_.Path -eq $p}}){{'running'}}"))?;
        if !running.is_empty() {
            return Err("请先在 VoxBridge 中选择退出应用，再重试卸载；最小化不会退出。".into());
        }
        if remove_driver {
            let helper = folder.join("virtual-microphone/Manage-Virtual-Microphone.ps1");
            if !helper.is_file() {
                return Err("找不到驱动管理器，请取消驱动选项后重试。".into());
            }
            let status = std::process::Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-WindowStyle",
                    "Hidden",
                    "-File",
                ])
                .arg(helper)
                .creation_flags(0x08000000)
                .status()
                .map_err(|_| "无法打开驱动管理器。")?;
            if !status.success() {
                return Err("驱动管理器未完成，请重试或取消驱动选项。".into());
            }
        }
        let mut command = std::process::Command::new(payload);
        command.arg("/S");
        if remove_data {
            command.arg("/DELETEAPPDATA");
        }
        let status = command
            .raw_arg(format!("_?={path}"))
            .creation_flags(0x08000000)
            .status()
            .map_err(|_| "无法启动卸载任务。")?;
        if !status.success() || executable.exists() {
            return Err("卸载未完成，请关闭占用文件的程序后重试。".into());
        }
        *app.state::<SetupState>()
            .installed
            .lock()
            .map_err(|_| "无法保存卸载结果。")? = Some(folder);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, remove_data, remove_driver);
        Err("此卸载器仅适用于 Windows。".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn install_paths_accept_spaces_but_reject_roots_and_argument_injection() {
        for path in [
            r"D:\VoxBridge",
            r"C:\Users\Test User\VoxBridge",
            r"D:\软件\VoxBridge",
        ] {
            assert!(validate_path(path).is_ok());
        }
        for path in [
            r"C:\",
            r"\\server\share",
            r"C:\a\..\Windows",
            "C:\\foo\" /S",
            "C:\\foo\n/S",
            r"C:\a?b",
            r"C:\foo.",
        ] {
            assert!(validate_path(path).is_err());
        }
    }
}
