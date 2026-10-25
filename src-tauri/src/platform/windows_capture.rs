//! WASAPI process-tree loopback. Interfaces and COM live on one owned MTA worker.
use crate::{capture::CaptureSource, pcm::PcmWriter};
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;
use windows::{
    core::{implement, Interface, Ref, HRESULT, PWSTR},
    Win32::{
        Foundation::{CloseHandle, FILETIME, HANDLE, WAIT_FAILED},
        Media::Audio::*,
        System::{
            Com::{
                CoInitializeEx, CoUninitialize, StructuredStorage::*, BLOB, COINIT_MULTITHREADED,
            },
            Threading::{
                CreateEventW, GetProcessTimes, OpenProcess, QueryFullProcessImageNameW,
                WaitForSingleObject, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
            },
            Variant::VT_BLOB,
        },
    },
};

const RATE: u32 = 48_000;
const GONE: &str = "目标音频进程已退出或改变，请刷新后重新监听。";

#[path = "windows_capture/inventory.rs"]
mod inventory;
pub use inventory::sources;

struct Handle(HANDLE);
impl Drop for Handle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

pub(crate) fn supported() -> Result<(), String> {
    // RtlGetVersion reports the actual build, independently of compatibility manifests.
    #[link(name = "ntdll")]
    unsafe extern "system" {
        fn RtlGetVersion(
            info: *mut windows::Win32::System::SystemInformation::OSVERSIONINFOW,
        ) -> i32;
    }
    let mut info = windows::Win32::System::SystemInformation::OSVERSIONINFOW {
        dwOSVersionInfoSize: std::mem::size_of::<
            windows::Win32::System::SystemInformation::OSVERSIONINFOW,
        >() as u32,
        ..Default::default()
    };
    if unsafe { RtlGetVersion(&mut info) } < 0 || info.dwBuildNumber < 20348 {
        Err("应用声音采集需要 Windows build 20348 或更高版本。".into())
    } else {
        Ok(())
    }
}

#[derive(Clone)]
struct ProcessIdentity {
    path: String,
    created: u64,
    id: String,
}

fn process_identity(pid: u32) -> Result<ProcessIdentity, String> {
    unsafe {
        let process =
            Handle(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).map_err(|_| GONE)?);
        let mut path = [0u16; 32768];
        let mut size = path.len() as u32;
        QueryFullProcessImageNameW(
            process.0,
            PROCESS_NAME_WIN32,
            PWSTR(path.as_mut_ptr()),
            &mut size,
        )
        .map_err(|_| GONE)?;
        let mut created = FILETIME::default();
        let (mut exit, mut kernel, mut user) = (
            FILETIME::default(),
            FILETIME::default(),
            FILETIME::default(),
        );
        GetProcessTimes(process.0, &mut created, &mut exit, &mut kernel, &mut user)
            .map_err(|_| GONE)?;
        let path = String::from_utf16_lossy(&path[..size as usize]);
        let digest = ring::digest::digest(&ring::digest::SHA256, path.to_lowercase().as_bytes());
        let birth = (u64::from(created.dwHighDateTime) << 32) | u64::from(created.dwLowDateTime);
        let id = format!("windows:{}:{birth:016x}", hex::encode(digest.as_ref()));
        Ok(ProcessIdentity {
            path,
            created: birth,
            id,
        })
    }
}

fn identity(pid: u32) -> Result<String, String> {
    process_identity(pid).map(|process| process.id)
}

#[cfg(test)]
pub(crate) fn source_for_pid(pid: u32) -> Result<CaptureSource, String> {
    Ok(CaptureSource {
        pid: pid as i32,
        bundle_id: identity(pid)?,
        name: "Controlled test audio".into(),
        app_scoped: false,
    })
}

fn application_id(id: &str) -> Option<&str> {
    let (app, birth) = id.rsplit_once(':')?;
    (app.starts_with("windows:")
        && app.len() == 72
        && birth.len() == 16
        && birth.bytes().all(|c| c.is_ascii_hexdigit()))
    .then_some(app)
}

fn select_source(
    original: &CaptureSource,
    candidates: Vec<CaptureSource>,
) -> Result<CaptureSource, String> {
    if let Some(exact) = candidates
        .iter()
        .find(|s| s.pid == original.pid && s.bundle_id == original.bundle_id)
    {
        return Ok(exact.clone());
    }
    let app = application_id(&original.bundle_id).ok_or(GONE)?;
    let mut matches = candidates
        .into_iter()
        .filter(|s| application_id(&s.bundle_id) == Some(app));
    let source = matches.next().ok_or("正在等待目标应用恢复声音进程。")?;
    if matches.next().is_some() {
        return Err("目标应用有多个音频进程，请刷新后重新选择。".into());
    }
    Ok(source)
}

