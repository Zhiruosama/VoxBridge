use cpal::traits::DeviceTrait;

const OUTPUT_PREFIX: &str = "macos-output:";

fn encode_output_id(uid: &str) -> Result<String, String> {
    if uid.is_empty() {
        return Err("系统返回了空的音频设备标识。".into());
    }
    Ok(format!("{OUTPUT_PREFIX}{}", hex::encode(uid)))
}

pub(super) fn output_id(device: &cpal::Device) -> Result<String, String> {
    let id = device
        .id()
        .map_err(|_| "无法读取稳定音频设备标识，请刷新设备。".to_string())?;
    if id.0 != cpal::platform::HostId::CoreAudio {
        return Err("当前音频设备不是 Core Audio 设备。".into());
    }
    encode_output_id(&id.1)
}

pub(super) fn validate_output_id(id: &str) -> Result<(), String> {
    let encoded = id
        .strip_prefix(OUTPUT_PREFIX)
        .ok_or("旧版音频设备配置需要重新选择，请到设置中保存新的输出设备。")?;
    let uid = hex::decode(encoded).map_err(|_| "音频设备标识无效，请重新选择。")?;
    if uid.is_empty() || String::from_utf8(uid).is_err() {
        return Err("音频设备标识无效，请重新选择。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_uid_is_losslessly_encoded_without_using_device_name() {
        let uid = "USB:设备/with:separators";
        let encoded = encode_output_id(uid).unwrap();
        validate_output_id(&encoded).unwrap();
        assert_eq!(
            String::from_utf8(hex::decode(encoded.strip_prefix(OUTPUT_PREFIX).unwrap()).unwrap())
                .unwrap(),
            uid
        );
        assert_ne!(encoded, encode_output_id("another-device").unwrap());
        assert!(encode_output_id("").is_err());
    }

    #[test]
    fn legacy_names_and_invalid_ids_require_explicit_reselection() {
        for id in [
            "",
            "Headphones",
            "macos-output:",
            "macos-output:zz",
            "macos-output:ff",
        ] {
            assert!(validate_output_id(id).is_err());
        }
    }
}
