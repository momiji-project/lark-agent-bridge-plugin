---
name: sfl-lark-setup
description: Lark Agent Bridgeと、Larkドキュメント・共有用画像を一緒に作る議事録機能を、一つのPluginから最小限の質問でまとめて初期設定する。ユーザーが「Larkを使えるようにして」「Bridgeと議事録を一括導入」「おすすめ設定でセットアップ」「SFL Lark AI Suiteを設定」と依頼したときに使う。Bridgeだけの導入、既存設定を保持した再実行、詳細設定にも対応する。
---

# SFL Lark かんたんセットアップ

Bridgeと議事録の設定を一つの導線で完了する。議事録はLarkドキュメントと共有用画像をセットで出力する。既存設定を優先し、回答が必要な項目だけを一度に一つずつ確認する。

## セットアップ方式

- ユーザーが「一括」「おすすめ」「簡単に」と指定した場合は `おすすめ一括` を選ぶ。方式を聞き直さない。
- Bridgeだけを求めた場合は `Bridgeのみ` を選び、議事録設定を変更しない。
- ロゴ、固定テイスト、参考画像、詳細な要約量を指定した場合は `詳細設定` を選ぶ。
- 意図が不明な場合だけ、`おすすめ一括`、`Bridgeのみ`、`詳細設定` のどれにするか一度だけ聞く。

`おすすめ一括` の議事録設定は次で固定する。

- 要約量: `standard`
- 画像テイスト: `auto`
- ロゴ: `none`
- Larkドキュメント: 有効（My Spaceへ作成）
- 共有用画像: 有効
- 自然言語トリガー: `explicit-minutes`

この設定は安全な初期値であり、導入後に `gijiroku-image-setup` で変更できる。ユーザーが明示的におすすめ一括を依頼したことを、この設定の適用承認として扱い、同じ内容を再確認しない。

## 実行手順

### 1. 現状を読む

このSkillの二階層上をPluginルートとして解決し、次を実行する。

```bash
node <plugin-root>/scripts/bridge-manager.mjs preflight --json
node <plugin-root>/scripts/bridge-manager.mjs doctor --json
node <plugin-root>/scripts/gijiroku-config.mjs show
```

既存のBridgeプロファイルまたは議事録設定が正常なら再作成せず、そのまま使う。旧設定は設定スクリプトがLarkドキュメント＋画像の形式へ互換移行する。重複プロファイルを作らない。秘密値を表示しない。

### 2. Bridgeを準備する

Bridgeが未設定または不完全な場合だけ、同梱の `lark-bridge-setup` の手順に従う。

- 対応AIが一つなら自動選択する。Claude CodeとCodexの両方がある場合だけ選択を聞く。
- 作業フォルダは現在の安全なプロジェクトルートを候補として示し、確定できない場合だけ聞く。`/`、ホーム、システム領域、一時領域は拒否する。
- 権限は `safe-edit` を既定にする。`full` は明示的な承認がある場合だけ使う。
- インストールはdry-runを表示してから実行する。
- QR登録はユーザー自身に承認してもらう。App Secretをチャットへ貼らせない。
- 新しく設定したプロファイルだけを起動する。既存の停止中プロファイルを勝手に起動しない。

### 3. 議事録を準備する

`Bridgeのみ` ではこの手順を行わない。

既存設定が正常なら保持する。未設定で `おすすめ一括` の場合だけ、Bridgeで選んだprofile名を使って次を実行する。

```bash
node <plugin-root>/scripts/gijiroku-config.mjs set \
  --profile <profile> \
  --summary standard \
  --style-mode auto \
  --logo-mode none \
  --trigger-mode explicit-minutes
```

`詳細設定` の場合は `gijiroku-image-setup` に従い、質問を一度に一つだけ行う。

### 4. 認証と動作確認

```bash
<plugin-root>/scripts/selfcheck.sh
node <plugin-root>/scripts/bridge-manager.mjs doctor --profile <profile> --json
lark-channel-bridge status --profile <profile>
```

Lark Minutesのuser認証が無い場合は、グループチャットで開始せずBotとの個人チャットへ案内する。`lark-cli auth login --domain minutes --no-wait --json` のURLを改変せず提示し、承認後にdevice codeを使って完了する。

最後にユーザーへLarkで次を送ってもらう。

- `/status`
- `最新のMinutesから議事録を作って`

ローカル診断が正常で、Larkから返信が確認できた時だけ完了とする。未完了なら、残っているユーザー操作を一つだけ明示する。

## 禁止事項

- 既存Plugin、既存プロファイル、手書きの `CLAUDE.md` / `AGENTS.md` を削除・上書きしない。
- 正常な設定をおすすめ値で上書きしない。
- 認証情報、Minutes token、逐字稿、チャットIDを設定やログへ残さない。
- Bridge導入に一時的な `npx` 実行を使わない。
