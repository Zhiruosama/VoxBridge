use super::CaptureSource;
use crate::pcm::PcmWriter;
use objc2::AnyThread;
use objc2_core_audio::*;
use objc2_core_audio_types::{
    kAudioFormatFlagIsBigEndian, kAudioFormatFlagIsFloat, kAudioFormatFlagIsNonInterleaved,
    kAudioFormatLinearPCM, AudioBuffer, AudioBufferList, AudioStreamBasicDescription,
    AudioTimeStamp,
};
use objc2_core_foundation::{CFArray, CFBoolean, CFDictionary, CFRetained, CFString, CFType};
use objc2_foundation::{NSArray, NSNumber, NSString, NSUUID};
use std::{
    mem::size_of,
    ptr::{null, NonNull},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};

fn ensure_active(token: &tokio_util::sync::CancellationToken) -> Result<(), String> {
    if token.is_cancelled() {
        Err("采集已停止。".into())
    } else {
        Ok(())
    }
}

fn supported() -> Result<(), String> {
    if objc2::available!(macos = 14.2) {
        Ok(())
    } else {
        Err("应用声音采集需要 macOS 14.2 或更新版本。".into())
    }
}

fn check(status: i32, operation: &str) -> Result<(), String> {
    if status == 0 {
        Ok(())
    } else {
        Err(format!("{operation}失败（系统状态 {status}）。请检查系统设置中的屏幕与系统音频录制权限，授权后重启应用。"))
    }
}

fn address(selector: u32) -> AudioObjectPropertyAddress {
    AudioObjectPropertyAddress {
        mSelector: selector,
        mScope: kAudioObjectPropertyScopeGlobal,
        mElement: kAudioObjectPropertyElementMain,
    }
}

fn property<T: Copy>(object: u32, selector: u32, mut value: T) -> Result<T, String> {
    let mut size = size_of::<T>() as u32;
    let address = address(selector);
    // SAFETY: Callers use the scalar or ASBD type specified by each selector; storage is initialized.
    check(
        unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        },
        "读取音频属性",
    )?;
    if size != size_of::<T>() as u32 {
        return Err("系统返回了不完整的音频属性。".into());
    }
    Ok(value)
}

fn copied_string(object: u32, selector: u32) -> Result<String, String> {
    let mut value: *mut CFString = std::ptr::null_mut();
    let mut size = size_of::<*mut CFString>() as u32;
    let address = address(selector);
    // SAFETY: Only the device UID and process bundle ID selectors are used; both return a +1 CFString.
    check(
        unsafe {
            AudioObjectGetPropertyData(
                object,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::from(&mut value).cast(),
            )
        },
        "读取音频标识",
    )?;
    let value = NonNull::new(value).ok_or("系统返回了空的音频标识。")?;
    // SAFETY: The successful property call transferred +1 ownership of this CFString.
    let value = unsafe { CFRetained::from_raw(value) };
    if size != size_of::<*mut CFString>() as u32 {
        return Err("系统返回了无效的音频标识。".into());
    }
    Ok(value.to_string())
}

fn process_objects() -> Result<Vec<u32>, String> {
    supported()?;
    let address = address(kAudioHardwarePropertyProcessObjectList);
    for _ in 0..3 {
        let mut size = 0;
        // SAFETY: Output size has valid storage, and no qualifier is required for the process list.
        check(
            unsafe {
                AudioObjectGetPropertyDataSize(
                    kAudioObjectSystemObject as u32,
                    NonNull::from(&address),
                    0,
                    null(),
                    NonNull::from(&mut size),
                )
            },
            "读取音频进程数量",
        )?;
        if !(size as usize).is_multiple_of(size_of::<u32>()) || size > 16_384 {
            return Err("系统音频进程列表大小无效。".into());
        }
        if size == 0 {
            return Ok(Vec::new());
        }
        let capacity = size;
        let mut objects = vec![0_u32; size as usize / size_of::<u32>()];
        // SAFETY: The initialized array has the capacity requested by Core Audio; the returned size is checked.
        let status = unsafe {
            AudioObjectGetPropertyData(
                kAudioObjectSystemObject as u32,
                NonNull::from(&address),
                0,
                null(),
                NonNull::from(&mut size),
                NonNull::new(objects.as_mut_ptr()).unwrap().cast(),
            )
        };
        if status != 0 {
            continue;
        }
        if size <= capacity && (size as usize).is_multiple_of(size_of::<u32>()) {
            objects.truncate(size as usize / size_of::<u32>());
            return Ok(objects);
        }
    }
    Err("音频进程列表正在变化，请刷新重试。".into())
}

