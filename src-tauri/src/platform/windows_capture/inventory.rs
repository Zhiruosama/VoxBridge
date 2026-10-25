//! Present applications, rather than window captions or helper processes.
use super::{process_identity, supported, CaptureSource, Handle, ProcessIdentity};
use std::collections::{BTreeMap, HashMap, HashSet};
use windows::{
    core::{BOOL, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW},
        System::Diagnostics::ToolHelp::{
            CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
            TH32CS_SNAPPROCESS,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetClassNameW, GetWindow, GetWindowLongPtrW, GetWindowTextW,
            GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE, GW_OWNER, WS_EX_APPWINDOW,
            WS_EX_TOOLWINDOW,
        },
    },
};

fn executable(path: &str) -> &str {
    path.rsplit(['\\', '/']).next().unwrap_or(path)
}

fn helper_process(path: &str) -> bool {
    let exe = executable(path).to_lowercase();
    matches!(
        exe.as_str(),
        "voxbridge.exe"
            | "msedgewebview2.exe"
            | "explorer.exe"
            | "shellexperiencehost.exe"
            | "startmenuexperiencehost.exe"
            | "searchhost.exe"
            | "searchapp.exe"
            | "textinputhost.exe"
            | "applicationframehost.exe"
            | "lockapp.exe"
            | "systemsettings.exe"
            | "ashdrcontrol.exe"
            | "ashotplugctrl.exe"
            | "cmd.exe"
            | "conhost.exe"
            | "openconsole.exe"
            | "powershell.exe"
            | "pwsh.exe"
            | "windowsterminal.exe"
    ) || exe.starts_with("powertoys.")
}

fn display_name(path: &str, product: Option<&str>) -> String {
    let exe = executable(path);
    match exe.to_lowercase().as_str() {
        "msedge.exe" => "Edge".into(),
        "chrome.exe" => "Chrome".into(),
        "firefox.exe" => "Firefox".into(),
        "oopz.exe" => "Oopz".into(),
        "kook.exe" | "kaiheila.exe" => "KOOK".into(),
        "discord.exe" => "Discord".into(),
        _ => product
            .map(str::trim)
            .filter(|name| {
                !name.is_empty()
                    && name.chars().count() <= 80
                    && !name.contains(['\\', '/', '\r', '\n', ':'])
            })
            .unwrap_or_else(|| {
                exe.strip_suffix(".exe")
                    .or_else(|| exe.strip_suffix(".EXE"))
                    .unwrap_or(exe)
            })
            .to_owned(),
    }
}

/// All returned bytes must be inside the version block owned by `data`.
fn version_value<'a>(data: &'a [u32], key: &str, utf16: bool) -> Option<&'a [u8]> {
    let key: Vec<u16> = key.encode_utf16().chain(Some(0)).collect();
    let (mut pointer, mut count) = (std::ptr::null_mut(), 0u32);
    if !unsafe {
        VerQueryValueW(
            data.as_ptr().cast(),
            PCWSTR(key.as_ptr()),
            &mut pointer,
            &mut count,
        )
    }
    .as_bool()
    {
        return None;
    }
    let bytes = (count as usize).checked_mul(if utf16 { 2 } else { 1 })?;
    let offset = (pointer as usize).checked_sub(data.as_ptr() as usize)?;
    if pointer.is_null() || offset.checked_add(bytes)? > std::mem::size_of_val(data) {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), bytes) })
}

fn product_name(path: &str) -> Option<String> {
    let wide: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
    let size = unsafe { GetFileVersionInfoSizeW(PCWSTR(wide.as_ptr()), None) };
    if size == 0 || size > 1024 * 1024 {
        return None;
    }
    let mut data = vec![0u32; (size as usize).div_ceil(4)];
    unsafe { GetFileVersionInfoW(PCWSTR(wide.as_ptr()), None, size, data.as_mut_ptr().cast()) }
        .ok()?;
    let languages = version_value(&data, "\\VarFileInfo\\Translation", false)?;
    for pair in languages.chunks_exact(4).take(16) {
        let language = u16::from_le_bytes([pair[0], pair[1]]);
        let page = u16::from_le_bytes([pair[2], pair[3]]);
        for field in ["ProductName", "FileDescription"] {
            let key = format!("\\StringFileInfo\\{language:04x}{page:04x}\\{field}");
            if let Some(bytes) = version_value(&data, &key, true) {
                if bytes.len() > 1024 {
                    continue;
                }
                let chars: Vec<u16> = bytes
                    .chunks_exact(2)
                    .map(|b| u16::from_le_bytes([b[0], b[1]]))
                    .take_while(|c| *c != 0)
                    .collect();
                let value = String::from_utf16_lossy(&chars);
                if !value.trim().is_empty() {
                    return Some(value);
                }
            }
        }
    }
    None
}

fn parents() -> Result<HashMap<u32, u32>, String> {
    let snapshot = Handle(
        unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) }
            .map_err(|_| "无法枚举应用进程。")?,
    );
    let mut item = PROCESSENTRY32W {
        dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32,
        ..Default::default()
    };
    let mut result = HashMap::new();
    if unsafe { Process32FirstW(snapshot.0, &mut item) }.is_ok() {
        loop {
            result.insert(item.th32ProcessID, item.th32ParentProcessID);
            if unsafe { Process32NextW(snapshot.0, &mut item) }.is_err() {
                break;
            }
        }
    }
    Ok(result)
}

