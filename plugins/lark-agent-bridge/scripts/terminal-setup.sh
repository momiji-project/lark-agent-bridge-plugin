#!/usr/bin/env bash

set -eu

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
BOOTSTRAP="$SCRIPT_DIR/bootstrap.sh"
MANAGER="$SCRIPT_DIR/bridge-manager.mjs"
AGENT=""
WORKSPACE=""
PROFILE_NAME="sfl-lark"
LARK_SCOPE=""
PERSONAL_LARK_SELECTED=0
BOT_ONLY_SELECTED=0
INSTALL_NODE_LTS=0
REUSE_PROFILE=0
DRY_RUN=0
RUNTIME_CHECK_ONLY=0
AUTH_TEMP_DIR=""

usage() {
  cat <<'EOF'
Usage: bash scripts/terminal-setup.sh [options]

Options:
  --agent codex|claude    Agent used by this Bridge profile.
  --workspace PATH        Workspace exposed to the agent.
  --profile NAME          Bridge profile name (default: sfl-lark).
  --personal-lark         Enable Minutes/documents with QR device authorization.
  --bot-only              Limit Lark CLI access to bot credentials.
  --install-node-lts      Approve Node.js LTS installation if required.
  --reuse-profile         Reuse the named profile if it already exists.
  --dry-run               Show planned actions without changing the PC.
  --runtime-check-only    Check OS, Node.js, and npm, then exit.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --agent) AGENT="${2:-}"; shift 2 ;;
    --workspace) WORKSPACE="${2:-}"; shift 2 ;;
    --profile) PROFILE_NAME="${2:-}"; shift 2 ;;
    --personal-lark) LARK_SCOPE="user-default"; PERSONAL_LARK_SELECTED=1; shift ;;
    --bot-only) LARK_SCOPE="bot-only"; BOT_ONLY_SELECTED=1; shift ;;
    --install-node-lts) INSTALL_NODE_LTS=1; shift ;;
    --reuse-profile) REUSE_PROFILE=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --runtime-check-only) RUNTIME_CHECK_ONLY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$PERSONAL_LARK_SELECTED" -eq 1 ] && [ "$BOT_ONLY_SELECTED" -eq 1 ]; then
  printf 'Use either --personal-lark or --bot-only, not both.\n' >&2
  exit 2
fi

if [ ! -f "$BOOTSTRAP" ] || [ ! -f "$MANAGER" ]; then
  printf 'Plugin files are incomplete. Reinstall lark-agent-bridge before continuing.\n' >&2
  exit 2
fi

is_interactive() {
  [ -t 0 ] && [ -t 1 ]
}

ask_yes_no() {
  prompt="$1"
  default_answer="${2:-no}"
  if ! is_interactive; then
    [ "$default_answer" = "yes" ]
    return
  fi
  printf '%s ' "$prompt"
  read -r answer
  case "$answer" in
    y|Y|yes|YES|はい) return 0 ;;
    "") [ "$default_answer" = "yes" ]; return ;;
    *) return 1 ;;
  esac
}

cleanup() {
  if [ -n "$AUTH_TEMP_DIR" ] && [ -d "$AUTH_TEMP_DIR" ]; then
    rm -rf "$AUTH_TEMP_DIR"
  fi
}

trap cleanup EXIT HUP INT TERM

run_profile_lark_cli() {
  env \
    LARK_CHANNEL=1 \
    LARK_CHANNEL_HOME="$BRIDGE_HOME" \
    LARK_CHANNEL_PROFILE="$PROFILE_NAME" \
    LARK_CHANNEL_CONFIG="$BRIDGE_HOME/profiles/$PROFILE_NAME/lark-cli-source/config.json" \
    LARKSUITE_CLI_CONFIG_DIR="$BRIDGE_HOME/profiles/$PROFILE_NAME/lark-cli" \
    LARKSUITE_CLI_NO_UPDATE_NOTIFIER=1 \
    LARKSUITE_CLI_NO_SKILLS_NOTIFIER=1 \
    "$LARK_CLI_COMMAND" "$@"
}