pub fn sources() -> Result<Vec<CaptureSource>, String> {
    let mut sources = Vec::new();
    for object in process_objects()? {
        let Ok(pid) = property::<i32>(object, kAudioProcessPropertyPID, 0) else {
            continue;
        };
        if pid <= 0 || pid as u32 == std::process::id() {
            continue;
        }
        let Ok(bundle_id) = copied_string(object, kAudioProcessPropertyBundleID) else {
            continue;
        };
        if !sources
            .iter()
            .any(|source: &CaptureSource| source.pid == pid && source.bundle_id == bundle_id)
        {
            sources.push(CaptureSource { pid, bundle_id });
        }
    }
    sources.sort_by_key(|source| source.pid);
    Ok(sources)
}

fn matching_objects(source: &CaptureSource) -> Result<Vec<u32>, String> {
    Ok(process_objects()?
        .into_iter()
        .filter(|object| {
            property::<i32>(*object, kAudioProcessPropertyPID, 0).ok() == Some(source.pid)
                && copied_string(*object, kAudioProcessPropertyBundleID)
                    .ok()
                    .as_deref()
                    == Some(source.bundle_id.as_str())
        })
        .collect())
}

pub fn source_exists(source: &CaptureSource) -> bool {
    matching_objects(source).is_ok_and(|objects| !objects.is_empty())
}

fn dictionary(
    entries: &[(&std::ffi::CStr, &CFType)],
) -> CFRetained<CFDictionary<CFString, CFType>> {
    let keys: Vec<_> = entries
        .iter()
        .map(|(key, _)| CFString::from_str(key.to_str().expect("Core Audio keys are ASCII")))
        .collect();
    let key_refs: Vec<_> = keys.iter().map(|key| &**key).collect();
    let values: Vec<_> = entries.iter().map(|(_, value)| *value).collect();
    CFDictionary::from_slices(&key_refs, &values)
}

fn empty_format() -> AudioStreamBasicDescription {
    AudioStreamBasicDescription {
        mSampleRate: 0.0,
        mFormatID: 0,
        mFormatFlags: 0,
        mBytesPerPacket: 0,
        mFramesPerPacket: 0,
        mBytesPerFrame: 0,
        mChannelsPerFrame: 0,
        mBitsPerChannel: 0,
        mReserved: 0,
    }
}

fn validate_format(format: &AudioStreamBasicDescription) -> Result<u32, String> {
    if format.mFormatID != kAudioFormatLinearPCM
        || format.mFormatFlags & kAudioFormatFlagIsFloat == 0
        || format.mFormatFlags & kAudioFormatFlagIsBigEndian != 0
        || format.mBitsPerChannel != 32
        || format.mChannelsPerFrame != 2
        || !format.mSampleRate.is_finite()
        || format.mSampleRate.fract() != 0.0
        || !(8000.0..=192000.0).contains(&format.mSampleRate)
    {
        return Err("采集诊断暂仅支持 8–192 kHz、双声道 Float32 PCM。".into());
    }
    Ok(format.mSampleRate as u32)
}

