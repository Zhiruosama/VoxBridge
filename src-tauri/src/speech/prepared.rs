//! Bounded, in-memory prefetch. Audio is never persisted and never opens an output stream here.
use super::*;
use std::collections::HashMap;
struct Audio {
    profile: SpeechProfile,
    text: String,
    bytes: Vec<u8>,
}
struct Slot {
    token: CancellationToken,
    audio: Mutex<Option<Audio>>,
}
#[derive(Default)]
struct Registry {
    slots: HashMap<String, Arc<Slot>>,
    cancelled: VecDeque<String>,
}
#[derive(Default)]
pub struct PreparedSpeechState(Arc<Mutex<Registry>>);
impl PreparedSpeechState {
    pub fn stop_all(&self) {
        if let Ok(mut slots) = self.0.lock() {
            for slot in slots.slots.values() {
                slot.token.cancel();
            }
            slots.slots.clear();
            slots.cancelled.clear();
        }
    }
}
struct Guard {
    state: Arc<Mutex<Registry>>,
    id: String,
    slot: Arc<Slot>,
    keep: bool,
}
impl Drop for Guard {
    fn drop(&mut self) {
        if !self.keep {
            if let Ok(mut state) = self.state.lock() {
                if state
                    .slots
                    .get(&self.id)
                    .is_some_and(|s| Arc::ptr_eq(s, &self.slot))
                {
                    state.slots.remove(&self.id);
                }
            }
            self.slot.token.cancel();
        }
    }
}
fn require_main(window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("此操作仅限主窗口。".into())
    }
}
#[tauri::command]
pub async fn prepare_speech(
    window: tauri::WebviewWindow,
    profile: SpeechProfile,
    text: String,
    request_id: String,
    state: tauri::State<'_, PreparedSpeechState>,
) -> Result<(), String> {
    require_main(&window)?;
    if request_id.is_empty()
        || request_id.len() > 128
        || text.trim().is_empty()
        || text.chars().count() > 2000
    {
        return Err("语音准备参数无效。".into());
    }
    let url = endpoint(&profile)?;
    crate::language::speech_language(profile.language.as_deref())?;
    let mut guard = state.reserve(request_id)?;
    let slot = guard.slot.clone();
    let key = tokio::select! {biased; _=slot.token.cancelled()=>return Err(STOPPED.into()), key=crate::credentials::read_async(&profile.id)=>key?};
    let bytes = synthesize_cancellable(&profile, url, &text, &key, &slot.token).await?;
    if slot.token.is_cancelled() {
        return Err(STOPPED.into());
    }
    *slot.audio.lock().map_err(|_| "语音缓存不可用。")? = Some(Audio {
        profile,
        text,
        bytes,
    });
    guard.keep = true;
    Ok(())
}
#[tauri::command]
pub fn discard_prepared_speech(
    window: tauri::WebviewWindow,
    request_id: String,
    state: tauri::State<'_, PreparedSpeechState>,
) -> Result<(), String> {
    require_main(&window)?;
    if request_id.is_empty() || request_id.len() > 128 {
        return Err("请求标识无效。".into());
    }
    state.cancel(&request_id)?;
    Ok(())
}
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn play_prepared_speech(
    window: tauri::WebviewWindow,
    request_id: String,
    routing: Routing,
    route: Route,
    on_progress: tauri::ipc::Channel<SpeechProgress>,
    prepared: tauri::State<'_, PreparedSpeechState>,
    state: tauri::State<'_, SpeechState>,
    gate: tauri::State<'_, AudioGate>,
) -> Result<(), String> {
    require_main(&window)?;
    let audio = prepared.take(&request_id)?;
    execute_inner(
        audio.profile,
        audio.text,
        routing,
        route,
        request_id,
        on_progress,
        &state,
        &gate,
        Some(audio.bytes),
    )
    .await
}

impl PreparedSpeechState {
    fn reserve(&self, id: String) -> Result<Guard, String> {
        let mut registry = self.0.lock().map_err(|_| "语音缓存不可用。")?;
        if let Some(index) = registry.cancelled.iter().position(|old| old == &id) {
            registry.cancelled.remove(index);
            return Err(STOPPED.into());
        }
        if registry.slots.len() >= 2 || registry.slots.contains_key(&id) {
            return Err("语音预备队列已满。".into());
        }
        let slot = Arc::new(Slot {
            token: CancellationToken::new(),
            audio: Mutex::new(None),
        });
        registry.slots.insert(id.clone(), slot.clone());
        Ok(Guard {
            state: self.0.clone(),
            id,
            slot,
            keep: false,
        })
    }
    fn cancel(&self, id: &str) -> Result<(), String> {
        let mut registry = self.0.lock().map_err(|_| "语音缓存不可用。")?;
        if let Some(slot) = registry.slots.remove(id) {
            slot.token.cancel();
        } else {
            if registry.cancelled.len() >= 64 {
                registry.cancelled.pop_front();
            }
            registry.cancelled.push_back(id.into());
        }
        Ok(())
    }
    fn take(&self, id: &str) -> Result<Audio, String> {
        let mut registry = self.0.lock().map_err(|_| "语音缓存不可用。")?;
        let slot = registry.slots.get(id).ok_or("预备语音已过期，请重试。")?;
        let audio = slot
            .audio
            .lock()
            .map_err(|_| "语音缓存不可用。")?
            .take()
            .ok_or("语音尚未准备完成。")?;
        registry.slots.remove(id);
        Ok(audio)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_prefetch_rejects_early_cancel_and_does_not_consume_incomplete_audio() {
        let state = PreparedSpeechState::default();
        state.cancel("early").unwrap();
        assert!(state.reserve("early".into()).is_err());
        let a = state.reserve("a".into()).unwrap();
        let b = state.reserve("b".into()).unwrap();
        assert!(state.reserve("c".into()).is_err());
        assert!(state.take("a").is_err());
        assert_eq!(state.0.lock().unwrap().slots.len(), 2);
        state.cancel("a").unwrap();
        assert!(a.slot.token.is_cancelled());
        let replacement = state.reserve("a".into()).unwrap();
        drop(a);
        assert!(state.0.lock().unwrap().slots.contains_key("a"));
        drop(replacement);
        drop(b);
        assert!(state.0.lock().unwrap().slots.is_empty());
    }
    #[test]
    fn closing_discards_cached_audio_and_cancels_inflight_requests() {
        let state = PreparedSpeechState::default();
        let mut job = state.reserve("cached".into()).unwrap();
        job.keep = true;
        state.stop_all();
        assert!(job.slot.token.is_cancelled());
        assert!(state.0.lock().unwrap().slots.is_empty());
    }
}
