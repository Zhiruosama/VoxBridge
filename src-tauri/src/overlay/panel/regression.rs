//! Disposable debug-only coverage for moving the same WebView between panels.
use super::*;

pub(crate) fn run(window: &tauri::WebviewWindow) -> Result<(), String> {
    prepare(window, false)?;
    let mtm = MainThreadMarker::new().unwrap();
    let application = NSApplication::sharedApplication(mtm);
    let policy = application.activationPolicy();
    let (passive_number, root) = PANEL.with(|state| {
        let state = state.borrow();
        let item = &state[window.label()];
        (item.panel.windowNumber(), item.panel.contentView().unwrap())
    });
    assert!(text_input(window.label(), true).is_err());
    text_input(window.label(), false)?;
    PANEL.with(|state| assert!(!state.borrow()[window.label()].panel.isVisible()));
    for _ in 0..5 {
        prepare(window, true)?;
        text_input(window.label(), true)?;
        let editor_number = PANEL.with(|state| {
            let state = state.borrow();
            let item = &state[window.label()];
            assert!(!item
                .panel
                .styleMask()
                .contains(NSWindowStyleMask::NonactivatingPanel));
            assert!(item
                .passive_panel
                .as_ref()
                .unwrap()
                .styleMask()
                .contains(NSWindowStyleMask::NonactivatingPanel));
            assert_eq!(
                &*item.panel.contentView().unwrap() as *const NSView,
                &*root as *const NSView
            );
            item.panel.windowNumber()
        });
        assert_ne!(editor_number, passive_number);
        text_input(window.label(), true)?;
        PANEL.with(|state| {
            assert_eq!(
                state.borrow()[window.label()].panel.windowNumber(),
                editor_number
            )
        });
        assert_eq!(
            application.activationPolicy(),
            NSApplicationActivationPolicy::Accessory
        );
        text_input(window.label(), false)?;
        PANEL.with(|state| {
            let state = state.borrow();
            let item = &state[window.label()];
            assert_eq!(item.panel.windowNumber(), passive_number);
            assert_eq!(
                &*item.panel.contentView().unwrap() as *const NSView,
                &*root as *const NSView
            );
            assert!(item.passive_panel.is_none());
        });
        assert_eq!(application.activationPolicy(), policy);
        text_input(window.label(), true)?;
        hide(window.label());
        PANEL.with(|state| assert!(!state.borrow()[window.label()].panel.isVisible()));
        assert_eq!(application.activationPolicy(), policy);
    }
    println!("PASS: hidden input rejection, repeated panel transfer, draft-view identity, idempotence, hide and activation policy restoration");
    Ok(())
}
