# VoxBridge

[简体中文](README.md) · [English](README.en.md) · **日本語**

[ダウンロード](https://github.com/Zhiruosama/VoxBridge/releases) · [使い方（中国語）](docs/user-guide.md) · [不具合の報告](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge は **macOS と Windows** 向けのリアルタイム音声翻訳アプリです。アプリの音声を原文・訳文の字幕で表示できます。入力したテキストや録音した音声を翻訳・音声合成し、仮想マイクを通じて Discord などのチャットアプリに送ることもできます。

Windows 11 x64 版は開発ブランチで実装・実機テスト済みですが、インストーラはまだ一般公開していません。公開済みの 0.2.1 は Mac 版です。

![VoxBridge：原文・訳文の字幕とテキスト入力画面](docs/assets/workspace-overview.png)

_字幕はサンプルを使用した画面イメージです。_

## できること

- **聞いて読む**：対象アプリを選び、原文と翻訳字幕をリアルタイムで確認。
- **話す・入力する**：録音やテキスト入力に対応。内容を確認してから送信するほか、音声の直接送信も選択可能。
- **字幕を持ち歩く**：デスクトップや全画面表示を切り替えても字幕を表示。フローティングウィンドウから入力・録音も可能。
- **声を選ぶ**：モデル・音声・話す速度を変更し、自分で聞くモニター音声を個別にオン・オフ。

## ダウンロードとインストール

| プラットフォーム | 現在の状態 | インストール |
| --- | --- | --- |
| macOS 14.2 以降 · Apple Silicon | 0.2.1 テスト版を公開済み | [DMG](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.1) を開き「アプリケーション」にドラッグ |
| Windows 11 · x64 | 実装・実機テスト済み、一般公開前 | [`codex/windows-support`](https://github.com/Zhiruosama/VoxBridge/tree/codex/windows-support) から NSIS EXE をビルド、または GitHub にログインし成功した [Check ワークフロー](https://github.com/Zhiruosama/VoxBridge/actions/workflows/check.yml) の `windows-nsis` 成果物を取得 |

インストーラから使う場合は開発ツール不要です。Mac テスト版は公証されていません。初回起動の対処は[リリースノート（中国語）](https://github.com/Zhiruosama/VoxBridge/releases/tag/v0.2.1)を参照してください。Windows のドライバ導入、設定を保持する更新、アンインストールは [Windows インストールガイド（中国語）](docs/windows-installation.md)に記載しています。Windows 10、ARM64 などは未検証です。


開発ブランチには起動時の更新確認、署名付きアプリ内更新、Windows のマイク権限案内、DPAPI による認証情報保護も追加しています。Windows ARM64 はネイティブ CI テストとインストーラ生成を確認済みで、`windows-arm64-nsis` に実験的な成果物があります。実機の音声デバイスは未検証です。公開済みの旧 Mac 0.2.1 に新しい更新ボタンは含まれていません。

## 使い始める

### 1. サービスを設定する

設定画面で**音声認識・翻訳・音声合成**サービスを選び、ご自身の API キーを入力して保存します。字幕だけを使う場合は、音声認識と翻訳の設定だけで利用できます。保存したキーは再起動後も引き継がれます。

Qwen・DeepSeek・MiniMax などのプリセットと、対応する互換 API を利用できます。サービスの利用料金が発生する場合があり、音声やテキストは選択したサービスに送信されます。詳しくは[サービス設定（中国語）](docs/user-guide.md#服务配置)をご覧ください。

### 2. 翻訳字幕を見る

対象アプリで音声を再生し、VoxBridge でそのアプリを選んでリスニングを開始します。システム音声の録音許可を求められたら許可してください。**フローティング字幕**を開くと、ほかのウィンドウの上に字幕を表示できます。字幕の翻訳先言語は設定画面で変更できます。

### 3. Discord で音声を送る

1. Mac は「設定 → 一般 → オーディオ」から VoxBridge 仮想マイクをインストールします。Windows は VoxBridge インストーラまたは設定から同梱の **VB-CABLE** を導入し、案内に従って PC を再起動します。ドライバ導入は管理者承認が必要です。通話を終了してから行ってください。
2. VoxBridge の**送信デバイス**を下表の端点に、**モニターデバイス**をシステムデフォルトまたはヘッドホンに設定します。
3. チャットアプリの**入力デバイス**を対応する端点にします。出力デバイスはヘッドホンやスピーカーのままにします。
4. VoxBridge で出力言語を選び、テキストを入力するかマイクボタンで録音して送信します。ヘッドホンボタンで自分へのモニター音声を切り替えられます。

| プラットフォーム | VoxBridge の送信デバイス | チャットアプリの入力デバイス |
| --- | --- | --- |
| macOS | VoxBridge | VoxBridge |
| Windows | CABLE Input (VB-Audio Virtual Cable) | CABLE Output (VB-Audio Virtual Cable) |

Windows は VB-Audio の署名済み基本版 VB-CABLE を使用し、公式のデバイス名を保持します。提供元：[www.vb-cable.com](https://vb-audio.com/Cable/)。VB-CABLE はドネーションウェアです。作者への支援を歓迎します。

Mac は主に Discord で確認しています。Windows は仮想マイクのローカル音声ループバックを確認済みですが、Discord・Oopz・KOOK の実通話は未検証です。すべてのチャットアプリの互換性を保証するものではありません。[よくある質問（中国語）](docs/user-guide.md#常见问题)もご確認ください。

## 詳しく知る

[使い方の詳細（中国語）](docs/user-guide.md) · [開発とビルド（中国語）](docs/development.md) · [アーキテクチャ（中国語）](docs/02-architecture.md) · [不具合・機能の提案](https://github.com/Zhiruosama/VoxBridge/issues)
