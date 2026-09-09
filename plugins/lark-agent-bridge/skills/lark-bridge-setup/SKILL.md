---
name: lark-bridge-setup
description: Install and initialize lark-channel-bridge for Claude Code or Codex, including dependency checks, Lark/Feishu QR registration, one profile, a safe permission preset, daemon startup, and connectivity verification. Use when a user asks to install, set up, onboard, or connect Lark Bridge, Feishu Bridge, Claude Code from Lark, or Codex from Lark.
---

# Set up Lark Agent Bridge

Use the plugin's `scripts/bridge-manager.mjs`; do not recreate Bridge behavior or hand-edit credential files.

## Workflow

1. Resolve the plugin root as two directories above this skill directory.
2. Run `node <plugin-root>/scripts/bridge-manager.mjs preflight --json`.
   - Confirm the detected OS and architecture first. Do not proceed when the OS, Node.js, or npm check is an error.
   - Treat the official `@larksuite/cli` and `lark-channel-bridge` results as separate checks. A missing or outdated Lark CLI must be prepared before the Bridge package.
   - On Windows, the manager checks PATH plus standard Node.js, Local AppData, roaming npm, and NVM locations before reporting npm missing.
   - If the npm check still fails with `repairAvailable: true`, explain that the official Node.js LTS package includes npm. Obtain explicit approval before using the system-changing `--install-node-lts` option. Never add that option silently.
3. If exactly one supported agent is installed, use it. If both `claude` and `codex` are installed and the user did not specify one, ask which one to connect.
4. Confirm the workspace directory. Reject `/`, the home directory, system directories, and temporary roots.
5. Ask whether this Bridge profile must access the signed-in user's personal Lark resources, such as Minutes and personal documents.
   - Use `bot-only` when chat replies and bot-owned resources are sufficient.
   - Use `user-default` only after explaining that it permits the agent to use the signed-in user's Lark identity and receiving explicit approval. Minutes generation requires this mode.
6. Default to the `safe-edit` preset. Explain that `read-only` cannot edit files and `full` can access outside the workspace. Never select `full` without explicit confirmation.
7. Show the install command with `--dry-run`, then run `node <plugin-root>/scripts/bridge-manager.mjs install` after the user has requested setup. The manager installs the official `@larksuite/cli` first and then the Bridge. When Windows npm repair was explicitly approved, use `install --install-node-lts --dry-run` for the preview and `install --install-node-lts` for the real run. This installs `OpenJS.NodeJS.LTS` through `winget` only when npm is genuinely unavailable.
8. Create only the selected profile with the upstream CLI:

   ```bash
   lark-channel-bridge profile create <profile> --agent <claude|codex> --workspace <absolute-path>
   ```

   Let the user scan the QR code. Never request that they paste an App Secret into chat. For an existing app, prefer the interactive secret prompt and do not pass `--app-secret` on a command line.
9. Preview and apply the preset with `bridge-manager.mjs preset`. Preserve credentials, access lists, attachments, meetings, and unrelated profiles. For an approved personal-data profile, add both `--lark-cli-identity user-default` and `--confirm-user-default`; otherwise keep the default `bot-only`.
10. Optionally install the managed Bridge-session instruction block with `bridge-manager.mjs rules`. Default to repository scope. Never overwrite hand-written `CLAUDE.md` or `AGENTS.md` content.
11. Start only the newly configured profile. Do not start another profile merely because it exists.
12. Run `bridge-manager.mjs doctor --profile <profile> --json` and `lark-channel-bridge status --profile <profile>`.
13. Ask the user to send `/status` to the bot in Lark. Finish only after the local checks pass and the user confirms the bot replied.

## Boundaries

- Node.js 20.12 or newer, npm, the official Lark CLI, and a logged-in local agent are prerequisites. On Windows, use the guarded `--install-node-lts` repair only with explicit approval; otherwise guide manual installation. Do not claim setup is complete.
- `lark-channel-bridge` is an upstream bridge built on Lark's official Channel SDK; do not describe the bridge package itself as an official Lark package.
- Lark QR approval and local agent login remain user actions.
- Never commit `~/.lark-channel`, exported profiles, logs, App IDs paired with secrets, or tokens.
- Do not use `npx` for the background daemon because temporary npm cache paths can disappear.
- Re-running setup must reuse or explicitly replace a profile; never create duplicates silently.
