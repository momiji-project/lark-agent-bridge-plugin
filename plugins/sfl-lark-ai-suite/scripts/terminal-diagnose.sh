#!/usr/bin/env bash

set -u

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BOOTSTRAP="$SCRIPT_DIR/bootstrap.sh"
MANAGER="$SCRIPT_DIR/bridge-manager.mjs"

printf '%s\n' '【Lark接続環境の診断】'
printf '%s\n' 'このコマンドは読み取り専用です。インストール・更新・設定変更・起動・再起動は行いません。'
printf '\n'

if [ ! -f "$BOOTSTRAP" ] || [ ! -f "$MANAGER" ]; then
  printf '%s\n' 'Pluginの診断ファイルが不足しています。sfl-lark-ai-suite Plugin本体を確認してください。' >&2
  exit 2
fi

set +e
bash "$BOOTSTRAP" --check-only
runtime_status=$?
set -e

printf '\n%s\n' '【Lark公式CLI・Bridge・AIエージェント】'
if command -v node >/dev/null 2>&1; then
  node "$MANAGER" preflight --json || true
else
  for command_name in codex claude lark-cli lark-channel-bridge; do
    if command -v "$command_name" >/dev/null 2>&1; then
      command_path="$(command -v "$command_name")"
      command_version="$("$command_path" --version 2>/dev/null | sed -n '1p' || true)"
      printf '○ %s: 検出済み%s\n' "$command_name" "${command_version:+ ($command_version)}"
    else
      printf '△ %s: 未検出\n' "$command_name"
    fi
  done
fi

if command -v lark-channel-bridge >/dev/null 2>&1; then
  printf '\n%s\n' '【既存Bridgeの読取確認】'
  lark-channel-bridge profile list 2>&1 || true
  lark-channel-bridge ps 2>&1 || true
else
  printf '\n%s\n' 'BridgeコマンドはPATH上で未検出のため、プロファイルと常駐状態の読取確認は省略しました。'
fi

printf '\n%s\n' '診断は完了しました。PCの状態は変更していません。'
if [ "$runtime_status" -ne 0 ]; then
  printf '%s\n' 'Node.js/npmに不足があります。導入を行う場合のみ、診断結果の後に $lark-setup を実行してください。'
else
  printf '%s\n' '不足・不整合が表示された場合だけ、次に $lark-setup を実行します。'
fi

