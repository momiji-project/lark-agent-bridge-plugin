---
name: lark-bridge-setup
description: Legacy compatibility entry for existing users who explicitly invoke lark-bridge-setup. New users must complete the standalone read-only diagnosis before installing this Plugin, then use lark-setup only after reviewing the result.
---

# Set up Lark Agent Bridge

This is a compatibility entry. New users must not install the Plugin in order to diagnose. Before Plugin installation, run the OS-specific standalone read-only PowerShell or shell diagnosis shown in the SFL installation guide and stop after reporting the result. Do not use `codex exec --sandbox read-only` for the Windows pre-install diagnosis. Use `lark-setup` only when the user then explicitly requests installation. The Plugin's `lark-diagnose` is for post-installation rechecks only.

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
8. Determine the purpose, not the authentication method. Use the personal-data branch without asking again when the user already requested Minutes or personal documents; use the bot-only branch when they requested chat replies only. Ask whether the Bridge will also be used for meeting minutes only when the purpose is unclear.
   - Use `bot-only` when chat replies and bot-owned resources are sufficient.
   - Use `user-default` only after explaining that it permits the agent to use the signed-in user's Lark identity and receiving explicit approval. Minutes generation requires this mode.
   - Do not offer authentication-method choices. Personal access always uses the QR device flow below.
9. Default to the `safe-edit` preset. Explain that `read-only` cannot edit files and `full` can access outside the workspace. Never select `full` without explicit confirmation.
10. Create only the selected profile with the upstream CLI:

    ```bash
    lark-channel-bridge profile create <profile> --agent <claude|codex> --workspace <absolute-path>
    ```

    Omitting `--app-id` selects the upstream QR-registration route. Do not ask the user to choose another registration method. Keep the exact registration URL visible as a fallback. Never request that they paste an App Secret into chat or pass `--app-secret` on the command line in the normal route.
11. For personal access, run the profile-private split-flow before enabling `user-default`: verify `auth status --json --verify`; if required, start `auth login --domain minutes --domain docs --no-wait --json`, show the exact URL plus a generated PNG QR, ask the user to return after approval, and end the turn. In the next turn, the agent must run `auth login --device-code <device_code> --json` and verify Minutes/Docs scopes. Do not persist or reuse expired authorization data. A visible interactive terminal may wait after showing the QR.
12. Preview and apply the preset with `bridge-manager.mjs preset`. Preserve credentials, access lists, attachments, meetings, and unrelated profiles. Apply `user-default` only after step 11 passes, with both `--lark-cli-identity user-default` and `--confirm-user-default`; otherwise keep `bot-only`.
13. Optionally install the managed Bridge-session instruction block with `bridge-manager.mjs rules`. Default to repository scope. Never overwrite hand-written `CLAUDE.md` or `AGENTS.md` content.
14. Start only the configured profile after its selected identity is ready. Do not start another profile merely because it exists.
15. Run `bridge-manager.mjs doctor --profile <profile> --json` and `lark-channel-bridge status --profile <profile>`.
16. Ask the user to send `/status` to the bot in Lark. Finish only after the local checks pass and the user confirms the bot replied.

## Boundaries

- Node.js installation is part of setup, not an unrelated prerequisite. Diagnose first, preview the exact system change, obtain approval, install, and recheck before continuing.
- `lark-channel-bridge` is an upstream bridge built on Lark's official Channel SDK; do not describe the bridge package itself as an official Lark package.
- Lark QR approval, the macOS installer window when required, and local agent login remain user actions.
- Never commit `~/.lark-channel`, exported profiles, logs, App IDs paired with secrets, or tokens.
- Do not use `npx` for the background daemon because temporary npm cache paths can disappear.
- Re-running setup must reuse or explicitly replace a profile; never create duplicates silently.
