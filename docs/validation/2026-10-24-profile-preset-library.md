# User-managed model and voice presets

[验证索引](README.md) · [当前使用指南](../user-guide.md)

> 历史验证记录：仅说明记录日期的测试范围，不代表所有平台、客户端或后续构建均通过。

- Each service configuration owns optional model/voice preset lists. Entries contain only a name, value and adapter. Libraries are scoped by profile and protocol; model lists work for ASR, translation and synthesis, while voice lists belong to synthesis only.
- Settings → corresponding model service → Custom presets supports adding, editing and deleting entries. Complete the editor, then use the existing Save changes action. Saving does not create another credential profile, read/copy a key or switch providers.
- Choices appear before builtin options under My presets in settings and the speech quick menu. Matching builtin IDs get one named alias, not duplicate menu choices. User-defined IDs remain callable through the selected protocol; adding a preset does not implement a new backend protocol.
- Editing the ID of a selected preset updates that selected ID. Deleting an entry leaves the selected raw ID usable as Current custom, preserving output behavior and credentials. Existing settings without libraries retain their original values.
- Bound each library to 50 entries, names to 80 characters, values to 200 UTF-8 bytes with control characters prohibited. Reject duplicate IDs within the same protocol. Storage parsing whitelists public fields and strips unknown credential fields.

## Validation

- 122 frontend tests passed. New coverage: public-field-only persistence, backward compatibility, profile/protocol isolation, builtin aliases, edit/delete selection behavior, duplicate/empty/oversized values and limits. Existing in-flight synthesis snapshot tests still pass.
- Production build and formatting passed; signed macOS application packaging and microphone entitlement verification passed.
- UI test used actual App/SettingsPanel/SpeechPicker components and simulated IPC/providers. Added named model and cloned voice entries, rejected duplicate IDs, selected the custom voice during listening, and submitted speech. Mock speech received my-cloned-voice-01; capture remained starts=1, stops=0. Edited the selected preset to my-cloned-voice-02 / a new name, verified selection followed the edit, added/deleted a temporary entry, and reloaded. Saved model/voice names and IDs persisted and remained in My presets. No live provider request or microphone recording occurred.
- Local ignored screenshots: native/macos/.build/preset-library-settings.png and native/macos/.build/preset-library-quick.png. User's running app and settings were not changed; packaged changes load on restart.
