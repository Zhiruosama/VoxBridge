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
    cfg!(target_os = "windows") && std::env::args().any(|arg| arg == "--voxbridge-setup")
}

pub fn create_window(app: &mut tauri::App) -> Result<bool, Box<dyn std::error::Error>> {
    if !requested() {
        return Ok(false);
    }
    let window = tauri::WebviewWindowBuilder::new(
        app,
        "setup",
        tauri::WebviewUrl::App("index.html?window=setup".into()),
    )
    .title("VoxBridge 安装")
    .inner_size(900.0, 640.0)
    .min_inner_size(820.0, 580.0)
    .resizable(true)
    .maximizable(true)
    .decorations(false)
    .background_color(tauri::window::Color(30, 30, 30, 255));
    #[cfg(target_os = "windows")]
    let window = window.data_directory(std::env::temp_dir().join("VoxBridgeSetup-Webview"));
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
    if open {
        std::process::Command::new(folder.join("voxbridge.exe"))
            .spawn()
            .map_err(|_| "无法打开 VoxBridge，请从开始菜单启动。")?;
    }
    app.exit(0);
    Ok(())
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
