/// UI language names are stable settings values, independent of the UI locale.
/// Automatic detection intentionally omits the provider's language parameter.
pub(super) fn code(language: &str) -> Option<&'static str> {
    match language {
        "简体中文" | "繁体中文" => Some("zh"),
        "粤语" => Some("yue"),
        "英语" => Some("en"),
        "日语" => Some("ja"),
        "韩语" => Some("ko"),
        "印尼语" => Some("id"),
        "芬兰语" => Some("fi"),
        "俄语" => Some("ru"),
        "德语" => Some("de"),
        "法语" => Some("fr"),
        "西班牙语" => Some("es"),
        "葡萄牙语" => Some("pt"),
        "意大利语" => Some("it"),
        "越南语" => Some("vi"),
        "泰语" => Some("th"),
        "阿拉伯语" => Some("ar"),
        "印地语" => Some("hi"),
        _ => None,
    }
}