pub fn recover_source(original: &CaptureSource) -> Result<CaptureSource, String> {
    if original.pid > 0 && identity(original.pid as u32).is_ok_and(|id| id == original.bundle_id) {
        return Ok(original.clone());
    }
    select_source(original, sources()?)
}

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Activation {
    sender: mpsc::SyncSender<windows::core::Result<IAudioClient>>,
    // The async operation can outlive a cancelled caller. Keep its borrowed BLOB alive.
    _params: Arc<AUDIOCLIENT_ACTIVATION_PARAMS>,
}

impl IActivateAudioInterfaceCompletionHandler_Impl for Activation_Impl {
    fn ActivateCompleted(
        &self,
        operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let result = (|| unsafe {
            let mut status = HRESULT(0);
            let mut object = None;
            operation
                .ok()?
                .GetActivateResult(&mut status, &mut object)?;
            status.ok()?;
            object
                .ok_or_else(windows::core::Error::from_thread)?
                .cast::<IAudioClient>()
        })();
        let _ = self.sender.try_send(result);
        Ok(())
    }
}

struct Com;
impl Com {
    fn enter() -> Result<Self, String> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok() }
            .map_err(|_| "无法初始化 Windows 音频线程。")?;
        Ok(Self)
    }
}
impl Drop for Com {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

struct StartedClient(IAudioClient);
impl Drop for StartedClient {
    fn drop(&mut self) {
        unsafe {
            let _ = self.0.Stop();
        }
    }
}

fn activate(pid: u32, stop: &CancellationToken) -> Result<IAudioClient, String> {
    let params = Arc::new(AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    });
    // Borrowed BLOB: Windows' PROPVARIANT Drop calls PropVariantClear. Suppress it
    // for this view; ownership belongs to the completion handler's Arc instead.
    let variant = std::mem::ManuallyDrop::new(PROPVARIANT {
        Anonymous: PROPVARIANT_0 {
            Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                vt: VT_BLOB,
                Anonymous: PROPVARIANT_0_0_0 {
                    blob: BLOB {
                        cbSize: std::mem::size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
                        pBlobData: Arc::as_ptr(&params) as *mut u8,
                    },
                },
                ..Default::default()
            }),
        },
    });
    let (tx, rx) = mpsc::sync_channel(1);
    let handler: IActivateAudioInterfaceCompletionHandler = Activation {
        sender: tx,
        _params: params,
    }
    .into();
    let _operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &handler,
        )
    }
    .map_err(|_| "无法启动应用声音采集，请检查 Windows 版本与音频服务。")?;
    let deadline = Instant::now() + Duration::from_secs(10);
    loop {
        if stop.is_cancelled() {
            return Err("采集已停止。".into());
        }
        match rx.recv_timeout(Duration::from_millis(25)) {
            Ok(result) => return result.map_err(|_| "无法激活目标应用声音采集。".into()),
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                return Err("无法激活目标应用声音采集。".into())
            }
            Err(_) if Instant::now() >= deadline => {
                return Err("音频系统暂时不可用：应用采集启动超时。".into())
            }
            Err(_) => {}
        }
    }
}

fn run(
    source: &CaptureSource,
    mut writer: PcmWriter,
    stop: &CancellationToken,
    ready: &mpsc::SyncSender<Result<(), String>>,
) -> Result<(), String> {
    let _com = Com::enter()?;
    if stop.is_cancelled() {
        return Err("采集已停止。".into());
    }
    if identity(source.pid as u32)? != source.bundle_id {
        return Err(GONE.into());
    }
    let client = activate(source.pid as u32, stop)?;
    let format = WAVEFORMATEX {
        wFormatTag: 1,
        nChannels: 2,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * 4,
        nBlockAlign: 4,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    unsafe {
        let event =
            Handle(CreateEventW(None, false, false, None).map_err(|_| "无法创建音频采集事件。")?);
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK,
                0,
                0,
                &format,
                None,
            )
            .map_err(|_| "无法初始化应用采集音频格式。")?;
        client
            .SetEventHandle(event.0)
            .map_err(|_| "无法设置音频采集事件。")?;
        let input: IAudioCaptureClient =
            client.GetService().map_err(|_| "无法获取应用采集缓冲。")?;
        client.Start().map_err(|_| "无法启动应用音频流。")?;
        let _started = StartedClient(client);
        if ready.send(Ok(())).is_err() {
            return Ok(());
        }
        let mut samples = Vec::with_capacity(8192);
        let mut seen_packet = false;
        while !stop.is_cancelled() {
            if WaitForSingleObject(event.0, 25) == WAIT_FAILED {
                return Err("监听采集设备已断开或发生错误。".into());
            }
            let mut packets = 0;
            while !stop.is_cancelled()
                && input
                    .GetNextPacketSize()
                    .map_err(|_| "监听采集设备已断开或发生错误。")?
                    > 0
            {
                let (mut data, mut frames, mut flags) = (std::ptr::null_mut(), 0, 0);
                input
                    .GetBuffer(&mut data, &mut frames, &mut flags, None, None)
                    .map_err(|_| "监听采集设备已断开或发生错误。")?;
                // GetBuffer must be paired with ReleaseBuffer even for invalid packets.
                let valid = frames <= RATE * 2
                    && (flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || !data.is_null());
                if valid {
                    samples.clear();
                    if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                        samples.resize(frames as usize * 2, 0.0);
                    } else {
                        for sample in
                            std::slice::from_raw_parts(data as *const i16, frames as usize * 2)
                        {
                            samples.push(f32::from(*sample) / 32768.0);
                        }
                    }
                    if flags & AUDCLNT_BUFFERFLAGS_DATA_DISCONTINUITY.0 as u32 != 0 && seen_packet {
                        writer.mark_discontinuity();
                    }
                    writer.write_stereo(&samples);
                    seen_packet = true;
                }
                input
                    .ReleaseBuffer(frames)
                    .map_err(|_| "监听采集设备已断开或发生错误。")?;
                if !valid {
                    return Err("应用采集返回无效音频缓冲。".into());
                }
                packets += 1;
                if packets >= 32 {
                    break;
                }
            }
        }
    }
    Ok(())
}

