#!/usr/bin/env bash

set -eu

MINIMUM_NODE_VERSION="20.12.0"
NODE_RELEASE_LINE="22"
CHECK_ONLY=0
INSTALL_NODE_LTS=0
RUNTIME_ONLY=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/bootstrap.sh [--check-only] [--install-node-lts] [--runtime-only] [--dry-run]

  --check-only        Check Node.js and npm without changing the PC.
  --install-node-lts  Install Node.js 22 LTS when Node.js or npm is unavailable.
  --runtime-only      Stop after checking or installing Node.js and npm.
  --dry-run           Show the planned installation without changing the PC.
EOF
}

for argument in "$@"; do
  case "$argument" in
    --check-only) CHECK_ONLY=1 ;;
    --install-node-lts) INSTALL_NODE_LTS=1 ;;
    --runtime-only) RUNTIME_ONLY=1 ;;
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$argument" >&2; usage >&2; exit 2 ;;
  esac
done

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
MANAGER="$SCRIPT_DIR/bridge-manager.mjs"
OS_NAME="$(uname -s)"
ARCH_NAME="$(uname -m)"
NODE_COMMAND=""
NPM_COMMAND=""
NODE_VERSION=""
TEMPORARY_DIRECTORY=""

cleanup() {
  if [ -n "$TEMPORARY_DIRECTORY" ] && [ -d "$TEMPORARY_DIRECTORY" ]; then
    rm -rf "$TEMPORARY_DIRECTORY"
  fi
}

trap cleanup EXIT HUP INT TERM

version_at_least() {
  awk -v actual="$1" -v minimum="$2" 'BEGIN {
    sub(/^v/, "", actual)
    split(actual, a, ".")
    split(minimum, m, ".")
    for (i = 1; i <= 3; i++) {
      av = a[i] + 0
      mv = m[i] + 0
      if (av > mv) exit 0
      if (av < mv) exit 1
    }
    exit 0
  }'
}

resolve_runtime() {
  NODE_COMMAND="${LARK_BRIDGE_BOOTSTRAP_NODE:-}"
  if [ -z "$NODE_COMMAND" ] && command -v node >/dev/null 2>&1; then
    NODE_COMMAND="$(command -v node)"
  fi

  NPM_COMMAND="${LARK_BRIDGE_BOOTSTRAP_NPM:-}"
  if [ -z "$NPM_COMMAND" ] && command -v npm >/dev/null 2>&1; then
    NPM_COMMAND="$(command -v npm)"
  fi

  NODE_VERSION=""
  if [ -n "$NODE_COMMAND" ] && [ -x "$NODE_COMMAND" ]; then
    NODE_VERSION="$("$NODE_COMMAND" --version 2>/dev/null || true)"
  fi
}

runtime_ready() {
  [ -n "$NODE_VERSION" ] && version_at_least "$NODE_VERSION" "$MINIMUM_NODE_VERSION" && \
    [ -n "$NPM_COMMAND" ] && "$NPM_COMMAND" --version >/dev/null 2>&1
}

print_runtime_status() {
  printf '[bootstrap] OS: %s (%s)\n' "$OS_NAME" "$ARCH_NAME"
  if [ -n "$NODE_VERSION" ]; then
    printf '[bootstrap] Node.js: %s (%s)\n' "$NODE_VERSION" "$NODE_COMMAND"
  else
    printf '[bootstrap] Node.js: not found\n'
  fi
  if [ -n "$NPM_COMMAND" ] && "$NPM_COMMAND" --version >/dev/null 2>&1; then
    printf '[bootstrap] npm: %s (%s)\n' "$("$NPM_COMMAND" --version)" "$NPM_COMMAND"
  else
    printf '[bootstrap] npm: not found\n'
  fi
}

