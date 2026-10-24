//! Conservative offline detection: uncertain or mixed-language input uses translation.
pub fn detect(text: &str) -> Option<&'static str> {
    let language = recognize(text)?;
    // A dominant language is insufficient when the input also contains another script.
    let latin = text.chars().any(|c| c.is_ascii_alphabetic());
    let han = text.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c));
    let kana = text.chars().any(|c| ('\u{3040}'..='\u{30ff}').contains(&c));
    let hangul = text.chars().any(|c| ('\u{ac00}'..='\u{d7af}').contains(&c));
    if (latin && (han || kana || hangul)) || (hangul && (han || kana)) {
        return None;
    }
    if language == "简体中文" && kana {
        return None;
    }
    Some(language)
}

#[cfg(target_os = "macos")]
fn recognize(text: &str) -> Option<&'static str> {
    use objc2::{class, msg_send, rc::Retained, runtime::AnyObject};
    use objc2_foundation::{NSDictionary, NSNumber, NSString};
    #[link(name = "NaturalLanguage", kind = "framework")]
    unsafe extern "C" {}
    // Each recognizer is local to this call; all objects are owned and released on this thread.
    let (code, confidence) = unsafe {
        let recognizer: Retained<AnyObject> = msg_send![class!(NLLanguageRecognizer), new];
        let _: () = msg_send![&*recognizer, processString: &*NSString::from_str(text)];
        let language: Option<Retained<NSString>> = msg_send![&*recognizer, dominantLanguage];
        let language = language?;
        let probabilities: Retained<NSDictionary<NSString, NSNumber>> =
            msg_send![&*recognizer, languageHypothesesWithMaximum: 1usize];
        let probability = probabilities.objectForKey(&language)?.doubleValue();
        (language.to_string(), probability)
    };
    if confidence < 0.8 {
        return None;
    }
    match code.as_str() {
        "en" => Some("英语"),
        "zh-Hans" | "zh-Hant" | "zh" => Some("简体中文"),
        "ja" => Some("日语"),
        "ko" => Some("韩语"),
        "es" => Some("西班牙语"),
        "id" => Some("印尼语"),
        "fi" => Some("芬兰语"),
        _ => None,
    }
}

#[cfg(not(target_os = "macos"))]
fn recognize(text: &str) -> Option<&'static str> {
    let info = whatlang::detect(text)?;
    if !info.is_reliable() {
        return None;
    }
    Some(match info.lang() {
        whatlang::Lang::Eng => "英语",
        whatlang::Lang::Cmn => "简体中文",
        whatlang::Lang::Jpn => "日语",
        whatlang::Lang::Kor => "韩语",
        whatlang::Lang::Spa => "西班牙语",
        whatlang::Lang::Ind => "印尼语",
        whatlang::Lang::Fin => "芬兰语",
        _ => return None,
    })
}

#[tauri::command]
pub fn detect_text_language(text: String) -> Result<Option<String>, String> {
    if text.chars().count() > 500 {
        return Err("语言识别内容超过 500 字。".into());
    }
    Ok(detect(&text).map(str::to_owned))
}

pub fn speech_language(language: Option<&str>) -> Result<&'static str, String> {
    match language {
        None => Ok("auto"),
        Some("英语") => Ok("English"),
        Some("简体中文") => Ok("Chinese"),
        Some("日语") => Ok("Japanese"),
        Some("韩语") => Ok("Korean"),
        Some("西班牙语") => Ok("Spanish"),
        Some("印尼语") => Ok("Indonesian"),
        Some("粤语") => Ok("Chinese,Yue"),
        Some("芬兰语") => Ok("Finnish"),
        _ => Err("不支持所选语音语言。".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[cfg(target_os = "macos")]
    fn recognizes_short_chat_messages_and_leaves_unsupported_language_uncertain() {
        for (text, expected) in [
            ("Hello, how are you?", "英语"),
            ("你好，最近怎么样？", "简体中文"),
            ("こんにちは、元気ですか？", "日语"),
            ("안녕하세요, 잘 지내세요?", "韩语"),
            ("Hola, ¿cómo estás?", "西班牙语"),
        ] {
            assert_eq!(detect(text), Some(expected));
        }
        assert_eq!(detect("Guten Morgen, wie geht es dir heute?"), None);
    }
    #[test]
    #[cfg(target_os = "macos")]
    fn identifies_supported_languages_without_trusting_source_setting() {
        for (text, language) in [
            (
                "This is a wonderful day and I would like to talk to my friends.",
                "英语",
            ),
            ("我现在想和我的朋友们一起聊天，今天天气非常好。", "简体中文"),
            (
                "今日はとてもいい天気ですね。友達と一緒に話したいです。",
                "日语",
            ),
            (
                "오늘은 날씨가 정말 좋습니다. 친구들과 함께 이야기하고 싶습니다.",
                "韩语",
            ),
            (
                "Hoy hace muy buen tiempo y quiero hablar con todos mis amigos.",
                "西班牙语",
            ),
        ] {
            assert_eq!(detect(text), Some(language), "{language}");
        }
        assert_eq!(detect("Saya sedang belajar bahasa Indonesia. Hari ini saya ingin berbicara dengan teman-teman saya tentang rencana perjalanan kami ke Jakarta."), Some("印尼语"));
        assert_eq!(detect("Tänään on kaunis päivä ja haluaisin jutella ystävieni kanssa. Mitä sinulle kuuluu?"), Some("芬兰语"));
        assert_eq!(detect("123 😊"), None);
        assert_eq!(detect("我想说 hello, how are you today?"), None);
    }
    #[test]
    fn rejects_unknown_speech_language_instead_of_falling_back_to_english() {
        for (language, expected) in [
            ("英语", "English"),
            ("简体中文", "Chinese"),
            ("日语", "Japanese"),
            ("韩语", "Korean"),
            ("西班牙语", "Spanish"),
            ("印尼语", "Indonesian"),
            ("粤语", "Chinese,Yue"),
            ("芬兰语", "Finnish"),
        ] {
            assert_eq!(speech_language(Some(language)).unwrap(), expected);
        }
        assert!(speech_language(Some("unsupported")).is_err());
        assert_eq!(speech_language(None).unwrap(), "auto");
    }
}
