use cpal::traits::{DeviceTrait, HostTrait};
use serde::Serialize;

#[cfg(target_os = "macos")]
mod macos;

#[derive(Serialize)]
pub struct OutputDevice {
    pub id: String,
    pub name: String,
}

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
    Ok(output_entries()?
        .into_iter()
        .map(|(_, description)| description)
        .collect())
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
    #[cfg(target_os = "macos")]
    macos::validate_output_id(id)?;
    select_unique(
        output_entries()?
            .into_iter()
            .map(|(device, description)| (device, description.id)),
        id,
    )
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
