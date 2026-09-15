# SFL Lark Plugins

Lark / Feishu からローカルのClaude CodeまたはCodexを利用するための接続基盤Pluginと、Lark Minutesから議事録を作るPluginを別々に配布します。接続基盤にはNode.js/npmの診断、Lark公式CLI、Bridge、QR認証、疎通確認までを含め、議事録の要約・デザイン設定とは分離します。

## 推奨: 一つの入口から診断し、土台と追加機能を順番に導入

導入は次のゲートを順番に通します。Node.jsやnpmが無い場合もセットアップの途中で止めたままにせず、変更内容を説明して承認を得た後、OS別のブートストラップでNode.jsから整備します。前のゲートが完了するまでBridgeや議事録Pluginを後追い導入しません。

1. macOS / Windows / LinuxとCPUアーキテクチャを判定
2. Codex / Claude Codeの導入とログイン状態を確認
3. Node.js 20.12以上とnpmを確認し、必要ならセットアップ内でNode.js LTSを導入
4. Lark公式CLI `@larksuite/cli` を確認・導入
5. `lark-channel-bridge` を確認・導入
6. BridgeプロファイルをQR登録し、Lark IMの往復を確認
7. 議事録を使う場合だけ、QR付きデバイスフローでMinutes/Docsを認証
8. 議事録が必要な利用者だけ、別Plugin `sfl-gijiroku` を追加

最初にMarketplaceを登録し、Lark接続基盤Pluginを導入します。Plugin追加後の標準入口は `$lark-setup` だけです。

```bash
codex plugin marketplace add momiji-project/lark-agent-bridge-plugin --ref main
codex plugin add lark-agent-bridge@momiji-lark-tools
```

### Mac / Windows共通の開始コマンド

Plugin追加後、新しいTerminalまたはPowerShellで次の1行を実行します。MacとWindowsで同じです。`codex`を対話モードで開くため、Node.js追加やQR認証など、途中で必要な確認にもそのまま回答できます。

```text
codex '$lark-setup このPCを最初に自動診断し、Node.js・npm・Lark公式CLI・Bridgeを不足分だけ順番に設定してください。接続確認後、議事録Pluginも導入してください。'
```

この一つの入口がOSを判定し、最初に設定を変更しない診断を実行します。合格済みの項目は飛ばし、Node.js/npm、Lark公式CLI、Bridge、プロファイル、QR認証、権限、起動、疎通確認を不足分だけ順番に処理します。Lark公式CLIを必ずBridgeより先に整えます。Node.jsの追加、既存プロファイルの再利用、個人Larkデータへのアクセスは、ターミナル上で確認してから実行します。

OS別の `terminal-setup.sh` / `terminal-setup.ps1` はPlugin内部の実装です。通常利用者が選ぶコマンドではなく、`$lark-setup` が自動で適切な方へ分岐します。

### エージェントへ依頼する場合

Codexアプリ内から始める場合は、新しいセッションで同じ標準入口を使います。

```text
$lark-setup このPCを最初に自動診断し、Lark公式CLIとBridgeを不足分だけ順番に設定してください。議事録も使います
```

Bridgeの疎通確認が終わった後、議事録が必要な場合だけ別Pluginを追加します。標準入口の依頼文に「議事録Pluginも導入」と含めた場合は、疎通確認後にセットアップがこの追加まで進めます。Minutesと個人ドキュメントを使うプロファイルでは、接続基盤側の設定時に追加範囲を説明し、明示承認後にQR付きデバイスフローを完了してからLark CLI identityを`user-default`にします。議事録Plugin自身はBridge設定を変更しません。

```bash
codex plugin add sfl-gijiroku@momiji-lark-tools
```

さらに新しいセッションで議事録だけを設定します。

```text
$gijiroku-setup 議事録Pluginをおすすめ設定で初期設定してください。Bridgeの設定は変更しないでください。
```

議事録Pluginは、標準要約・Larkドキュメント＋共有用画像・テイスト自動・ロゴなし・議事録作成を明示する自然言語トリガーで開始します。

