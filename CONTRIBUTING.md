# Contributing

1. `main` から作業ブランチを作成します。
2. 秘密情報や実ユーザーのIDをfixtureへ含めません。
3. profile設定の変更は既存フィールドを保持し、原子的に保存します。
4. 更新処理では、更新前に停止していたprofileを起動しません。
5. テストとPlugin/Skill検証を実行してPull Requestを作成します。

Bridge本体の機能変更は、まず上流の [`lark-channel-bridge`](https://github.com/zarazhangrui/feishu-claude-code-bridge) へ提案してください。このリポジトリで `dist/` を直接改変する変更は受け付けません。