profile_user_ready() {
  status_json="$(run_profile_lark_cli auth status --json --verify 2>/dev/null || true)"
  printf '%s' "$status_json" | "$NODE_COMMAND" -e '
    let source = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => { source += chunk; });
    process.stdin.on("end", () => {
      try {
        const value = JSON.parse(source);
        const user = value && value.identities && value.identities.user;
        const scope = typeof user?.scope === "string" ? user.scope.split(/\s+/) : [];
        const ready = user?.available === true &&
          (user?.verified === true || user?.tokenStatus === "valid" || user?.status === "ready") &&
          scope.includes("minutes:minutes.basic:read") &&
          scope.includes("minutes:minutes.search:read") &&
          scope.includes("docx:document:create");
        process.exit(ready ? 0 : 1);
      } catch {
        process.exit(1);
      }
    });
  '
}

agent_logged_in() {
  case "$AGENT" in
    codex)
      "$AGENT" login status >/dev/null 2>&1
      ;;
    claude)
      agent_status="$("$AGENT" auth status 2>/dev/null || true)"
      printf '%s' "$agent_status" | grep -Eq '"loggedIn"[[:space:]]*:[[:space:]]*true'
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_agent_login() {
  if agent_logged_in; then
    return 0
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    printf '[dry-run] %sのログインが必要です。\n' "$AGENT"
    return 0
  fi
  if ! is_interactive || ! ask_yes_no "$AGENTにログインしてから続行しますか？ [y/N]" no; then
    printf '%sが未ログインのため、PCを変更せず終了しました。\n' "$AGENT" >&2
    return 30
  fi
  case "$AGENT" in
    codex) "$AGENT" login ;;
    claude) "$AGENT" auth login ;;
  esac
  if ! agent_logged_in; then
    printf '%sのログインを確認できませんでした。ログイン後に再実行してください。\n' "$AGENT" >&2
    return 30
  fi
}

ensure_personal_lark_auth() {
  if profile_user_ready; then
    printf 'Minutes・Larkドキュメント用のユーザー認証は確認済みです。\n'
    return 0
  fi

  if ! is_interactive; then
    printf '個人Larkデータへの認証には対話式Terminalが必要です。対話式で再実行してください。\n' >&2
    return 34
  fi

  printf '\nMinutesとLarkドキュメントを使うため、QR方式のLarkユーザー認証を行います。\n'
  AUTH_TEMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/lark-bridge-auth.XXXXXX")"
  auth_json="$AUTH_TEMP_DIR/auth.json"
  completion_json="$AUTH_TEMP_DIR/completion.json"
  if ! run_profile_lark_cli auth login --domain minutes --domain docs --no-wait --json >"$auth_json"; then
    printf 'Larkユーザー認証の開始に失敗しました。Bridgeプロファイルは削除していません。\n' >&2
    return 34
  fi

  verification_url="$("$NODE_COMMAND" -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const find = (input, keys, depth = 0) => {
      if (!input || typeof input !== "object" || depth > 5) return "";
      for (const key of keys) if (typeof input[key] === "string" && input[key]) return input[key];
      for (const child of Object.values(input)) {
        const found = find(child, keys, depth + 1);
        if (found) return found;
      }
      return "";
    };
    process.stdout.write(find(value, ["verification_uri_complete", "verification_url", "verification_uri", "url"]));
  ' "$auth_json")"
  device_code="$("$NODE_COMMAND" -e '
    const fs = require("fs");
    const value = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
    const find = (input, depth = 0) => {
      if (!input || typeof input !== "object" || depth > 5) return "";
      for (const key of ["device_code", "deviceCode"]) if (typeof input[key] === "string" && input[key]) return input[key];
      for (const child of Object.values(input)) {
        const found = find(child, depth + 1);
        if (found) return found;
      }
      return "";
    };
    process.stdout.write(find(value));
  ' "$auth_json")"
  if [ -z "$verification_url" ] || [ -z "$device_code" ]; then
    printf '認証URLを取得できませんでした。秘密情報は表示していません。\n' >&2
    return 34
  fi

  printf '\nQRコードをLarkを利用する端末で読み取り、許可してください。\n'
  printf 'QRを読み取れない場合は、次の同じ認証URLを開けます。\n%s\n' "$verification_url"
  qr_path=""
  if (cd "$AUTH_TEMP_DIR" && run_profile_lark_cli auth qrcode "$verification_url" --output lark-auth.png >/dev/null 2>&1); then
    qr_path="$AUTH_TEMP_DIR/lark-auth.png"
    printf 'QRコード: %s\n' "$qr_path"
    if command -v open >/dev/null 2>&1; then
      open "$qr_path" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
      xdg-open "$qr_path" >/dev/null 2>&1 || true
    fi
  else
    printf 'QRコード画像を生成できなかったため、上記URLを使用してください。\n'
  fi

  printf '承認を待っています。このTerminalは閉じないでください。\n'
  if ! run_profile_lark_cli auth login --device-code "$device_code" --json >"$completion_json"; then
    printf 'Larkユーザー認証が完了しませんでした。同じセットアップを再実行してください。\n' >&2
    return 34
  fi
  if ! profile_user_ready; then
    printf '認証後の権限確認に失敗しました。MinutesとDocsの許可状態を確認して再実行してください。\n' >&2
    return 34
  fi
  printf 'Minutes・Larkドキュメント用のユーザー認証が完了しました。\n'
}

