---
name: lark-diagnose
description: MacまたはWindowsのLark接続環境を、インストール・更新・設定変更・起動・再起動を一切せず診断する最初の独立入口。OS/CPU、Node.js/npm、Codex/Claude Code、Lark公式CLI、lark-channel-bridge、既存プロファイルと常駐状態を確認する。「まず診断だけ」「何が入っているか確認」「PCを変更せず確認」と依頼されたとき、また新規導入の最初に使う。
---

# Lark接続環境の診断だけを行う

これは基盤導入ではない。新規導入で最初に実行する、独立した読取専用の診断である。

## 絶対条件

- パッケージをインストール、更新、削除しない。
- 設定ファイルやプロファイルを作成、編集、置換しない。
- Bridgeを起動、停止、再起動しない。
- 認証を開始せず、QRコードやデバイスコードを発行しない。
- 秘密情報、token、credential、App Secret、設定値の本文を表示しない。
- 診断後に `$lark-setup` を自動実行しない。

## 実行

このSkillの二階層上をPluginルートとして解決し、OSに応じて同梱の診断スクリプトをTerminalまたはPTYで実行する。

- Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\terminal-diagnose.ps1`
- macOS / Linux: `bash <plugin-root>/scripts/terminal-diagnose.sh`

OSをユーザーに選ばせない。実行環境から自動判定する。診断スクリプトが不足や未導入を報告しても、それは診断結果であり、修復を開始してはならない。

## 報告形式

次の順に、各項目を「正常」「不足」「要確認」で短く報告する。

1. OS / CPU
2. Node.js / npm
3. Codex / Claude Code
4. Lark公式CLI `@larksuite/cli`
5. `lark-channel-bridge`
6. 既存プロファイル / 常駐状態

最後に「PCの状態は変更していない」と明記する。不足がある場合は、次の選択肢として `$lark-setup` を案内するだけに留める。利用者が改めて基盤導入を依頼した場合だけ、別Skillの `$lark-setup` へ進む。

