#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
failures=0

check_command() {
  local command_name="$1"
  if command -v "$command_name" >/dev/null 2>&1; then
    printf 'OK   %s\n' "$command_name"
  else
    printf 'NG   %s が見つかりません\n' "$command_name"
    failures=$((failures + 1))
  fi
}

check_command node
check_command python3
check_command lark-cli

if python3 -c 'import PIL' >/dev/null 2>&1; then
  printf 'OK   Pillow\n'
else
  printf 'NG   Python Pillow が見つかりません\n'
  failures=$((failures + 1))
fi

if node "$SCRIPT_DIR/gijiroku-config.mjs" validate >/dev/null 2>&1; then
  printf 'OK   画像議事録設定\n'
else
  printf 'WARN 画像議事録設定が未完了または不正です。gijiroku-image-setup を実行してください\n'
fi

if [[ "${LARK_CHANNEL:-}" == "1" ]]; then
  printf 'OK   lark-channel-bridge コンテキスト（profile=%s）\n' "${LARK_CHANNEL_PROFILE:-default}"
else
  printf 'INFO 現在はBridgeセッション外です。Lark返信テストはLark IMから実行してください\n'
fi

if (( failures > 0 )); then
  exit 1
fi