set +e
bash "$BOOTSTRAP" --check-only
RUNTIME_STATUS=$?
set -e

if [ "$RUNTIME_CHECK_ONLY" -eq 1 ]; then
  exit "$RUNTIME_STATUS"
fi

if [ -z "$AGENT" ]; then
  HAS_CODEX=0
  HAS_CLAUDE=0
  command -v codex >/dev/null 2>&1 && HAS_CODEX=1
  command -v claude >/dev/null 2>&1 && HAS_CLAUDE=1
  if [ "$HAS_CODEX" -eq 1 ] && [ "$HAS_CLAUDE" -eq 0 ]; then
    AGENT="codex"
  elif [ "$HAS_CODEX" -eq 0 ] && [ "$HAS_CLAUDE" -eq 1 ]; then
    AGENT="claude"
  elif [ "$HAS_CODEX" -eq 1 ] && [ "$HAS_CLAUDE" -eq 1 ] && is_interactive; then
    printf '接続するエージェントを選んでください。\n  1) Codex\n  2) Claude Code\n選択 [1]: '
    read -r agent_choice
    case "$agent_choice" in 2) AGENT="claude" ;; *) AGENT="codex" ;; esac
  else
    printf 'CodexまたはClaude Codeが見つかりません。先に利用するエージェントを導入してください。\n' >&2
    exit 30
  fi
fi

case "$AGENT" in
  codex|claude) ;;
  *) printf -- '--agent must be codex or claude.\n' >&2; exit 2 ;;
esac
if ! command -v "$AGENT" >/dev/null 2>&1; then
  printf '%s is not installed or not available on PATH.\n' "$AGENT" >&2
  exit 30
fi

if [ "$RUNTIME_STATUS" -ne 0 ] && [ "$INSTALL_NODE_LTS" -ne 1 ]; then
  printf '\nNode.jsとnpmが必要です。Node.js LTSをこのPCへ導入します。\n'
  if ask_yes_no '続行しますか？ [y/N]' no; then
    INSTALL_NODE_LTS=1
  else
    printf 'Node.jsの導入を行わず終了しました。Lark CLIとBridgeは変更していません。\n'
    exit 20
  fi
fi

if [ "$RUNTIME_STATUS" -ne 0 ]; then
  if [ "$DRY_RUN" -eq 1 ]; then
    bash "$BOOTSTRAP" --install-node-lts --runtime-only --dry-run
    printf '[dry-run] Runtime installation must finish before profile setup can continue.\n'
    exit 0
  fi
  bash "$BOOTSTRAP" --install-node-lts --runtime-only
fi

PATH="$PATH:/usr/local/bin:/opt/homebrew/bin"
export PATH
ensure_agent_login

if [ "$DRY_RUN" -eq 1 ]; then
  bash "$BOOTSTRAP" --dry-run
else
  bash "$BOOTSTRAP"
fi

if [ -z "$WORKSPACE" ]; then
  WORKSPACE="$PWD"
  if is_interactive; then
    printf 'Bridgeで利用する作業フォルダ [%s]: ' "$WORKSPACE"
    read -r workspace_input
    [ -n "$workspace_input" ] && WORKSPACE="$workspace_input"
  fi
fi
if [ ! -d "$WORKSPACE" ]; then
  printf 'Workspace does not exist: %s\n' "$WORKSPACE" >&2
  exit 31
