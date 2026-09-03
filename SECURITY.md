# Security Policy

## Report a vulnerability

秘密情報を含む脆弱性は公開Issueへ書かないでください。GitHubのPrivate vulnerability reportingから報告してください。

## Secret handling

- App Secret、access token、credential、Bridge profile exportをIssue、Pull Request、ログへ貼らないでください。
- このプラグインは秘密情報をGit管理ファイルへ保存しません。
- `full` presetは端末全体へアクセスできるため、利用者本人の明示確認が必要です。

## Supported versions

最新リリースのみをセキュリティ更新対象とします。Bridge本体の互換範囲は `plugins/lark-agent-bridge/compatibility.json` を参照してください。
