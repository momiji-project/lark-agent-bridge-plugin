---
name: lark-setup
description: 既存の統合Plugin利用者向けに、MacまたはWindowsのPCを最初に自動診断し、Node.js/npm、Lark公式CLI、Bridge、議事録設定を完了済みの層を飛ばしながら順番に整える標準入口。新規配布では分離版Pluginを優先する。
---

# Larkセットアップ（統合Plugin互換入口）

この統合Pluginを既に利用している環境では、`sfl-lark-setup` の実行手順を使い、必ず読取診断から開始する。OSをユーザーに選ばせない。

1. OS・CPU、Node.js、npm、対応AI、Lark公式CLI、Bridge、既存プロファイル、議事録設定を診断する。
2. Node.js/npmが不足している場合だけ、説明と承認後にNode.js LTSを導入する。
3. Lark公式CLIを先に、Bridgeを後に整える。
4. QR登録とLark IMの往復を確認する。
5. 議事録を希望する場合だけMinutes/Docs認証と議事録設定へ進む。

正常な層を再導入せず、失敗した層より先へ進まない。新規利用者には、接続基盤Plugin `lark-agent-bridge` と議事録Plugin `sfl-gijiroku` を分ける現行構成を案内する。
