# VoxBridge

[简体中文](README.md) · [English](README.en.md) · **日本語**

[ダウンロード](https://github.com/Zhiruosama/VoxBridge/releases) · [はじめに（中国語）](docs/guides/getting-started.md) · [ドキュメント（中国語）](docs/README.md) · [不具合の報告](https://github.com/Zhiruosama/VoxBridge/issues)

VoxBridge は macOS と Windows 向けの翻訳アプリです。他のアプリの音声を原文・訳文の字幕で表示し、入力したテキストや録音した音声を翻訳・音声合成して、仮想マイクから Discord などの音声チャットへ送ることができます。

![VoxBridge ワークスペース](docs/assets/workspace-overview.png)

_字幕はサンプルを使用した画面イメージです。_

## できること

- **テキスト翻訳**：入力した文章やコピーした文字を手動・自動で翻訳し、小さなフローティングウィンドウにも表示できます。
- **翻訳字幕**：対象アプリを選び、原文と翻訳をリアルタイムで確認できます。
- **音声での発言**：入力や録音を確認してから音声を生成。自分で聞くモニター音声も個別に切り替えられます。
- **フローティングウィンドウ**：他のウィンドウの上で字幕を読み、その場で入力・録音できます。
- **音声と外観の設定**：サービス、モデル、声、速度を選び、字幕の色や大きさ、パネルの外観を調整できます。

## インストール

[Releases](https://github.com/Zhiruosama/VoxBridge/releases) から、お使いのパソコンに合うインストーラを選んでください。開発ツールは不要です。

| パソコン | ファイル | インストール方法 |
| --- | --- | --- |
| Apple Silicon Mac、macOS 14.2 以降 | `aarch64.dmg` | 開いて「アプリケーション」にドラッグ |
| Windows 11、Intel / AMD | `x64-setup.exe` | インストーラを実行 |
| Windows ARM64 | `arm64-setup.exe` | 実験的な対応。音声ハードウェアの検証は未完了 |

Mac アプリは Developer ID 署名・公証未実施、Windows アプリは Authenticode 未署名です。[インストールガイド（中国語）](docs/guides/getting-started.md) と、各配布物のリリースノートを確認してください。

## 使い始めるには

1. 使用するモデルサービスと自分の API Key を設定して保存します。**文章の翻訳だけなら、文字翻訳サービスのみで利用できます。**
2. 左側の「文本翻译」で文章を入力するか、「字幕」でアプリを選んで音声を読み取ります。
3. チャットアプリに合成音声を送る場合は、音声合成と仮想マイクを設定します。自分で聞く音声は別のスイッチで調整できます。

保存したキーは再起動後も利用できます。クラウドサービスは従量課金の場合があり、入力した文章や音声が選択したプロバイダーへ送信されます。API Key、利用枠、個人のクローン音声は付属しません。

## 目的別ガイド

| 目的 | ガイド（中国語） |
| --- | --- |
| 初めてのインストールと設定 | [はじめに](docs/guides/getting-started.md) |
| モデル・キー・声の設定 | [サービス設定](docs/guides/services.md) |
| 文章を翻訳する | [テキスト翻訳](docs/guides/text-translation.md) |
| 翻訳字幕を読む | [音声の読み取りと字幕](docs/guides/listening.md) |
| Discord に音声を送る | [音声入力と仮想マイク](docs/guides/voice-output.md) |
| 音声・権限・サービスの不具合 | [トラブルシューティング](docs/guides/troubleshooting.md) |

開発、アーキテクチャ、過去の記録は[ドキュメント一覧（中国語）](docs/README.md)にまとめています。
