---
name: lark-setup
description: 独立した読取専用診断の完了後に、MacまたはWindowsへNode.js/npm、Lark公式CLI、lark-channel-bridgeを不足分だけ正しい順序で導入・接続するLark基盤セットアップ。「診断結果をもとに導入」「不足分を設定」と明示された場合に使う。診断だけの依頼には使わない。
---

# Lark接続基盤セットアップ

このSkillは、独立した `$lark-diagnose` による読取専用診断の後にだけ使う基盤導入入口である。OSをユーザーに選ばせず、診断結果から必要な処理だけへ分岐する。

診断結果がまだ無い場合は、このSkill内で導入へ進まない。先に `$lark-diagnose` を実行し、結果を報告して一度止める。利用者がその後に導入を明示した場合だけ、このSkillを実行する。

## 必須の順序

1. 直前の `$lark-diagnose` の結果を確認し、導入直前の安全な再確認を行う。
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

- 新規案内の最初の入口は診断専用の `$lark-diagnose` とし、基盤導入はその後の `$lark-setup` とする。
- 旧入口 `$lark-bridge-setup` は既存利用者向け互換名として扱う。
- `lark-channel-bridge` はLark公式Channel SDKを利用する上流Bridgeであり、Bridgeパッケージ自体をLark公式製品とは表現しない。
- App Secret、token、credentialをチャット・Git・ログへ出さない。
- 正常なLark CLIやBridgeを再導入しない。
- 診断だけを求められた場合はこのSkillを使わず、`$lark-diagnose` へ切り替える。
