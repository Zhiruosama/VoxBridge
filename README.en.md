# VoxBridge

[简体中文](README.md) · **English** · [日本語](README.ja.md)

[Download](https://github.com/Zhiruosama/VoxBridge/releases) · [User guide (中文)](docs/user-guide.md) · [Report an issue](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge is a real-time voice translation app for **macOS and Windows**. Turn an app’s audio into bilingual captions, or translate typed text and recorded speech into a synthesized voice that you can send to Discord and other chat apps through a virtual microphone.

The Windows 11 x64 implementation is available on the development branch and has been tested locally. A public Windows release is not available yet; the published 0.2.1 download is still Mac-only.

![VoxBridge workspace with bilingual captions and text input](docs/assets/workspace-overview.png)

_Interface demo with example captions._

## What you can do

- **Listen and read:** choose an app and see live original and translated captions.
- **Speak or type:** record your voice or type a message, review it before sending, or enable direct voice sending.
- **Keep captions nearby:** read across desktops and full-screen spaces, and type or record from the floating window.
- **Choose your voice:** switch models, voices and speech speed, with a separate local monitoring toggle.

## Download and install

| Platform | Status | Installation |
| --- | --- | --- |
| macOS 14.2+ · Apple Silicon | Published 0.2.1 test release | Download the [DMG](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.1) and drag VoxBridge into Applications |
| Windows 11 · x64 | Implemented and tested locally; not publicly released | Build the NSIS EXE from [`codex/windows-support`](https://github.com/Zhiruosama/VoxBridge/tree/codex/windows-support), or sign in to GitHub to download the `windows-nsis` artifact from a successful [Check workflow](https://github.com/Zhiruosama/VoxBridge/actions/workflows/check.yml) run |

Installers include the frontend and native app; developer tools are needed only for source builds. The Mac test release is not notarized; see its [release notes (中文)](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.1). See the [Windows installation guide (中文)](docs/windows-installation.md) for driver setup, updates that preserve settings, and removal. Windows 10, ARM64 and other Windows environments have not been validated.


The development branch also includes startup update checks, signed in-app updates, Windows microphone access guidance and DPAPI credential protection. Native Windows ARM64 CI tests and installer builds have passed; experimental artifacts are available as `windows-arm64-nsis`. Real ARM64 audio hardware still needs validation. The older published Mac 0.2.1 does not include the new update controls.

## Get started

### 1. Set up your services

In Settings, configure **speech recognition, translation and speech synthesis**, then enter and save your own API keys. For captions only, you just need recognition and translation. Saved keys are restored when you reopen the app.

Presets include Qwen, DeepSeek and MiniMax, with support for matching compatible APIs. Providers may charge for usage. Audio and text are sent to the providers you select. See [service setup (中文)](docs/user-guide.md#服务配置).

### 2. Read translated captions

Play audio in the app you want to follow, select it in VoxBridge, and start listening. Allow system audio recording when prompted. Open **Floating captions** to read above other windows. Change the caption language in Settings.

### 3. Speak in Discord

1. On Mac, install the VoxBridge virtual microphone from Settings → General → Audio. On Windows, install the bundled **VB-CABLE** during VoxBridge setup or from Settings, then restart Windows as instructed. Driver installation requires administrator approval; end active calls first.
2. Choose the **send device** in the table below, and use the system default or headphones for **local monitoring**.
3. Select the corresponding **input device** in your chat app. Keep headphones or speakers as its output device.
4. In VoxBridge, choose the output language, type a message or record with the microphone button, then send. The headphone button controls local monitoring.

| Platform | VoxBridge send device | Chat app input device |
| --- | --- | --- |
| macOS | VoxBridge | VoxBridge |
| Windows | CABLE Input (VB-Audio Virtual Cable) | CABLE Output (VB-Audio Virtual Cable) |

Windows uses the original, signed base VB-CABLE driver from VB-Audio. Source: [www.vb-cable.com](https://vb-audio.com/Cable/). VB-CABLE is donationware; contributions are welcome.

Discord is the main tested chat app on Mac. Windows virtual microphone audio loopback has passed local testing; actual calls in Discord, Oopz and KOOK still need validation. Other chat apps are not guaranteed compatible. See [troubleshooting (中文)](docs/user-guide.md#常见问题).

## More

[Detailed user guide (中文)](docs/user-guide.md) · [Development and packaging (中文)](docs/development.md) · [Architecture (中文)](docs/02-architecture.md) · [Issues and suggestions](https://github.com/Zhiruosama/VoxBridge/issues)
