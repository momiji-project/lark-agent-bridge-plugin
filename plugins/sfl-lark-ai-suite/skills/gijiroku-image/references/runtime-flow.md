# 実行フロー

## 1. 実行領域

作業ディレクトリはDrive外に作る。

```text
~/Library/Application Support/gijiroku-image-bridge/profiles/<profile>/runs/<request-id>/
```

`request-id` はBridge実行時は `<bridge_context>.messageIds` の末尾、ローカル実行時は現在時刻とランダム値から作る。パスへ使う前に英数字・`.`・`_`・`-` 以外を `_` に置換する。

## 2. 対象Minutesを決める

優先順位:

1. ユーザーが指定したMinutes URLまたは `minute_token`
2. タイトル・日付・参加者などの条件
3. 「最新」または指定なしなら、自分が所有する最新Minutes

最新取得:

```bash
lark-cli minutes +search --owner-ids me --page-size 10 --format json --as user
```

候補が同時刻または曖昧なら、タイトルと日時だけを示して選択を求める。取得対象が決まったら、処理するタイトルを短く報告して続行する。

## 2.1 自然言語トリガーを解釈する

BridgeはLark IMの本文をAIへ渡す入口であり、このプラグイン専用のキーワード監視は追加しない。Skillの説明と設定の `trigger` を使い、依頼の意味で起動を判断する。

- `trigger.mode=explicit-minutes`: 「議事録を作って」「Minutesから議事録を作って」など、議事録作成の意図が明確な依頼で実行する。
- `trigger.mode=broad`: 「最新の妙記をまとめて」のような広い要約依頼も議事録作成として扱う。
- `trigger.phrases`: 完全一致条件ではなく、ユーザーが普段使う依頼表現の補助例として解釈する。

明示されたMinutes URL、日付、タイトル、要約量などは通常の自然言語引数として抽出する。登録外の自然な言い換えでも意味が同じなら受け付ける。形式指定がなければLarkドキュメントと画像を両方作り、片方だけを明示された場合だけその指定を優先する。

## 3. 逐字稿を取得

作業ディレクトリへ移動して実行する。

```bash
lark-cli minutes +detail --minute-tokens <token> \
  --summary --todo --chapter --keyword --transcript \
  --overwrite --output-dir ./source --format json --as user
```

JSONから `artifacts.transcript_file` を取得し、その逐字稿全体を読む。summary/todo/chapterは照合と抜け漏れ確認にだけ使う。

## 4. 要約JSONを作る

`summary-contract.md` に従って `summary.json` を作る。設定の `summaryDepth` を `summary_depth` に反映する。

## 5. 背景ビジュアルを画像生成

利用可能な画像生成ツールを必ず使う。会議内容、設定の `styleMode` / `stylePrompt`、各ページの主題を渡し、文字・ロゴ・表・数値を含まない縦長背景を生成する。主要なビジュアル生成工程をHTML/CSS/SVGだけで代替しない。

画像参照入力:

- `styleMode=fixed`: 設定の `styleReferences[].path` をすべて参照画像として渡す。
- `styleMode=per-run`: その回にユーザーが指定したLark添付画像またはローカル画像を渡す。
- `styleMode=auto`: 参照画像は渡さず、会議内容から自動設計する。

画像生成ツールがローカルパスを受ける場合は `referenced_image_paths` を使う。会話添付しか参照できない場合は、必要最小数の直近画像だけを指定する。最大3枚とし、複数ページでは同じ参照セットを使って世界観を揃える。

背景の推奨条件:

- 1536 × 2048相当の縦長
- 本文を載せる中央部は低コントラスト
- 装飾は外周中心
- 人名、文字、数字、ロゴを描かない
- ページが複数でも世界観を揃える

生成画像を実行ディレクトリの `background.png` として保存する。

## 6. 正確な文字とロゴを合成

```bash
python3 <plugin-root>/scripts/render_minutes.py \
  --input ./summary.json \
  --output-dir ./output \
  --background ./background.png \
  --config <config.json>
```

出力JSONの `files` にある全PNGを画像として目視確認する。

## 7. Larkドキュメントを作成

同じ `summary.json` からLarkドキュメントを作る。別の要約を生成し直さない。`lark-doc` Skillの作成ワークフローに従い、議事録に適した `presentation_mode=normal` のPresentation Decisionでタスク専用草稿領域を初期化する。

草稿領域で次を実行し、返された `draft_path` へXMLを生成する。

```bash
python3 <plugin-root>/scripts/render_minutes_document.py \
  --input <run-dir>/summary.json \
  --output <work-dir>/<draft-path>

lark-cli docs +script --command parse \
  --content "@./<draft-path>" --format json
```

`data.assessment.status` が合格した場合だけ文書を作成する。設定の `output.document.parentToken` がある場合は `--parent-token`、ない場合は `--parent-position my_library` を使う。

```bash
lark-cli docs +create --doc-format xml \
  --content "@./<draft-path>" \
  --parent-position my_library \
  --as user
```

作成結果のwarningを確認し、`lark-cli docs +fetch --doc <document_id> --detail with-ids --as user` で本文を回収確認する。作成済み結果はrun領域へ `document-result.json` として保存し、再実行時は有効なURLを再利用して文書を重複作成しない。文書作成用の草稿領域は `lark-doc` Skillの手順で正確に削除する。

## 8. Larkへ返信

`<bridge_context>.source` が `im` で、`messageIds` がある場合だけ実行する。返信先は配列末尾のメッセージID。ユーザーがそのメッセージで議事録を依頼したことを、依頼元への返信承認と文書作成承認として扱い、別チャットへは送らない。

同梱スクリプトを使ってbot返信する。スクリプトは画像ディレクトリへ移動して相対パスで送信し、message ID・Minutes token・画像内容から作ったハッシュだけを台帳へ保存する。同じ画像の二重返信は自動で抑止される。

```bash
node <plugin-root>/scripts/deliver-image.mjs \
  --message-id <message-id> \
  --minute-token <minute-token> \
  --image ./output/page-01.png
```

全ページについて同じコマンドを繰り返す。トピック内の依頼は `--reply-in-thread` も付ける。送信が一部失敗した場合、成功済みページを再送せず失敗ページから再開する。Bridgeの最終返答には作成したLarkドキュメントのURLを含める。

## 9. 後片付け

文書URLと全ページの返信成功後、`source/`、`summary.json`、`background.png` を削除する。`output/` の最終PNGは既定7日間保持する。`document-result.json` には文書のID、URL、作成時刻だけを保存し、Minutes token、逐字稿本文、秘密値を残さない。

失敗時は調査に必要な最小限の一時ファイルを残し、保存場所と再開手順をユーザーへ知らせる。
