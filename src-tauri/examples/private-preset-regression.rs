//! Explicit local private-build check. Separate user-data namespace, no model calls.
#[path = "../src/credentials.rs"]
mod credentials;
#[path = "../src/private_preset.rs"]
mod private_preset;

fn main() {
    let mut context = tauri::generate_context!();
    context.config_mut().identifier =
        format!("dev.voxbridge.private-preset-test-{}", std::process::id());
    tauri::Builder::default()
        .setup(|app| {
            credentials::initialize(app.handle()).map_err(std::io::Error::other)?;
            let window = tauri::WebviewWindowBuilder::new(app, "main", tauri::WebviewUrl::External("about:blank".parse()?))
                .visible(false).build()?;
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let result: Result<(), String> = async {
                    let Some(settings) = private_preset::private_preset(window.clone(), false).await? else {
                        println!("PUBLIC_BUILD: no private preset"); return Ok(());
                    };
                    let profiles = settings["profiles"].as_array().ok_or("Missing profiles")?;
                    let ids: Vec<_> = profiles.iter().map(|p| p["id"].as_str().unwrap().to_string()).collect();
                    for id in &ids { assert!(!credentials::credential_status(id.clone()).await?); }
                    private_preset::private_preset(window.clone(), true).await?;
                    for id in &ids {
                        assert!(credentials::credential_status(id.clone()).await?);
                        assert!(!credentials::read(id)?.is_empty());
                    }
                    let id = ids.first().ok_or("No preset credentials")?.clone();
                    credentials::set_credential(id.clone(), "fixture-existing-user-key".into()).await?;
                    private_preset::private_preset(window, true).await?;
                    assert!(credentials::read(&id)? == "fixture-existing-user-key");
                    println!("PASS: fresh private credential import, native availability, repeat import preserves existing key; isolated profile; no model calls");
                    Ok(())
                }.await;
                handle.exit(if result.is_ok() { 0 } else { eprintln!("Private bootstrap regression failed; values omitted"); 1 });
            });
            Ok(())
        })
        .run(context).expect("Private preset regression runtime failed");
}
