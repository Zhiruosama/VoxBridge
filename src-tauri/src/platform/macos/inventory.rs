//! Property-only inventory. CPAL description()/supports_input() create input AudioUnits,
//! which can trigger TCC even when the user only opens Settings.
use super::super::OutputDevice;
use objc2_core_audio::*;
use objc2_core_foundation::{CFRetained, CFString};
use std::{
    mem::size_of,
    ptr::{null, NonNull},
};

fn address(selector: u32, scope: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: scope,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn objects(object: u32, selector: u32, scope: u32) -> Result<Vec<u32>, String> {
    let address = address(selector, scope);
    for _ in 0..3 {
        let mut size = 0;
        // SAFETY: All callers request arrays of AudioObjectIDs without qualifiers.
        let status = unsafe {
            AudioObjectGetPropertyDataSize(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
            )
        };
        if status != 0 {
            return Err("无法读取音频设备列表。".into());
        }
        if size > 1_048_576 || !(size as usize).is_multiple_of(size_of::<u32>()) {
            return Err("音频设备列表大小无效。".into());
        }
        if size == 0 {
            return Ok(Vec::new());
        }
        let capacity = size;
        let mut values = vec![0u32; size as usize / size_of::<u32>()];
        // SAFETY: Initialized storage has the size requested by Core Audio. Recheck returned size.
        let status = unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::new(values.as_mut_ptr()).unwrap().cast(),
            )
        };
        if status == 0 && size <= capacity && (size as usize).is_multiple_of(size_of::<u32>()) {
            values.truncate(size as usize / size_of::<u32>());
            return Ok(values);
        }
    }
    Err("音频设备正在变化，请刷新重试。".into())
}

fn text(object: u32, selector: u32) -> Result<String, String> {
    let address = address(selector, kAudioObjectPropertyScopeGlobal);
    let mut value: *mut CFString = std::ptr::null_mut();
    let mut size = size_of::<*mut CFString>() as u32;
    // SAFETY: Device name and UID properties return a retained CFString, released by CFRetained.
    let status = unsafe {
        AudioObjectGetPropertyData(
            object,
            NonNull::from(&address),
            0,
            null(),
            NonNull::from(&mut size),
            NonNull::from(&mut value).cast(),
        )
    };
    if status != 0 {
        return Err("无法读取音频设备名称。".into());
    }
    let value = NonNull::new(value).ok_or("音频设备名称为空。")?;
    let value = unsafe { CFRetained::from_raw(value) };
    if size != size_of::<*mut CFString>() as u32 {
        return Err("音频设备名称无效。".into());
    }
    Ok(value.to_string())
}

pub(super) fn list(input: bool) -> Result<Vec<OutputDevice>, String> {
    let scope = if input {
        kAudioObjectPropertyScopeInput
    } else {
        kAudioObjectPropertyScopeOutput
    };
    let mut devices = Vec::new();
    for object in objects(
        kAudioObjectSystemObject as u32,
        kAudioHardwarePropertyDevices,
        kAudioObjectPropertyScopeGlobal,
    )? {
        // Skip devices removed between inventory and property reads. Never open an AudioUnit.
        if objects(object, kAudioDevicePropertyStreams, scope)
            .is_ok_and(|streams| !streams.is_empty())
        {
            if let (Ok(uid), Ok(name)) = (
                text(object, kAudioDevicePropertyDeviceUID),
                text(object, kAudioObjectPropertyName),
            ) {
                if uid.is_empty()
                    || (input
                        && (uid == "com.voxbridge.audio.device"
                            || name.to_lowercase().contains("voxbridge")))
                {
                    continue;
                }
                devices.push(OutputDevice {
                    id: if input {
                        format!("mic:{}", hex::encode(uid))
                    } else {
                        super::encode_output_id(&uid)?
                    },
                    name,
                });
            }
        }
    }
    Ok(devices)
}
