# VoxBridge

[简体中文](README.md) · **English** · [日本語](README.ja.md)

[Download](https://github.com/Zhiruosama/VoxBridge/releases) · [User guide (中文)](docs/user-guide.md) · [Report an issue](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge is a real-time voice translation app for Mac. Turn an app’s audio into bilingual captions, or translate typed text and recorded speech into a synthesized voice that you can send to Discord and other chat apps through a virtual microphone.

![VoxBridge workspace with bilingual captions and text input](docs/assets/workspace-overview.png)

_Interface demo with example captions._

## What you can do

- **Listen and read:** choose an app and see live original and translated captions.
- **Speak or type:** record your voice or type a message, review it before sending, or enable direct voice sending.
- **Keep captions nearby:** read across desktops and full-screen spaces, and type or record from the floating window.
- **Choose your voice:** switch models, voices and speech speed, with a separate local monitoring toggle.

## Download and install

Download the [**0.2.0 test DMG**](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.0), open it, and drag VoxBridge into Applications.

The available installer supports **Apple Silicon Macs running macOS 14.2 or later**. No developer tools are needed. This test release is not notarized, so macOS may block the first launch. See the [release notes (中文)](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.0) for instructions.

## Get started

### 1. Set up your services

In Settings, configure **speech recognition, translation and speech synthesis**, then enter and save your own API keys. For captions only, you just need recognition and translation. Saved keys are restored when you reopen the app.

Presets include Qwen, DeepSeek and MiniMax, with support for matching compatible APIs. Providers may charge for usage. Audio and text are sent to the providers you select. See [service setup (中文)](docs/user-guide.md#服务配置).

### 2. Read translated captions

Play audio in the app you want to follow, select it in VoxBridge, and start listening. Allow system audio recording when prompted. Open **Floating captions** to read above other windows. Change the caption language in Settings.

### 3. Speak in Discord

1. Install the bundled **virtual microphone** from Settings → General → Audio. Administrator approval is required; end any active calls first.
2. Set VoxBridge’s **send device** to VoxBridge and its **monitoring device** to the system default or your headphones.
3. In Discord’s voice settings, select VoxBridge as the **input device**. Keep your headphones or speakers as the output device.
4. In VoxBridge, choose the output language, type a message or record with the microphone button, then send. The headphone button controls local monitoring.

Discord is the main tested chat app. QQ and WeChat compatibility is still being improved. If there is no sound or the device is missing, see [troubleshooting (中文)](docs/user-guide.md#常见问题).

## More

[Detailed user guide (中文)](docs/user-guide.md) · [Development and packaging (中文)](docs/development.md) · [Architecture (中文)](docs/02-architecture.md) · [Issues and suggestions](https://github.com/Zhiruosama/VoxBridge/issues)
