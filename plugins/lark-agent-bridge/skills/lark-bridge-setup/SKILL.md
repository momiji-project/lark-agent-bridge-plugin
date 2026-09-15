---
name: lark-bridge-setup
description: Legacy compatibility entry for existing users who explicitly invoke lark-bridge-setup. It diagnoses and installs Node.js/npm, the official Lark CLI, and lark-channel-bridge. New initial setup requests should use lark-setup instead.
---

# Set up Lark Agent Bridge

This is a compatibility entry. For a new installation, use `lark-setup` as the single standard entry point. When explicitly invoked, keep the full diagnostic-first behavior below.

Use the plugin's native bootstrap and `scripts/bridge-manager.mjs`; do not recreate Bridge behavior or hand-edit credential files.

## Direct terminal entry

`$lark-bridge-setup` and `/lark-bridge-setup` are agent/Skill invocations, not terminal commands. When the user explicitly asks to complete setup from Terminal or PowerShell, execute the plugin's terminal wizard instead of presenting a Skill invocation:

- macOS or Linux: `bash <plugin-root>/scripts/terminal-setup.sh`
- Windows: `powershell -NoProfile -ExecutionPolicy Bypass -File <plugin-root>\scripts\terminal-setup.ps1`

The terminal wizard performs the runtime bootstrap, asks only for missing choices, creates or explicitly reuses one profile, applies `safe-edit`, starts or reloads that selected profile, and runs diagnostics. When the user says the Bridge will also be used for meeting minutes, the wizard uses one fixed authentication route: it generates a QR code from Lark's device-flow URL, keeps the identical URL as a fallback, waits for approval, verifies the required Minutes/Docs scopes, and only then enables `user-default`. It must not temporarily start or reload a profile in `user-default` before that verification passes. Do not claim a terminal-only flow is complete merely because the Skill can run the same commands.

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
8. Determine the purpose, not the authentication method.
   - If the user already said that the Bridge is for meeting minutes, Minutes, or personal documents, select the personal-data branch without asking again.
   - If the user said Bridge-only or chat replies only, select the bot-only branch without asking again.
   - Only when the purpose is unclear, ask one question: whether this Bridge will also be used for meeting minutes.
   - Use `bot-only` when chat replies and bot-owned resources are sufficient.
   - Use `user-default` only after explaining that it permits the agent to use the signed-in user's Lark identity and receiving explicit approval. Minutes generation requires this mode.
   - Do not offer a menu of authentication methods. When personal access is required, QR plus device flow is the fixed normal route.
9. Default to the `safe-edit` preset. Explain that `read-only` cannot edit files and `full` can access outside the workspace. Never select `full` without explicit confirmation.
10. Create only the selected profile with the upstream CLI:

    ```bash
    lark-channel-bridge profile create <profile> --agent <claude|codex> --workspace <absolute-path>
    ```

    Omitting `--app-id` selects the upstream QR-registration route. Do not ask the user to choose another registration method. Keep the exact registration URL visible as a fallback if the QR cannot be read. Never request that they paste an App Secret into chat or pass `--app-secret` on the command line in the normal setup route.
11. For the approved personal-data branch, verify profile-private user authentication before enabling `user-default`:
    - Set the selected profile's `LARK_CHANNEL_*` and `LARKSUITE_CLI_CONFIG_DIR` environment variables as the terminal wizard does.
    - Run `lark-cli auth status --json --verify`. If the user identity is already valid and includes `minutes:minutes.basic:read`, `minutes:minutes.search:read`, and `docx:document:create`, reuse it.
    - Otherwise, run `lark-cli auth login --domain minutes --domain docs --no-wait --json`. Extract `verification_url` (or `verification_uri_complete`) and `device_code` from JSON. Treat the URL as opaque.
    - Generate a PNG QR code with `lark-cli auth qrcode <exact-url> --output <relative-file>`. Show the unchanged URL first as the fallback and the QR image second as the primary approval action. Tell the user to return after approval, then end the current turn. Do not immediately block on `--device-code` in the same agent turn.
    - After the user confirms approval in the next turn, the agent must run `lark-cli auth login --device-code <device_code> --json` itself and repeat `auth status --json --verify`. Never ask the user to run the device-code command. Do not persist or reuse an expired URL or device code; begin a new flow if the pending flow is lost or expires.
    - In an interactive Terminal/PowerShell wizard, it is valid to keep the visible terminal open and wait for `--device-code` after showing the QR because the user can see the approval instructions immediately.
12. Preview and apply the preset with `bridge-manager.mjs preset`. Preserve credentials, access lists, attachments, meetings, and unrelated profiles. Apply `user-default` only after step 11 passes, using both `--lark-cli-identity user-default` and `--confirm-user-default`; otherwise keep `bot-only`.
13. Optionally install the managed Bridge-session instruction block with `bridge-manager.mjs rules`. Default to repository scope. Never overwrite hand-written `CLAUDE.md` or `AGENTS.md` content.
14. After its selected identity is ready, start a newly created or stopped profile once. If the explicitly reused profile was already running and its managed settings changed, restart only that profile so the verified identity is loaded. Do not start or restart another profile merely because it exists.
15. Run `bridge-manager.mjs doctor --profile <profile> --json` and `lark-channel-bridge status --profile <profile>`.
16. Ask the user to send `/status` to the bot in Lark. Finish only after the local checks pass and the user confirms the bot replied.

## Boundaries

- Node.js installation is part of setup, not an unrelated prerequisite. Diagnose first, preview the exact system change, obtain approval, install, and recheck before continuing.
- `lark-channel-bridge` is an upstream bridge built on Lark's official Channel SDK; do not describe the bridge package itself as an official Lark package.
- Lark QR approval, the macOS installer window when required, and local agent login remain user actions. The setup agent performs the device-code completion and post-auth scope verification.
- Never commit `~/.lark-channel`, exported profiles, logs, App IDs paired with secrets, or tokens.
- Do not use `npx` for the background daemon because temporary npm cache paths can disappear.
- Re-running setup must reuse or explicitly replace a profile; never create duplicates silently.
