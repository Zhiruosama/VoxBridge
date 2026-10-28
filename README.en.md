# VoxBridge

[简体中文](README.md) · **English** · [日本語](README.ja.md)

[Download](https://github.com/Zhiruosama/VoxBridge/releases) · [Get started (中文)](docs/guides/getting-started.md) · [Documentation (中文)](docs/README.md) · [Report an issue](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge is a translation app for macOS and Windows. Read bilingual captions from another app's audio, translate typed text, or turn your text and recordings into speech for Discord and other voice chat apps through a virtual microphone.

![VoxBridge workspace](docs/assets/workspace-overview.png)

_Interface example with sample captions._

## What you can do

- **Text translation:** type or watch copied text, translate manually or automatically, and view results in a small floating window.
- **Live captions:** choose an app and read its original and translated speech.
- **Speak through text or recording:** review your input, generate speech and independently control local monitoring.
- **Floating window:** read captions above other windows, type or record without returning to the main window.
- **Voice and appearance settings:** choose services, models, voices and speed; adjust caption colors, size and panel appearance.

## Install

Choose an installer from [Releases](https://github.com/Zhiruosama/VoxBridge/releases). No development tools are required.

| Computer | File | Installation |
| --- | --- | --- |
| Apple Silicon Mac, macOS 14.2+ | `aarch64.dmg` | Open and drag VoxBridge into Applications |
| Windows 11, Intel / AMD | `x64-setup.exe` | Run the installer |
| Windows ARM64 | `arm64-setup.exe` | Experimental; audio hardware validation is pending |

The Mac app is not Developer ID-signed or notarized, and Windows installers are not Authenticode-signed. Follow the [installation guide (中文)](docs/guides/getting-started.md) and consult the release notes for each build's validation scope.

## Start using it

1. Configure your model services and save your own API keys. **Text-only translation needs only a translation service.**
2. Choose **Text translation** to type, or **Captions** to select an app and start listening.
3. To send generated speech into a chat app, configure speech synthesis and a virtual microphone. Local monitoring is a separate control.

Saved keys persist across restarts. Cloud providers may charge for requests and receive the text or audio you submit. Installers do not include API keys, service credit or private cloned voices.

## Find the right guide

| Task | Guide (中文) |
| --- | --- |
| First installation and setup | [Get started](docs/guides/getting-started.md) |
| Configure models, keys and voices | [Services](docs/guides/services.md) |
| Translate text | [Text translation](docs/guides/text-translation.md) |
| Read live captions | [Listening and floating captions](docs/guides/listening.md) |
| Send speech into Discord | [Voice input and virtual microphone](docs/guides/voice-output.md) |
| Fix audio, permissions or service errors | [Troubleshooting](docs/guides/troubleshooting.md) |

Development, architecture and historical records are organized in the [documentation center (中文)](docs/README.md).

## License

VoxBridge's own code is licensed under [PolyForm Noncommercial](LICENSE), permitting noncommercial use, modification and distribution under its terms. Commercial use requires separate permission. This is a source-available project, not an open-source license permitting commercial use.

Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
