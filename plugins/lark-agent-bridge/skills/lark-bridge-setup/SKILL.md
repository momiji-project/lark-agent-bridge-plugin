---
name: lark-bridge-setup
description: Install and initialize lark-channel-bridge for Claude Code or Codex on Windows or macOS, including Node.js/npm bootstrap, official Lark CLI setup, QR registration, one profile, a safe permission preset, daemon startup, and connectivity verification. Use when a user asks to install, set up, onboard, or connect Lark Bridge, Feishu Bridge, Claude Code from Lark, or Codex from Lark.
---

# Set up Lark Agent Bridge

Use the plugin's native bootstrap and `scripts/bridge-manager.mjs`; do not recreate Bridge behavior or hand-edit credential files.

## Workflow

1. Resolve the plugin root as two directories above this skill directory.
2. Detect the OS before calling Node.js:
   - Windows: run `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\bootstrap-windows.ps1 -CheckOnly`.
   - macOS or Linux: run `bash <plugin-root>/scripts/bootstrap.sh --check-only`.
   - Report the detected OS, architecture, Node.js, and npm results. Do not install the official Lark CLI or Bridge while this runtime gate is failing.
3. If Node.js 20.12 or newer with npm is missing or unusable, explain that Node.js is required and that the next action changes the PC. Obtain explicit approval, then preview and run the OS-native repair:
   - Windows preview: `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\bootstrap-windows.ps1 -InstallNodeLts -DryRun`.
   - Windows install: `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\bootstrap-windows.ps1 -InstallNodeLts`.
   - macOS preview: `bash <plugin-root>/scripts/bootstrap.sh --install-node-lts --dry-run`.
   - macOS install: `bash <plugin-root>/scripts/bootstrap.sh --install-node-lts`.
   - Windows uses Windows Package Manager and the official `OpenJS.NodeJS.LTS` package. macOS downloads the official Node.js 22 LTS installer, verifies its SHA-256 checksum and package signature, and opens the standard installer. Never add the install flag without approval.
   - If Windows lacks `winget`, or the macOS installer is cancelled, stop before installing the Lark CLI or Bridge and give the exact recovery step.
4. If the runtime gate already passes, preview and run the same bootstrap without the Node.js installation flag:
   - Windows: use `-DryRun`, then run without switches.
   - macOS or Linux: use `--dry-run`, then run without switches.
   The bootstrap invokes the manager, which installs or updates the official `@larksuite/cli` first and `lark-channel-bridge` second.
5. Run `node <plugin-root>/scripts/bridge-manager.mjs preflight --json` after bootstrap. Treat the official Lark CLI and Bridge as separate checks. Stop if either remains missing, outdated, or resolves from an unexpected installation.
6. If exactly one supported agent is installed, use it. If both `claude` and `codex` are installed and the user did not specify one, ask which one to connect.
7. Confirm the workspace directory. Reject `/`, the home directory, system directories, and temporary roots.
8. Ask whether this Bridge profile must access the signed-in user's personal Lark resources, such as Minutes and personal documents.
   - Use `bot-only` when chat replies and bot-owned resources are sufficient.
   - Use `user-default` only after explaining that it permits the agent to use the signed-in user's Lark identity and receiving explicit approval. Minutes generation requires this mode.
9. Default to the `safe-edit` preset. Explain that `read-only` cannot edit files and `full` can access outside the workspace. Never select `full` without explicit confirmation.
10. Create only the selected profile with the upstream CLI:

    ```bash
    lark-channel-bridge profile create <profile> --agent <claude|codex> --workspace <absolute-path>
    ```

    Let the user scan the QR code. Never request that they paste an App Secret into chat. For an existing app, prefer the interactive secret prompt and do not pass `--app-secret` on a command line.
11. Preview and apply the preset with `bridge-manager.mjs preset`. Preserve credentials, access lists, attachments, meetings, and unrelated profiles. For an approved personal-data profile, add both `--lark-cli-identity user-default` and `--confirm-user-default`; otherwise keep the default `bot-only`.
12. Optionally install the managed Bridge-session instruction block with `bridge-manager.mjs rules`. Default to repository scope. Never overwrite hand-written `CLAUDE.md` or `AGENTS.md` content.
13. Start only the newly configured profile. Do not start another profile merely because it exists.
14. Run `bridge-manager.mjs doctor --profile <profile> --json` and `lark-channel-bridge status --profile <profile>`.
15. Ask the user to send `/status` to the bot in Lark. Finish only after the local checks pass and the user confirms the bot replied.

## Boundaries

- Node.js installation is part of setup, not an unrelated prerequisite. Diagnose first, preview the exact system change, obtain approval, install, and recheck before continuing.
- `lark-channel-bridge` is an upstream bridge built on Lark's official Channel SDK; do not describe the bridge package itself as an official Lark package.
- Lark QR approval, the macOS installer window when required, and local agent login remain user actions.
- Never commit `~/.lark-channel`, exported profiles, logs, App IDs paired with secrets, or tokens.
- Do not use `npx` for the background daemon because temporary npm cache paths can disappear.
- Re-running setup must reuse or explicitly replace a profile; never create duplicates silently.
