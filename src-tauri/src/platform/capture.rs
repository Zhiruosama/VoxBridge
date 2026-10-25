//! Platform boundary for native application capture. PCM never crosses the WebView.
#[cfg(any(target_os = "macos", test))]
use crate::capture::CaptureSource;
#[cfg(target_os = "macos")]
#[path = "macos_capture.rs"]
mod implementation;
#[cfg(target_os = "windows")]
#[path = "windows_capture.rs"]
mod implementation;

#[cfg(target_os = "macos")]
pub(crate) use implementation::process_sources;
#[cfg(all(test, target_os = "windows"))]
pub(crate) use implementation::source_for_pid;
pub(crate) use implementation::{sources, Capture};

pub(crate) fn supported() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    return implementation::supported();
    #[cfg(target_os = "macos")]
    Ok(())
}

pub(crate) fn recover_source(
    original: &crate::capture::CaptureSource,
) -> Result<crate::capture::CaptureSource, String> {
    #[cfg(target_os = "windows")]
    return implementation::recover_source(original);
    #[cfg(target_os = "macos")]
    select_source(
        original,
        if original.app_scoped {
            sources()?
        } else {
            process_sources()?
        },
    )
}

#[cfg(any(target_os = "macos", test))]
pub(crate) fn select_source(
    original: &CaptureSource,
    candidates: Vec<CaptureSource>,
) -> Result<CaptureSource, String> {
    if original.app_scoped {
        return candidates
            .into_iter()
            .find(|source| source.app_scoped && source.bundle_id == original.bundle_id)
            .ok_or_else(|| "正在等待目标应用恢复声音进程。".into());
    }
    if let Some(source) = candidates
        .iter()
        .find(|s| s.pid == original.pid && s.bundle_id == original.bundle_id)
    {
        return Ok(source.clone());
    }
    // Never bind a different process on PID alone or guess among multiple browser processes.
    if original.bundle_id.is_empty() {
        return Err("正在等待目标应用恢复声音进程。".into());
    }
    let mut matching = candidates
        .into_iter()
        .filter(|s| s.bundle_id == original.bundle_id && s.pid as u32 != std::process::id());
    let source = matching.next().ok_or("正在等待目标应用恢复声音进程。")?;
    if matching.next().is_some() {
        return Err("目标应用有多个音频进程，请刷新后重新选择。".into());
    }
    Ok(source)
}
