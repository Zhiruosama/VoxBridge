//! Keep Tao's hidden host valid while its webview lives in the floating panel.
use objc2::{MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{NSView, NSWindow};

pub(crate) fn transfer(original: &NSWindow, panel: &NSWindow) -> Result<(), &'static str> {
    let mtm = MainThreadMarker::new().ok_or("字幕窗必须在主线程显示。")?;
    let content = original.contentView().ok_or("字幕内容不可用。")?;
    // Tao retains the original NSWindow and its delegate. AppKit can send resize
    // and backing-scale callbacks even after orderOut, on display hotplug/wake.
    // Its delegate unwraps original.contentView(): never leave it empty, even
    // temporarily, and never change Tao's window class or delegate.
    let placeholder = NSView::initWithFrame(NSView::alloc(mtm), content.frame());
    original.setContentView(Some(&placeholder));
    panel.setContentView(Some(&content));
    Ok(())
}
