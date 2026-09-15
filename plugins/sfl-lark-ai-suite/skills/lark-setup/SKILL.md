---
name: lark-setup
description: 既存の統合Plugin利用者向けに、Plugin導入前の読取専用診断が完了した後、MacまたはWindowsへNode.js/npm、Lark公式CLI、Bridge、議事録設定を不足分だけ順番に導入する互換入口。診断だけの依頼には使わない。新規配布では分離版Pluginを優先する。
---

# Larkセットアップ（統合Plugin互換入口）

新規利用者はPlugin非依存の読取専用コマンドで先に診断し、不足時だけ分離版Pluginを追加する。この統合Pluginを既に利用している環境で再診断が必要な場合だけ `$lark-diagnose` を使う。診断結果を報告して一度止め、利用者が導入を明示した後にだけ `sfl-lark-setup` の実行手順へ進む。OSをユーザーに選ばせない。

1. Plugin導入前の診断結果、または既存利用者の再診断結果を確認し、導入直前の安全な再確認を行う。
2. Node.js/npmが不足している場合だけ、説明と承認後にNode.js LTSを導入する。
3. Lark公式CLIを先に、Bridgeを後に整える。
4. QR登録とLark IMの往復を確認する。
5. 議事録を希望する場合だけMinutes/Docs認証と議事録設定へ進む。

正常な層を再導入せず、失敗した層より先へ進まない。新規利用者には、接続基盤Plugin `lark-agent-bridge` と議事録Plugin `sfl-gijiroku` を分ける現行構成を案内する。

診断だけを求められた場合はこのSkillを使わず、`$lark-diagnose` へ切り替える。