struct CallbackContext {
    writer: PcmWriter,
    failed: Arc<AtomicBool>,
    enabled: Arc<AtomicBool>,
    planar: bool,
}

unsafe fn float_samples(buffer: &AudioBuffer) -> Option<&[f32]> {
    let size = buffer.mDataByteSize as usize;
    if size == 0 {
        return Some(&[]);
    }
    if size > 256 * 1024
        || !size.is_multiple_of(size_of::<f32>())
        || buffer.mData.is_null()
        || !(buffer.mData as usize).is_multiple_of(std::mem::align_of::<f32>())
    {
        return None;
    }
    // SAFETY: Core Audio owns this initialized Float32 input storage for the duration of the IOProc.
    Some(unsafe { std::slice::from_raw_parts(buffer.mData.cast(), size / size_of::<f32>()) })
}

unsafe extern "C-unwind" fn input_callback(
    _device: u32,
    _now: NonNull<AudioTimeStamp>,
    input: NonNull<AudioBufferList>,
    _input_time: NonNull<AudioTimeStamp>,
    _output: NonNull<AudioBufferList>,
    _output_time: NonNull<AudioTimeStamp>,
    context: *mut std::ffi::c_void,
) -> i32 {
    // SAFETY: The boxed context is kept alive until IOProc destruction; Core Audio serializes this IOProc.
    let context = unsafe { &mut *context.cast::<CallbackContext>() };
    if !context.enabled.load(Ordering::Relaxed) {
        return 0;
    }
    // SAFETY: Core Audio provides a valid variable-length buffer list for this callback.
    let input = unsafe { input.as_ref() };
    let count = input.mNumberBuffers as usize;
    if count == 0 {
        return 0;
    }
    if count != if context.planar { 2 } else { 1 } {
        context.failed.store(true, Ordering::Relaxed);
        return 0;
    }
    // SAFETY: The number of buffers was checked against the declared tap format before accessing the flexible array.
    let buffers = unsafe { std::slice::from_raw_parts(input.mBuffers.as_ptr(), count) };
    if context.planar {
        // SAFETY: Buffers belong to this IOProc and the tap format is Float32.
        let samples = unsafe { (float_samples(&buffers[0]), float_samples(&buffers[1])) };
        if let (Some(left), Some(right)) = samples {
            if buffers.iter().all(|buffer| buffer.mNumberChannels == 1) && left.len() == right.len()
            {
                context.writer.write_planar(left, right);
                return 0;
            }
        }
    } else {
        // SAFETY: Buffer belongs to this IOProc and the tap format is Float32.
        if let Some(samples) = unsafe { float_samples(&buffers[0]) } {
            if buffers[0].mNumberChannels == 2 && samples.len().is_multiple_of(2) {
                context.writer.write_stereo(samples);
                return 0;
            }
        }
    }
    context.failed.store(true, Ordering::Relaxed);
    0
}

pub struct Capture {
    io_proc: AudioDeviceIOProcID,
    context: Option<Box<CallbackContext>>,
    aggregate: u32,
    tap: u32,
    failed: Arc<AtomicBool>,
    enabled: Arc<AtomicBool>,
    pub sample_rate: u32,
}

impl Drop for Capture {
    fn drop(&mut self) {
        self.enabled.store(false, Ordering::Relaxed);
        // SAFETY: This session owns the IOProc and IDs; callbacks stop before boxed storage is released.
        unsafe {
            if self.io_proc.is_some() {
                let _ = AudioDeviceStop(self.aggregate, self.io_proc);
                if AudioDeviceDestroyIOProcID(self.aggregate, self.io_proc) != 0 {
                    if let Some(context) = self.context.take() {
                        let _ = Box::into_raw(context);
                    }
                }
            }
            if self.aggregate != kAudioObjectUnknown {
                let _ = AudioHardwareDestroyAggregateDevice(self.aggregate);
            }
            if self.tap != kAudioObjectUnknown {
                let _ = AudioHardwareDestroyProcessTap(self.tap);
            }
        }
    }
}

