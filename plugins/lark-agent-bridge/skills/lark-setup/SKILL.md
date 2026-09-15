---
name: lark-setup
description: MacまたはWindowsのPCを最初に自動診断し、Node.js/npm、Lark公式CLI、lark-channel-bridgeを不足分だけ正しい順序で導入・接続する、Lark連携の標準初期セットアップ入口。ユーザーが「Lark連携を導入」「最初から診断」「Mac/Windows共通で設定」「議事録を使えるように」と依頼したときに使う。
---

# Lark接続基盤セットアップ

新規導入では、このSkillを唯一の標準入口として扱う。OSをユーザーに選ばせず、診断結果から必要な処理だけへ分岐する。

## 必須の順序

1. 設定を変更しない診断を最初に行う。
2. Node.js 20.12以上とnpmが不足している場合だけ、変更内容を説明して承認を得てからNode.js LTSを導入する。
3. Lark公式CLI `@larksuite/cli` を確認・導入する。
4. 公式CLIが正常になった後で `lark-channel-bridge` を確認・導入する。
5. QR登録、プロファイル設定、常駐起動、Lark IMの往復確認を行う。
6. 議事録を使う場合だけ、Minutes/DocsのQR付きデバイス認証を完了する。
7. Bridgeの疎通確認後に、別Plugin `sfl-gijiroku` の導入へ進む。

完了済みの層は再インストールせず再利用する。失敗した層より先へ進まない。既存プロファイルを黙って置換・複製しない。

## 実行

このSkillの二階層上をPluginルートとして解決する。OSに応じて同梱ウィザードを対話可能なTerminalまたはPTYで実行する。

- Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\terminal-setup.ps1`
- macOS / Linux: `bash <plugin-root>/scripts/terminal-setup.sh`

ユーザーが議事録利用を明示済みなら、Windowsでは `-PersonalLark`、macOS / Linuxでは `--personal-lark` を付け、同じ質問を繰り返さない。チャット返信だけを明示した場合はbot-onlyを使う。目的が不明な場合だけ、議事録も使うかを一度確認する。

ウィザードはOS・CPU、Node.js、npm、対応AI、Lark公式CLI、Bridgeを先に読み取り診断し、既存の正常なものを飛ばす。Node.js追加などPCを変更する操作は、必ず内容を示して承認後に実行する。認証方式は選択させず、Bridge登録はQR、Minutes/DocsはQR付きデバイスフローを標準にする。

## 議事録Pluginへの継続

ユーザーが議事録も希望し、Lark IMの往復確認まで成功した場合だけ、`codex plugin list` で `sfl-gijiroku@momiji-lark-tools` の有無を確認する。未導入なら、今回の依頼に議事録導入が明記されている場合に限り次を実行する。

```bash
codex plugin add sfl-gijiroku@momiji-lark-tools
```

Plugin追加後は新しいCodexセッションが必要だと伝え、次の入口だけを案内する。

```text
$gijiroku-setup おすすめ設定で初期設定してください
```

議事録Pluginの要約・画像・ロゴ設定をこのSkill内で代行しない。`sfl-gijiroku` がBridge本体や既存プロファイルを変更しないという境界を維持する。

## 互換性と安全

- 旧入口 `$lark-bridge-setup` は既存利用者向け互換名として扱う。新規案内では `$lark-setup` を使う。
- `lark-channel-bridge` はLark公式Channel SDKを利用する上流Bridgeであり、Bridgeパッケージ自体をLark公式製品とは表現しない。
- App Secret、token、credentialをチャット・Git・ログへ出さない。
- 正常なLark CLIやBridgeを再導入しない。
- 診断だけを求められた場合は変更せず、`lark-bridge-doctor` 相当の読取結果を返す。