fi
WORKSPACE="$(CDPATH= cd -- "$WORKSPACE" && pwd -P)"
TEMP_ROOT="${TMPDIR:-/tmp}"
TEMP_ROOT="${TEMP_ROOT%/}"
case "$WORKSPACE" in
  /|"$HOME"|/tmp|/tmp/*|/private/tmp|/private/tmp/*|/var/folders|/var/folders/*|"$TEMP_ROOT"|"$TEMP_ROOT"/*)
    printf '安全のため、このフォルダはworkspaceに指定できません: %s\n' "$WORKSPACE" >&2
    exit 31
    ;;
esac

if ! printf '%s' "$PROFILE_NAME" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$'; then
  printf 'Profile name must use 1-64 letters, digits, hyphens, or underscores.\n' >&2
  exit 2
fi

if [ -z "$LARK_SCOPE" ]; then
  if is_interactive && ask_yes_no 'このBridgeを議事録（Minutes・Larkドキュメント）にも使いますか？ [y/N]' no; then
    LARK_SCOPE="user-default"
  else
    LARK_SCOPE="bot-only"
  fi
fi

BRIDGE_COMMAND="$(command -v lark-channel-bridge || true)"
NODE_COMMAND="$(command -v node || true)"
LARK_CLI_COMMAND="$(command -v lark-cli || true)"
BRIDGE_HOME="${LARK_CHANNEL_HOME:-$HOME/.lark-channel}"
if [ -z "$BRIDGE_COMMAND" ] || [ -z "$NODE_COMMAND" ] || [ -z "$LARK_CLI_COMMAND" ]; then
  printf 'Bridge, Lark CLI, or Node.js is not available after installation. Open a new terminal and rerun this command.\n' >&2
  exit 32
fi

PROFILE_EXISTS=0
PROFILE_WAS_RUNNING=0
PROFILE_LIST="$("$BRIDGE_COMMAND" profile list 2>/dev/null || true)"
if printf '%s\n' "$PROFILE_LIST" | awk -v profile="$PROFILE_NAME" 'NR > 1 { for (i = 1; i <= NF; i++) if ($i == profile) found = 1 } END { exit(found ? 0 : 1) }'; then
  PROFILE_EXISTS=1
  PROFILE_STATUS="$("$BRIDGE_COMMAND" status --profile "$PROFILE_NAME" 2>/dev/null || true)"
  if printf '%s\n' "$PROFILE_STATUS" | grep -Eiq '正在后台运行|is (currently )?running in the background|background service is running|バックグラウンドで実行中|(^|[[:space:]])(process[[:space:]]*id|pid|プロセス[[:space:]]*id)[[:space:]]*[:=][[:space:]]*[0-9]+'; then
    PROFILE_WAS_RUNNING=1
  fi
fi

if [ "$PROFILE_EXISTS" -eq 1 ] && [ "$REUSE_PROFILE" -ne 1 ]; then
  if ask_yes_no "既存プロファイル $PROFILE_NAME を再利用しますか？ [y/N]" no; then
    REUSE_PROFILE=1
  else
    printf '既存プロファイルを変更せず終了しました。別名は --profile NAME で指定できます。\n'
    exit 33
  fi
fi

printf '\n実行内容\n'
printf '  Agent: %s\n  Workspace: %s\n  Profile: %s\n  Lark access: %s\n' "$AGENT" "$WORKSPACE" "$PROFILE_NAME" "$LARK_SCOPE"

if [ "$DRY_RUN" -eq 1 ]; then
  printf '[dry-run] Profile registration, permission preset, daemon start, and connectivity checks were not executed.\n'
  exit 0
fi

if [ "$PROFILE_EXISTS" -eq 0 ]; then
  "$BRIDGE_COMMAND" profile create "$PROFILE_NAME" --agent "$AGENT" --workspace "$WORKSPACE"
fi

if [ "$LARK_SCOPE" = "user-default" ]; then
  ensure_personal_lark_auth
  "$NODE_COMMAND" "$MANAGER" preset --profile "$PROFILE_NAME" --preset safe-edit --agent "$AGENT" --workspace "$WORKSPACE" --lark-cli-identity user-default --confirm-user-default
else
  "$NODE_COMMAND" "$MANAGER" preset --profile "$PROFILE_NAME" --preset safe-edit --agent "$AGENT" --workspace "$WORKSPACE" --lark-cli-identity bot-only
fi
if [ "$PROFILE_WAS_RUNNING" -eq 1 ]; then
  "$BRIDGE_COMMAND" restart --profile "$PROFILE_NAME"
else
  "$BRIDGE_COMMAND" start --profile "$PROFILE_NAME"
fi
"$NODE_COMMAND" "$MANAGER" doctor --profile "$PROFILE_NAME" --json
"$BRIDGE_COMMAND" status --profile "$PROFILE_NAME"

printf '\nターミナル側の設定は完了しました。LarkでBotへ /status を送り、返信を確認してください。\n'