impl Capture {
    pub fn start(
        source: &CaptureSource,
        writer: PcmWriter,
        token: &tokio_util::sync::CancellationToken,
    ) -> Result<Self, String> {
        supported()?;
        ensure_active(token)?;
        let objects = matching_objects(source)?;
        if objects.is_empty() {
            return Err("目标音频进程已退出，请让目标应用播放声音后刷新。".into());
        }
        let numbers: Vec<_> = objects
            .into_iter()
            .map(NSNumber::numberWithUnsignedInt)
            .collect();
        let processes = NSArray::from_retained_slice(&numbers);
        // SAFETY: The array contains only verified Core Audio process object IDs, never raw PIDs.
        let description = unsafe {
            CATapDescription::initStereoMixdownOfProcesses(CATapDescription::alloc(), &processes)
        };
        let uuid = NSUUID::new();
        // SAFETY: These setters operate on the owned description; private, inclusive and unmuted are explicit.
        unsafe {
            description.setUUID(&uuid);
            description.setName(&NSString::from_str("VoxBridge selected process"));
            description.setPrivate(true);
            description.setExclusive(false);
            description.setMuteBehavior(CATapMuteBehavior::Unmuted);
        }
        let mut capture = Self {
            io_proc: None,
            context: None,
            aggregate: kAudioObjectUnknown,
            tap: kAudioObjectUnknown,
            failed: Arc::new(AtomicBool::new(false)),
            enabled: Arc::new(AtomicBool::new(true)),
            sample_rate: 0,
        };
        ensure_active(token)?;
        // SAFETY: The description is valid and output storage belongs to the RAII owner for rollback.
        check(
            unsafe { AudioHardwareCreateProcessTap(Some(&description), &mut capture.tap) },
            "创建目标进程采集",
        )?;
        if capture.tap == kAudioObjectUnknown {
            return Err("系统未创建有效的声音采集对象。".into());
        }
        ensure_active(token)?;
        let format = property(capture.tap, kAudioTapPropertyFormat, empty_format())?;
        capture.sample_rate = validate_format(&format)?;
        let tap_uid = CFString::from_str(&uuid.UUIDString().to_string());
        let aggregate_uid = CFString::from_str(&NSUUID::new().UUIDString().to_string());
        let name = CFString::from_str("VoxBridge private capture");
        let tap = dictionary(&[
            (kAudioSubTapUIDKey, &tap_uid),
            (kAudioSubTapDriftCompensationKey, CFBoolean::new(true)),
        ]);
        let taps = CFArray::from_objects(&[&*tap]);
        let configuration = dictionary(&[
            (kAudioAggregateDeviceNameKey, &name),
            (kAudioAggregateDeviceUIDKey, &aggregate_uid),
            (kAudioAggregateDeviceIsPrivateKey, CFBoolean::new(true)),
            (kAudioAggregateDeviceTapAutoStartKey, CFBoolean::new(false)),
            (kAudioAggregateDeviceTapListKey, &taps),
        ]);
        ensure_active(token)?;
        // SAFETY: The dictionary retains valid CF keys and values; output ID is owned by capture.
        check(
            unsafe {
                AudioHardwareCreateAggregateDevice(
                    configuration.as_opaque(),
                    NonNull::from(&mut capture.aggregate),
                )
            },
            "创建私有采集设备",
        )?;
        if capture.aggregate == kAudioObjectUnknown {
            return Err("系统未创建有效的私有采集设备。".into());
        }
        ensure_active(token)?;
        capture.context = Some(Box::new(CallbackContext {
            writer,
            failed: capture.failed.clone(),
            enabled: capture.enabled.clone(),
            planar: format.mFormatFlags & kAudioFormatFlagIsNonInterleaved != 0,
        }));
        let context = &mut **capture.context.as_mut().unwrap() as *mut CallbackContext;
        // SAFETY: The callback context has a stable boxed address and lives until IOProc destruction.
        check(
            unsafe {
                AudioDeviceCreateIOProcID(
                    capture.aggregate,
                    Some(input_callback),
                    context.cast(),
                    NonNull::from(&mut capture.io_proc),
                )
            },
            "注册采集回调",
        )?;
        if capture.io_proc.is_none() {
            return Err("系统未注册有效的采集回调。".into());
        }
        ensure_active(token)?;
        // SAFETY: IOProc belongs to this aggregate; tap-auto-start waiting is disabled.
        check(
            unsafe { AudioDeviceStart(capture.aggregate, capture.io_proc) },
            "启动声音采集",
        )?;
        ensure_active(token)?;
        Ok(capture)
    }

