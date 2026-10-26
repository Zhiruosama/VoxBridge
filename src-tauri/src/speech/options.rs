//! MiniMax-only synthesis controls, validated before opening a paid request.
use super::*;

#[derive(Clone, Deserialize)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct SpeechOptions {
    emotion: String,
    volume: f64,
    pitch: i32,
    effect_pitch: i32,
    intensity: i32,
    timbre: i32,
    sound_effect: String,
    pronunciation: Vec<String>,
}
impl Default for SpeechOptions {
    fn default() -> Self {
        Self {
            emotion: "auto".into(),
            volume: 1.0,
            pitch: 0,
            effect_pitch: 0,
            intensity: 0,
            timbre: 0,
            sound_effect: "none".into(),
            pronunciation: vec![],
        }
    }
}
impl SpeechOptions {
    pub(super) fn validate(&self, model: &str) -> Result<(), String> {
        if !self.volume.is_finite()
            || !(0.1..=10.0).contains(&self.volume)
            || !(-12..=12).contains(&self.pitch)
            || [self.effect_pitch, self.intensity, self.timbre]
                .iter()
                .any(|n| !(-100..=100).contains(n))
        {
            return Err("语音参数超出允许范围。".into());
        }
        let supported = match self.emotion.as_str() {
            "auto" => true,
            "fluent" | "whisper" => matches!(model, "speech-2.6-hd" | "speech-2.6-turbo"),
            "happy" | "sad" | "angry" | "fearful" | "disgusted" | "surprised" | "calm" => matches!(
                model,
                "speech-2.8-hd"
                    | "speech-2.8-turbo"
                    | "speech-2.6-hd"
                    | "speech-2.6-turbo"
                    | "speech-02-hd"
                    | "speech-02-turbo"
                    | "speech-01-hd"
                    | "speech-01-turbo"
            ),
            _ => false,
        };
        if !supported {
            return Err("当前模型不支持所选语音情绪，请选择自动。".into());
        }
        if !matches!(
            self.sound_effect.as_str(),
            "none" | "spacious_echo" | "auditorium_echo" | "lofi_telephone" | "robotic"
        ) {
            return Err("不支持的语音情绪或音效。".into());
        }
        if self.pronunciation.len() > 50
            || self
                .pronunciation
                .iter()
                .filter(|line| !line.trim().is_empty())
                .any(|line| {
                    line.len() > 300
                        || line.chars().any(char::is_control)
                        || !line
                            .split_once('/')
                            .is_some_and(|(a, b)| !a.trim().is_empty() && !b.trim().is_empty())
                })
        {
            return Err("发音替换最多 50 行，每行使用“原词/读法”，且不超过 300 字节。".into());
        }
        Ok(())
    }
}

pub(super) fn task_start(profile: &SpeechProfile, streaming: bool) -> Result<Value, String> {
    let options = &profile.speech_options;
    options.validate(&profile.model_id)?;
    let mut task = json!({"event":"task_start", "model":profile.model_id,
        "language_boost":crate::language::speech_language(profile.language.as_deref())?,
        "voice_setting":{"voice_id":profile.voice,"speed":profile.speed},
        "audio_setting":{"sample_rate":32000,"bitrate":128000,"format":if streaming {"pcm"} else {"mp3"},"channel":1}});
    if options.emotion != "auto" {
        task["voice_setting"]["emotion"] = json!(options.emotion);
    }
    if options.volume != 1.0 {
        task["voice_setting"]["vol"] = json!(options.volume);
    }
    if options.pitch != 0 {
        task["voice_setting"]["pitch"] = json!(options.pitch);
    }
    if options.effect_pitch != 0
        || options.intensity != 0
        || options.timbre != 0
        || options.sound_effect != "none"
    {
        task["voice_modify"] = json!({"pitch":options.effect_pitch, "intensity":options.intensity, "timbre":options.timbre});
        if options.sound_effect != "none" {
            task["voice_modify"]["sound_effects"] = json!(options.sound_effect);
        }
    }
    let pronunciation: Vec<_> = options
        .pronunciation
        .iter()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    if !pronunciation.is_empty() {
        task["pronunciation_dict"] = json!({"tone":pronunciation});
    }
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defaults_omit_overrides_and_custom_controls_reach_streaming_and_buffered_requests() {
        let mut profile =
            super::super::tests::profile("minimax_tts_ws", "wss://example.com".into());
        profile.model_id = "speech-2.8-turbo".into();
        let original = task_start(&profile, true).unwrap();
        assert!(original.get("voice_modify").is_none());
        assert!(original["voice_setting"].get("emotion").is_none());
        profile.speech_options = serde_json::from_value(json!({"emotion":"calm","volume":1.2,"pitch":-2,"effectPitch":5,"intensity":20,"timbre":-10,"soundEffect":"robotic","pronunciation":["VoxBridge/vox bridge"]})).unwrap();
        for streaming in [true, false] {
            let request = task_start(&profile, streaming).unwrap();
            assert_eq!(request["voice_setting"]["emotion"], "calm");
            assert_eq!(request["voice_setting"]["vol"], 1.2);
            assert_eq!(request["voice_setting"]["pitch"], -2);
            assert_eq!(request["voice_modify"]["intensity"], 20);
            assert_eq!(request["voice_modify"]["sound_effects"], "robotic");
            assert_eq!(
                request["pronunciation_dict"]["tone"][0],
                "VoxBridge/vox bridge"
            );
            assert_eq!(
                request["audio_setting"]["format"],
                if streaming { "pcm" } else { "mp3" }
            );
        }
    }
    #[test]
    fn rejects_unsupported_controls_before_network_and_checks_model_specific_emotions() {
        for change in [
            json!({"volume":0}),
            json!({"pitch":13}),
            json!({"intensity":101}),
            json!({"emotion":"whisper"}),
            json!({"soundEffect":"private"}),
            json!({"pronunciation":["invalid"]}),
        ] {
            let options: SpeechOptions = serde_json::from_value(change).unwrap();
            assert!(options.validate("speech-2.8-hd").is_err());
        }
        let whisper: SpeechOptions = serde_json::from_value(json!({"emotion":"whisper"})).unwrap();
        assert!(whisper.validate("speech-2.6-hd").is_ok());
    }
}