install_node_macos() {
  for required in curl awk shasum pkgutil open; do
    if ! command -v "$required" >/dev/null 2>&1; then
      printf 'Required macOS command is unavailable: %s\n' "$required" >&2
      return 1
    fi
  done

  TEMPORARY_DIRECTORY="$(mktemp -d "${TMPDIR:-/tmp}/lark-bridge-node.XXXXXX")"
  checksums="$TEMPORARY_DIRECTORY/SHASUMS256.txt"
  release_url="https://nodejs.org/dist/latest-v${NODE_RELEASE_LINE}.x"
  printf '[bootstrap] Downloading the official Node.js %s LTS installer metadata...\n' "$NODE_RELEASE_LINE"
  curl -fsSL "$release_url/SHASUMS256.txt" -o "$checksums"
  package_name="$(awk -v major="$NODE_RELEASE_LINE" '$2 ~ ("^node-v" major "[.][0-9]+[.][0-9]+[.]pkg$") { print $2; exit }' "$checksums")"
  if [ -z "$package_name" ]; then
    printf 'The official Node.js installer could not be resolved. No package was installed.\n' >&2
    return 1
  fi

  package_path="$TEMPORARY_DIRECTORY/$package_name"
  curl -fsSL "$release_url/$package_name" -o "$package_path"
  expected_checksum="$(awk -v file="$package_name" '$2 == file { print $1; exit }' "$checksums")"
  actual_checksum="$(shasum -a 256 "$package_path" | awk '{ print $1 }')"
  if [ -z "$expected_checksum" ] || [ "$expected_checksum" != "$actual_checksum" ]; then
    printf 'Node.js installer checksum verification failed. No package was installed.\n' >&2
    return 1
  fi
  if ! pkgutil --check-signature "$package_path" >/dev/null 2>&1; then
    printf 'Node.js installer signature verification failed. No package was installed.\n' >&2
    return 1
  fi

  printf '[bootstrap] Opening the verified official Node.js installer. Complete the macOS installer window.\n'
  if ! open -W "$package_path"; then
    printf 'The Node.js installer was not completed. No Bridge package was installed.\n' >&2
    return 1
  fi
  cleanup
  TEMPORARY_DIRECTORY=""
}

resolve_runtime
print_runtime_status

if [ "$CHECK_ONLY" -eq 1 ]; then
  if runtime_ready; then
    printf '[bootstrap] Runtime check passed.\n'
    exit 0
  fi
  printf '[bootstrap] Node.js %s or newer with npm is required.\n' "$MINIMUM_NODE_VERSION" >&2
  exit 20
fi

if ! runtime_ready; then
  if [ "$INSTALL_NODE_LTS" -ne 1 ]; then
    printf '[bootstrap] Node.js %s or newer with npm is required. Rerun with --install-node-lts only after the user approves the system change.\n' "$MINIMUM_NODE_VERSION" >&2
    exit 20
  fi
  if [ "$DRY_RUN" -eq 1 ]; then
    if [ "$RUNTIME_ONLY" -eq 1 ]; then
      printf '[dry-run] Install the official Node.js %s LTS package with npm, then stop before installing Lark CLI or Bridge.\n' "$NODE_RELEASE_LINE"
    else
      printf '[dry-run] Install the official Node.js %s LTS package, then install the official Lark CLI before lark-channel-bridge.\n' "$NODE_RELEASE_LINE"
    fi
    exit 0
  fi
  if [ "$OS_NAME" != "Darwin" ]; then
    printf 'Automatic Node.js installation is supported by this script on macOS only. Install Node.js %s or newer with npm, then rerun setup.\n' "$MINIMUM_NODE_VERSION" >&2
    exit 21
  fi
  install_node_macos
  PATH="/usr/local/bin:/opt/homebrew/bin:$PATH"
  export PATH
  resolve_runtime
  print_runtime_status
  if ! runtime_ready; then
    printf 'Node.js installation did not become available. Finish or reopen the installer, then rerun setup. No Bridge package was installed.\n' >&2
    exit 22
  fi
fi

if [ "$RUNTIME_ONLY" -eq 1 ]; then
  printf '[bootstrap] Node.js and npm prerequisites are ready.\n'
  exit 0
fi

export LARK_BRIDGE_MANAGER_NPM="$NPM_COMMAND"
if [ "$DRY_RUN" -eq 1 ]; then
  exec "$NODE_COMMAND" "$MANAGER" install --dry-run
fi
exec "$NODE_COMMAND" "$MANAGER" install
