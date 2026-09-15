# SFL Lark Plugins

Lark / Feishu からローカルのClaude CodeまたはCodexを利用するための接続基盤Pluginと、Lark Minutesから議事録を作るPluginを別々に配布します。接続基盤にはNode.js/npmの診断、Lark公式CLI、Bridge、QR認証、疎通確認までを含め、議事録の要約・デザイン設定とは分離します。

## 正しい順序: 診断だけ → 基盤導入 → 議事録Plugin

診断と導入は別コマンドです。最初の診断はPluginを入れず、Codex標準の読取専用モードで実行します。Node.jsの追加、パッケージ更新、設定変更、認証、Bridge起動は一切行いません。診断結果を確認した後、必要な場合だけ接続基盤Pluginを追加し、`$lark-setup` を明示実行します。

1. macOS / Windows / LinuxとCPUアーキテクチャを判定
2. Codex / Claude Codeの導入とログイン状態を確認
3. Node.js 20.12以上とnpmを確認し、必要ならセットアップ内でNode.js LTSを導入
4. Lark公式CLI `@larksuite/cli` を確認・導入
5. `lark-channel-bridge` を確認・導入
6. BridgeプロファイルをQR登録し、Lark IMの往復を確認
7. 議事録を使う場合だけ、QR付きデバイスフローでMinutes/Docsを認証
8. 議事録が必要な利用者だけ、別Plugin `sfl-gijiroku` を追加

### 1. Mac / Windows共通・Plugin導入前の診断専用コマンド

Pluginを追加する前に、新しいTerminalまたはPowerShellで次の1行だけを実行します。MacとWindowsで同じです。

```text
codex exec --sandbox read-only --ephemeral --ignore-user-config --ignore-rules --skip-git-repo-check "このPCのLark接続環境を読み取り専用で診断してください。OS名・CPUアーキテクチャ、Node.js、npm、Codex、Claude Code、Lark公式CLI（@larksuite/cli）、lark-channel-bridgeの有無・バージョン・プロファイル名一覧・各プロファイルの稼働状態だけを確認してください。製品シリアル番号、UUID、UDID、token、App Secret、credential、設定本文、ログ本文は読んだり表示したりしないでください。導入、更新、修復、認証、設定変更、起動、停止、再起動は一切行わず、結果をOK・不足・要確認で報告して終了してください。"
```

このコマンドはPluginに依存せずOSを自動判定し、OS/CPU、Node.js/npm、Codex/Claude Code、Lark公式CLI、Bridge、既存プロファイル、常駐状態を読み取ります。インストール・更新・設定変更・起動・再起動・認証は行わず、診断結果を返した時点で止まります。

Plugin内の `$lark-diagnose` とOS別の `terminal-diagnose.sh` / `terminal-diagnose.ps1` は、Plugin導入後の再診断用です。初回診断のためにPluginを先に入れません。

### 2. 診断結果の後、必要な場合だけ基盤を導入

診断結果を確認し、導入を進めると判断した場合だけMarketplaceを登録し、接続基盤Pluginを追加します。

```bash
codex plugin marketplace add momiji-project/lark-agent-bridge-plugin --ref main
codex plugin add lark-agent-bridge@momiji-lark-tools
```

Plugin追加後に、次の基盤導入コマンドを実行します。

```text
codex '$lark-setup 診断結果をもとに、Node.js・npm・Lark公式CLI・Bridgeの不足分だけを順番に設定してください。議事録も使います。'
```

`$lark-setup` は導入専用です。Lark公式CLIを必ずBridgeより先に整えます。Node.jsの追加、既存プロファイルの再利用、個人Larkデータへのアクセスは、Terminal上で確認してから実行します。

### エージェントへ依頼する場合

Codexアプリ内から始める場合も、Pluginを追加する前に読取専用で診断します。Plugin追加後の `$lark-diagnose` は再診断専用です。

```text
このPCのLark接続環境を変更せず診断してください。導入・更新・修復・認証・設定変更・起動停止は行わず、結果を報告したら止まってください。
```

診断結果を確認後、導入する場合だけ `$lark-setup` を別途依頼します。

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

先に、前掲のPlugin非依存診断コマンドを実行します。診断結果を確認し、不足分の導入を進める場合だけ次を実行します。

```bash
codex plugin marketplace add momiji-project/lark-agent-bridge-plugin --ref main
codex plugin add lark-agent-bridge@momiji-lark-tools
```

新しいセッションを開始し、診断結果をもとに導入する場合だけ次を依頼します。

```text
$lark-setup 診断結果をもとに、Lark公式CLIとBridgeの不足分だけを設定してください
```

Plugin導入後に状態をもう一度確認するときだけ、再診断用Skillを使います。

```text
$lark-diagnose このPCのLark接続環境を変更せず再診断してください。導入や修復は行わないでください
```

## Claude Codeへインストール

Claude Codeで次を実行します。

```text
/plugin marketplace add momiji-project/lark-agent-bridge-plugin
/plugin install lark-agent-bridge@momiji-lark-tools
```

Plugin導入前の診断結果を確認し、新しいセッションで導入を進める場合だけ依頼します。

```text
/lark-setup 診断結果をもとに、Lark公式CLIとBridgeの不足分だけを設定してください
```

Plugin導入後に状態をもう一度確認するときだけ、再診断用Skillを使います。

```text
/lark-diagnose このPCのLark接続環境を変更せず再診断してください。導入や修復は行わないでください
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
| `lark-diagnose` | Plugin導入後の再診断。PCを変更しない独立診断だけを実行 |
| `lark-setup` | 診断結果の確認後に、公式CLI、Bridge、疎通確認を行う導入入口 |
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