fn root_process(
    mut pid: u32,
    parents: &HashMap<u32, u32>,
    mut lookup: impl FnMut(u32) -> Option<ProcessIdentity>,
) -> Option<(u32, ProcessIdentity)> {
    let mut current = lookup(pid)?;
    let mut visited = HashSet::from([pid]);
    for _ in 0..64 {
        let Some(parent) = parents.get(&pid).copied().filter(|pid| *pid != 0) else {
            break;
        };
        if !visited.insert(parent) {
            break;
        }
        let Some(info) = lookup(parent) else {
            break;
        };
        // An unrelated launcher, or a parent PID reused after this child's birth,
        // must never broaden the selected capture tree.
        if !info.path.eq_ignore_ascii_case(&current.path) || info.created > current.created {
            break;
        }
        pid = parent;
        current = info;
    }
    Some((pid, current))
}

unsafe extern "system" fn visit(window: HWND, data: LPARAM) -> BOOL {
    if !IsWindowVisible(window).as_bool() {
        return true.into();
    }
    let style = GetWindowLongPtrW(window, GWL_EXSTYLE) as u32;
    if style & WS_EX_TOOLWINDOW.0 != 0 {
        return true.into();
    }
    if style & WS_EX_APPWINDOW.0 == 0
        && GetWindow(window, GW_OWNER).is_ok_and(|owner| !owner.0.is_null())
    {
        return true.into();
    }
    let mut cloaked = 0u32;
    let _ = DwmGetWindowAttribute(window, DWMWA_CLOAKED, (&mut cloaked as *mut u32).cast(), 4);
    if cloaked != 0 {
        return true.into();
    }
    let mut class = [0u16; 128];
    let count = GetClassNameW(window, &mut class);
    if matches!(
        String::from_utf16_lossy(&class[..count.max(0) as usize]).as_str(),
        "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
    ) {
        return true.into();
    }
    let mut title = [0u16; 2];
    if GetWindowTextW(window, &mut title) == 0 {
        return true.into();
    }
    let mut pid = 0;
    GetWindowThreadProcessId(window, Some(&mut pid));
    if pid != 0 && pid != std::process::id() {
        // Captions are used only to detect a nonempty title, never as labels.
        (&mut *(data.0 as *mut HashSet<u32>)).insert(pid);
    }
    true.into()
}

pub fn sources() -> Result<Vec<CaptureSource>, String> {
    supported()?;
    let parents = parents()?;
    let mut pids = HashSet::<u32>::new();
    unsafe { EnumWindows(Some(visit), LPARAM(&mut pids as *mut _ as isize)) }
        .map_err(|_| "无法枚举应用窗口。")?;
    let mut cache = HashMap::<u32, Option<ProcessIdentity>>::new();
    let mut apps = BTreeMap::new();
    for pid in pids {
        let Some((root, info)) = root_process(pid, &parents, |pid| {
            cache
                .entry(pid)
                .or_insert_with(|| process_identity(pid).ok())
                .clone()
        }) else {
            continue;
        };
        if root == std::process::id() || helper_process(&info.path) {
            continue;
        }
        apps.entry(root).or_insert_with(|| CaptureSource {
            pid: root as i32,
            bundle_id: info.id,
            name: display_name(&info.path, product_name(&info.path).as_deref()),
            app_scoped: false,
        });
    }
    let mut list: Vec<_> = apps.into_values().collect();
    // Independent instances stay independently selectable: do not label a single
    // captured root as if it represented every unrelated process with that exe.
    let mut counts = HashMap::<String, usize>::new();
    for app in &list {
        *counts.entry(app.name.clone()).or_default() += 1;
    }
    let mut positions = HashMap::<String, usize>::new();
    for app in &mut list {
        if counts[&app.name] > 1 {
            let position = positions.entry(app.name.clone()).or_default();
            *position += 1;
            app.name = format!("{} · {}", app.name, position);
        }
    }
    list.sort_by_cached_key(|app| app.name.to_lowercase());
    Ok(list)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_describe_apps_without_captions_or_paths() {
        assert_eq!(
            display_name(r"C:\Apps\msedge.exe", Some("Microsoft Edge")),
            "Edge"
        );
        assert_eq!(display_name(r"C:\Apps\oopz.exe", None), "Oopz");
        assert_eq!(display_name(r"C:\Apps\KaiHeiLa.exe", None), "KOOK");
        assert_eq!(
            display_name(r"C:\Apps\player.exe", Some("Video Player")),
            "Video Player"
        );
        assert_eq!(
            display_name(r"C:\Apps\player.exe", Some("C:\\private\\file")),
            "player"
        );
        for exe in [
            "AsHDRControl.exe",
            "AsHotplugCtrl.exe",
            "explorer.exe",
            "TextInputHost.exe",
            "cmd.exe",
            "VoxBridge.exe",
            "PowerToys.PowerLauncher.exe",
        ] {
            assert!(helper_process(exe), "{exe}");
        }
        for exe in ["msedge.exe", "oopz.exe", "kook.exe", "vlc.exe"] {
            assert!(!helper_process(exe), "{exe}");
        }
    }
    #[test]
    fn same_executable_children_group_under_the_real_root_without_crossing_launchers() {
        let parents = HashMap::from([(3, 2), (2, 1), (1, 99)]);
        let lookup = |pid: u32| {
            Some(ProcessIdentity {
                path: if pid == 99 {
                    "launcher.exe"
                } else {
                    "browser.exe"
                }
                .into(),
                created: u64::from(pid),
                id: pid.to_string(),
            })
        };
        assert_eq!(root_process(3, &parents, lookup).unwrap().0, 1);
        let reused_parent = |pid: u32| {
            Some(ProcessIdentity {
                path: "browser.exe".into(),
                created: if pid == 2 { 100 } else { 3 },
                id: pid.to_string(),
            })
        };
        assert_eq!(root_process(3, &parents, reused_parent).unwrap().0, 3);
        assert_eq!(
            root_process(3, &parents, |pid| if pid == 3 { lookup(pid) } else { None })
                .unwrap()
                .0,
            3
        );
    }
}
