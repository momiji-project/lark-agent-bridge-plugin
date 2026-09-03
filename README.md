# Lark Agent Bridge Plugin

Lark / Feishu からローカルの Claude Code または Codex を使うための、導入・設定・診断・更新プラグインです。

📘 [図解付きの導入ガイド（Lark Developer設定を含む）](https://momiji-project.github.io/lark-agent-bridge-plugin/)

Bridge本体は再実装せず、MITライセンスの [`lark-channel-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) を利用します。このリポジトリは、設定ファイルや秘密情報を手作業で編集せずに導入できる運用レイヤーを提供します。

## できること

- Node.js、Claude Code、Codex、Bridgeの事前確認
- Lark PersonalAgentのQR登録とプロファイル作成
- `read-only` / `safe-edit` / `full` の権限プリセット
- Bridgeで使う `CLAUDE.md` / `AGENTS.md` の管理ブロック生成
- 秘密情報を表示しないread-only診断
- 意図的に停止したプロファイルを起動しない安全な更新
- Claude CodeとCodexの両方から利用可能

## 対応範囲

初期版は、Node.js 20.12以上が動作し、Claude CodeまたはCodex CLIがインストール済みのmacOS、Linux、Windowsを対象にします。LarkのQR認証と各エージェントへのログインは利用者本人が行います。

## Codexへインストール

```bash
codex plugin marketplace add momiji-project/lark-agent-bridge-plugin --ref main
codex plugin add lark-agent-bridge@momiji-lark-tools
```

新しいセッションを開始し、次のように依頼します。

```text
$lark-bridge-setup Lark BridgeをこのPCに初期設定してください
```

## Claude Codeへインストール

Claude Codeで次を実行します。

```text
/plugin marketplace add momiji-project/lark-agent-bridge-plugin
/plugin install lark-agent-bridge@momiji-lark-tools
```

新しいセッションで次のように依頼します。

```text
/lark-bridge-setup Lark BridgeをこのPCに初期設定してください
```

## Skills

| Skill | 用途 |
|---|---|
| `lark-bridge-setup` | 初回導入、QR登録、疎通確認 |
| `lark-bridge-doctor` | 設定を変更しない状態診断 |
| `lark-bridge-agent-config` | エージェント、権限、workspace、Developer相当ルールの設定 |
| `lark-bridge-update` | Bridgeの互換性確認付き更新 |

## Developer設定について

エージェント製品自身のsystem/developerメッセージは、このプラグインから置き換えません。代わりに、プロジェクトごとの持続的なルールをネイティブの指示ファイルへ管理ブロックとして追加します。

- Claude Code: `CLAUDE.md`
- Codex: `AGENTS.md`
- Bridgeプロファイル: agent、model、workspace、permissions、同時実行数、timeout、Lark access

既存の手書き部分は保持し、管理マーカー内だけを更新します。Bridge経由の実行では `LARK_CHANNEL=1` が設定されるため、追加ルールはBridgeセッションだけに条件付けできます。

## 安全な既定値

- `safe-edit`: 指定workspace内のみ編集
- ownerのみ利用可能、グループではBotへのメンション必須
- `lark-cli` は `bot-only`
- 同時実行1、idle timeout 10分
- modelはエージェント側の既定値
- COTと詳細tool出力は非表示

`full` はローカル全体へアクセスできるため、明示確認なしでは適用しません。

## 開発と検証

```bash
node --test plugins/lark-agent-bridge/tests/*.test.mjs
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/lark-agent-bridge
```

プラグイン版とBridge版は独立して管理します。対応Bridge版は [`compatibility.json`](plugins/lark-agent-bridge/compatibility.json) を正本とします。

## 秘密情報

App Secret、token、`~/.lark-channel`、profile export、ログをGitへ追加しないでください。秘密情報はBridgeの暗号化keystoreへ保存し、このプラグインのpresetやルールには含めません。

## License

このリポジトリはMIT Licenseです。Bridge本体は上流プロジェクトのライセンスと配布条件に従います。