pub struct Capture {
    pub sample_rate: u32,
    stop: CancellationToken,
    failed: Arc<AtomicBool>,
    worker: Option<JoinHandle<()>>,
    identity: String,
}
impl Capture {
    pub fn start(
        source: &CaptureSource,
        writer: PcmWriter,
        token: &CancellationToken,
    ) -> Result<Self, String> {
        supported()?;
        if token.is_cancelled() {
            return Err("采集已停止。".into());
        }
        if source.pid <= 0
            || source.pid as u32 == std::process::id()
            || application_id(&source.bundle_id).is_none()
        {
            return Err("请选择其他应用的有效音频进程。".into());
        }
        let stop = token.child_token();
        let failed = Arc::new(AtomicBool::new(false));
        let mut capture = Self {
            sample_rate: RATE,
            stop: stop.clone(),
            failed: failed.clone(),
            worker: None,
            identity: source.bundle_id.clone(),
        };
        let source = source.clone();
        let (tx, rx) = mpsc::sync_channel(1);
        capture.worker = Some(
            std::thread::Builder::new()
                .name("wasapi-loopback".into())
                .spawn(move || {
                    if let Err(error) = run(&source, writer, &stop, &tx) {
                        failed.store(true, Ordering::Release);
                        let _ = tx.try_send(Err(error));
                    }
                })
                .map_err(|_| "无法创建应用采集线程。")?,
        );
        loop {
            if token.is_cancelled() {
                return Err("采集已停止。".into());
            }
            match rx.recv_timeout(Duration::from_millis(25)) {
                Ok(result) => {
                    result?;
                    return Ok(capture);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    return Err("无法启动应用音频流。".into())
                }
                Err(_) => {}
            }
        }
    }
    pub fn source_current(&self, source: &CaptureSource) -> bool {
        identity(source.pid as u32).is_ok_and(|id| id == self.identity)
    }
    pub fn failed(&self) -> bool {
        self.failed.load(Ordering::Acquire)
    }
}
impl Drop for Capture {
    fn drop(&mut self) {
        self.stop.cancel();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source(pid: i32, app: char, birth: u64) -> CaptureSource {
        CaptureSource {
            pid,
            bundle_id: format!("windows:{}:{birth:016x}", app.to_string().repeat(64)),
            name: "app".into(),
            app_scoped: false,
        }
    }
    #[test]
    fn recovery_uses_process_instance_then_unique_application_identity() {
        let original = source(10, 'a', 1);
        assert_eq!(
            select_source(&original, vec![original.clone(), source(20, 'a', 2)])
                .unwrap()
                .pid,
            10
        );
        assert_eq!(
            select_source(&original, vec![source(10, 'b', 2), source(20, 'a', 3)])
                .unwrap()
                .pid,
            20
        );
        assert!(select_source(&original, vec![source(10, 'b', 2)]).is_err());
        assert!(select_source(&original, vec![source(20, 'a', 3), source(30, 'a', 4)]).is_err());
        assert!(application_id("chrome.exe").is_none());
    }
    #[test]
    fn early_cancel_never_activates_audio() {
        let token = CancellationToken::new();
        token.cancel();
        let (writer, _, _) = crate::pcm::channel(16);
        assert!(Capture::start(&source(10, 'a', 1), writer, &token).is_err());
    }
    #[test]
    #[ignore = "manual read-only Windows application inventory; no audio streams"]
    fn windows_inventory_has_exact_process_identities() {
        let list = sources().unwrap();
        assert!(!list.is_empty());
        for source in list {
            assert_eq!(identity(source.pid as u32).unwrap(), source.bundle_id);
            assert_ne!(source.pid as u32, std::process::id());
            assert!(!source.name.contains(['\\', '/']));
            println!("WINDOWS_CAPTURE_APP: {}", source.name);
        }
    }
}