Bridge本体は再実装せず、Lark公式のChannel SDKを基盤にするMITライセンスの [`lark-channel-bridge`](https://github.com/zarazhangrui/lark-coding-agent-bridge) を利用します。このリポジトリは、設定ファイルや秘密情報を手作業で編集せずに導入できる運用レイヤーだけを提供します。

## できること

- OSとCPU、Node.js、npm、Lark公式CLI、Claude Code、Codex、Bridgeの事前確認
- WindowsとmacOSでNode.jsが無い初期状態から始めるOSネイティブのブートストラップ
- Lark公式CLIをBridgeより先に導入する順序制御
- Lark PersonalAgentのQR登録とプロファイル作成
- Minutes/DocsのQR付きデバイスフローと認証後scope検証
- `read-only` / `safe-edit` / `full` の権限プリセット
- Bridgeで使う `CLAUDE.md` / `AGENTS.md` の管理ブロック生成
- 秘密情報を表示しないread-only診断
- 意図的に停止したプロファイルを起動しない安全な更新
- Claude CodeとCodexの両方から利用可能

## 対応範囲

Claude CodeまたはCodex CLIがインストール済みのmacOS、Linux、Windowsを対象にします。WindowsとmacOSでは、Node.js 20.12以上とnpmが無い場合もセットアップSkillが診断し、明示承認後にNode.js LTSの導入から続行します。WindowsはWindows Package Manager、macOSはチェックサムと署名を検証したNode.js公式インストーラーを使用します。LarkのQR認証、macOSのインストーラー画面、個人Larkデータを利用する場合のuser認証、各エージェントへのログインは利用者本人が行います。

## Codexへインストール

```bash
codex plugin marketplace add momiji-project/lark-agent-bridge-plugin --ref main
codex plugin add lark-agent-bridge@momiji-lark-tools
```

新しいセッションを開始し、次のように依頼します。

```text
$lark-setup このPCを最初に自動診断し、Lark公式CLIとBridgeを不足分だけ設定してください
```

## Claude Codeへインストール

Claude Codeで次を実行します。

```text
/plugin marketplace add momiji-project/lark-agent-bridge-plugin
/plugin install lark-agent-bridge@momiji-lark-tools
```

新しいセッションで次のように依頼します。

```text
/lark-setup このPCを最初に自動診断し、Lark公式CLIとBridgeを不足分だけ設定してください
```

Bridgeの接続確認後、議事録Pluginを別に追加します。

```text
/plugin install sfl-gijiroku@momiji-lark-tools
```

新しいセッションで次のように依頼します。

```text
/gijiroku-setup 議事録Pluginをおすすめ設定で初期設定してください。Bridgeの設定は変更しないでください。
```

## Skills

| Skill | 用途 |
|---|---|
| `lark-setup` | 新規導入の標準入口。自動診断から公式CLI、Bridge、疎通確認まで |
| `lark-bridge-setup` | 旧利用者向けの互換入口 |
| `lark-bridge-doctor` | 設定を変更しない状態診断 |
| `lark-bridge-agent-config` | エージェント、権限、workspace、Developer相当ルールの設定 |
| `lark-bridge-update` | Bridgeの互換性確認付き更新 |
| `gijiroku-setup` | 議事録Pluginだけの初回設定・再設定 |
| `gijiroku` | MinutesからLarkドキュメントと共有用画像を作成 |

`sfl-lark-ai-suite` は既存利用者との互換性のため残していますが、新規導入ではBridge用と議事録用を分けます。

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

`bot-only`は通常の安全な既定値です。Minutesや個人ドキュメントを使う場合だけ、追加範囲を説明して明示承認を得たうえで`user-default`へ切り替えます。`full` はローカル全体へアクセスできるため、明示確認なしでは適用しません。

## 開発と検証

```bash
node --test plugins/lark-agent-bridge/tests/bridge-manager.test.mjs plugins/sfl-gijiroku/tests/gijiroku-config.test.mjs plugins/sfl-gijiroku/tests/gijiroku-document.test.mjs
node scripts/validate-gijiroku-plugin.mjs
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/lark-agent-bridge
python3 /path/to/plugin-creator/scripts/validate_plugin.py plugins/sfl-gijiroku
```

議事録PluginとLark接続基盤Pluginは独立して管理します。対応Bridge版は各Pluginの`compatibility.json`を正本とします。

## 秘密情報

App Secret、token、`~/.lark-channel`、profile export、ログをGitへ追加しないでください。秘密情報はBridgeの暗号化keystoreへ保存し、このプラグインのpresetやルールには含めません。

## License

このリポジトリはMIT Licenseです。Bridge本体は上流プロジェクトのライセンスと配布条件に従います。
