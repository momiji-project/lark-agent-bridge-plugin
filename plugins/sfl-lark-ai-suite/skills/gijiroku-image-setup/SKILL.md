---
name: gijiroku-image-setup
description: Lark Minutes画像議事録プラグインの初回設定または再設定を対話形式で行う。ユーザーが画像議事録Bridgeを導入・セットアップしたい、要約量、画像テイスト、参考画像、ロゴ、Lark IMでの自然言語トリガーを変更したい、または設定を確認したいと言ったときに使う。
---

# 画像議事録 Bridge セットアップ

既存の `lark-channel-bridge` がLark IMとAIを接続済みであることを前提に、画像議事録の個人設定だけを行う。Bridge本体、LaunchAgent、Cloudflare、既存プラグインの設定は変更しない。

## 絶対ルール

- 質問は一度に一つだけ行う。未回答の項目をまとめて聞かない。
- ユーザーが「おすすめ」「おまかせ」「簡単に」「一括」と明示した場合はクイック設定を使い、個別項目を聞き直さない。
- レイアウトは設定項目にしない。会議内容と要約量から実行時に自動決定する。
- 設定保存前に回答内容を短く一覧化し、ユーザーの確認を取る。
- ロゴ画像はユーザーが指定したものだけを使う。勝手に生成・検索しない。
- 参考画像は構図の完全コピーではなく、色・質感・余白・装飾などのデザイン参照として扱う。
- 自然言語トリガーはAIの意味理解によるSkill選択であり、BridgeのWebhookやキーワード監視設定ではないと説明する。
- Lark認証が必要な場合、グループチャットでは認証を開始せず、botとの個人チャットへ誘導する。
- 設定ファイルへ秘密値、逐字稿、Lark token、チャットIDを保存しない。

## セットアップ手順

### クイック設定

ユーザーがクイック設定を希望した場合は、次の安全な初期値を短く提示して一度に適用する。クイック設定の依頼自体を承認として扱い、保存前の再確認は行わない。

- 要約量: `standard`
- 画像テイスト: `auto`
- ロゴ: `none`
- 起動範囲: `explicit-image`

```bash
node <plugin-root>/scripts/gijiroku-config.mjs set \
  --summary standard \
  --style-mode auto \
  --logo-mode none \
  --trigger-mode explicit-image
```

保存後は「7. 動作確認」へ進む。既存の正常な設定がある場合は上書きせず、現在値を保持するかだけ確認する。

### 1. 現在設定を確認

このSkillの場所からプラグインルートを解決し、次を実行する。

```bash
node <plugin-root>/scripts/gijiroku-config.mjs show
```

未設定でもエラー扱いにはせず、そのまま質問へ進む。再設定の場合は現在値も選択肢に添える。

### 2. 要約量を質問

次の3択を説明して選んでもらう。

- `short`: 短い。決定事項と次の行動を中心に、原則1枚。
- `standard`: 標準。要旨・重要論点・決定事項・タスクを、原則1〜2枚。
- `detailed`: 詳細。背景・論点・決定・タスク・未解決事項まで、原則2〜4枚。

### 3. 画像テイストを質問

次の3択から選んでもらう。

- `auto`: 会議内容に合わせて毎回AIへ任せる。
- `fixed`: 毎回同じテイストにする。選択後、ニュアンスの自由文と参考画像の有無を別々に聞く。
- `per-run`: 議事録作成のたびに希望を聞く。その回のLark添付画像も参考にできる。

固定テイストでも、カード位置や段組などのレイアウトは固定しない。

`fixed` の場合は、次の順で一つずつ確認する。

1. 色、雰囲気、媒体感、避けたい表現などのニュアンスを自由文で指定するか。
2. PNG/JPEG/WebPの参考画像を保存するか。最大3枚。Lark添付の場合は `<user_input>.attachments` のローカルパス、デスクトップの場合はユーザーが示したファイルパスを使う。

ニュアンス文と参考画像は少なくとも一方を必須にする。画像を指定されたら読めることを確認し、プレビューまたはファイル名を示す。人物・ロゴ・文章などをそのまま複製せず、デザイン上の特徴だけを参照すると伝える。

### 4. ロゴを質問

次の2択から選んでもらう。

- `none`: 入れない。
- `always`: 指定したロゴを毎回入れる。

`always` の場合はPNG/JPEG/WebPの画像を指定してもらう。Lark添付の場合は `<user_input>.attachments` のローカルパス、デスクトップの場合はユーザーが示したファイルパスを使う。画像が読めることを確認し、プレビューまたはファイル名を示してから保存する。

### 5. Lark IMでの起動範囲を質問

自然言語で起動でき、スラッシュコマンドは不要であることを説明して次の2択から選んでもらう。

- `explicit-image`（推奨）: 「画像議事録を作って」「このMinutesをビジュアル化して」など、画像化の意図がある依頼だけで起動する。既存の文書議事録Skillと衝突しにくい。
- `broad`: 「議事録を作って」「最新の妙記をまとめて」など、一般的な議事録依頼も画像議事録として扱う。

続けて、普段使いたい言い方を追加登録するか一度だけ聞く。登録する文言は最大10件で、「議事録」「Minutes」「妙記」のいずれかを含む自然な依頼文にする。これは完全一致キーワードではなく、意味判定の補助例として保存する。

### 6. 確認後に保存

回答を一覧化し、ユーザーが了承したら次を実行する。`--style-prompt`、`--style-reference`、`--logo-source`、`--trigger-phrase` は該当時だけ付ける。参考画像と呼び方はオプションを繰り返せる。

```bash
node <plugin-root>/scripts/gijiroku-config.mjs set \
  --summary standard \
  --style-mode auto \
  --logo-mode none \
  --trigger-mode explicit-image
```

固定スタイルと追加の呼び方を保存する例:

```bash
node <plugin-root>/scripts/gijiroku-config.mjs set \
  --summary standard \
  --style-mode fixed \
  --style-prompt "落ち着いたネイビー、上質な紙の質感、装飾は控えめ" \
  --style-reference /path/to/reference-01.png \
  --style-reference /path/to/reference-02.jpg \
  --logo-mode always \
  --logo-source /path/to/logo.png \
  --trigger-mode explicit-image \
  --trigger-phrase "最新のMinutesを一枚で見える化して"
```

Bridge実行中は `LARK_CHANNEL_PROFILE` が自動的に設定プロファイル名になる。デスクトップから特定Bridgeプロファイルを設定する場合だけ `--profile <name>` を付ける。

### 7. 動作確認

```bash
<plugin-root>/scripts/selfcheck.sh
```

`lark-cli auth status --json --verify` でuser認証が無い場合は、個人チャットで次の二段階認証を行う。

1. `lark-cli auth login --domain minutes --no-wait --json`
2. 返されたURLを改変せず提示し、QRコードも生成する。
3. ユーザーが承認完了を伝えた次のターンで `lark-cli auth login --device-code <device_code>` をAI自身が実行する。

セットアップ完了時は、選んだ起動範囲と登録した言い方に沿った依頼例を2つ示す。Bridge側の追加設定は不要で、次のLarkメッセージから利用できると案内する。