    pub fn failed(&self) -> bool {
        self.failed.load(Ordering::Relaxed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn raw_float_buffers_are_bounded_aligned_and_non_null() {
        let mut samples = [0.25_f32, -0.25];
        let mut buffer = AudioBuffer {
            mNumberChannels: 2,
            mDataByteSize: std::mem::size_of_val(&samples) as u32,
            mData: samples.as_mut_ptr().cast(),
        };
        // SAFETY: Test storage is an initialized Float32 array with the declared length.
        assert_eq!(unsafe { float_samples(&buffer) }.unwrap(), &[0.25, -0.25]);
        buffer.mDataByteSize = 3;
        // SAFETY: Invalid lengths and pointers are rejected before forming a slice.
        assert!(unsafe { float_samples(&buffer) }.is_none());
        buffer.mDataByteSize = 8;
        buffer.mData = std::ptr::null_mut();
        // SAFETY: A null nonempty buffer is rejected before dereferencing it.
        assert!(unsafe { float_samples(&buffer) }.is_none());
        buffer.mDataByteSize = 0;
        // SAFETY: Empty buffers form an empty slice without touching the data pointer.
        assert!(unsafe { float_samples(&buffer) }.unwrap().is_empty());
        buffer.mDataByteSize = 512 * 1024;
        // SAFETY: Oversized storage is rejected before dereferencing the pointer.
        assert!(unsafe { float_samples(&buffer) }.is_none());
    }

    #[test]
    fn cancelled_initialization_is_rejected_before_native_calls() {
        let token = tokio_util::sync::CancellationToken::new();
        assert!(ensure_active(&token).is_ok());
        token.cancel();
        assert_eq!(ensure_active(&token).unwrap_err(), "采集已停止。");
    }

    #[test]
    #[ignore = "manual read-only macOS process inventory; does not create taps or capture audio"]
    fn process_inventory_does_not_include_this_application() {
        let sources = sources().unwrap();
        assert!(sources
            .iter()
            .all(|source| source.pid > 0 && source.pid as u32 != std::process::id()));
        println!(
            "Enumerated {} audio processes without creating taps or opening streams.",
            sources.len()
        );
    }

    #[test]
    fn format_validation_rejects_invalid_or_unsupported_pcm() {
        let mut format = AudioStreamBasicDescription {
            mFormatID: kAudioFormatLinearPCM,
            mFormatFlags: kAudioFormatFlagIsFloat,
            mBitsPerChannel: 32,
            mChannelsPerFrame: 2,
            mSampleRate: 48000.0,
            ..empty_format()
        };
        assert_eq!(validate_format(&format).unwrap(), 48_000);
        for rate in [f64::NAN, 0.0, 48000.5, 384000.0] {
            format.mSampleRate = rate;
            assert!(validate_format(&format).is_err());
        }
        format.mSampleRate = 48000.0;
        format.mChannelsPerFrame = 1;
        assert!(validate_format(&format).is_err());
        format.mChannelsPerFrame = 2;
        format.mFormatFlags = 0;
        assert!(validate_format(&format).is_err());
    }
}
