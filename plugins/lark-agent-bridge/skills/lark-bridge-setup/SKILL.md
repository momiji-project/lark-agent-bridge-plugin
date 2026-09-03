---
name: lark-bridge-setup
description: Install and initialize lark-channel-bridge for Claude Code or Codex, including dependency checks, Lark/Feishu QR registration, one profile, a safe permission preset, daemon startup, and connectivity verification. Use when a user asks to install, set up, onboard, or connect Lark Bridge, Feishu Bridge, Claude Code from Lark, or Codex from Lark.
---

# Set up Lark Agent Bridge

Use the plugin's `scripts/bridge-manager.mjs`; do not recreate Bridge behavior or hand-edit credential files.

## Workflow

1. Resolve the plugin root as two directories above this skill directory.
2. Run `node <plugin-root>/scripts/bridge-manager.mjs preflight --json`.
3. If exactly one supported agent is installed, use it. If both `claude` and `codex` are installed and the user did not specify one, ask which one to connect.
4. Confirm the workspace directory. Reject `/`, the home directory, system directories, and temporary roots.
5. Default to the `safe-edit` preset. Explain that `read-only` cannot edit files and `full` can access outside the workspace. Never select `full` without explicit confirmation.
6. Show the install command with `--dry-run`, then run `node <plugin-root>/scripts/bridge-manager.mjs install` after the user has requested setup.
7. Create only the selected profile with the upstream CLI:

   ```bash
   lark-channel-bridge profile create <profile> --agent <claude|codex> --workspace <absolute-path>
   ```

   Let the user scan the QR code. Never request that they paste an App Secret into chat. For an existing app, prefer the interactive secret prompt and do not pass `--app-secret` on a command line.
8. Preview and apply the preset with `bridge-manager.mjs preset`. Preserve credentials, access lists, attachments, meetings, and unrelated profiles.
9. Optionally install the managed Bridge-session instruction block with `bridge-manager.mjs rules`. Default to repository scope. Never overwrite hand-written `CLAUDE.md` or `AGENTS.md` content.
10. Start only the newly configured profile. Do not start another profile merely because it exists.
11. Run `bridge-manager.mjs doctor --profile <profile> --json` and `lark-channel-bridge status --profile <profile>`.
12. Ask the user to send `/status` to the bot in Lark. Finish only after the local checks pass and the user confirms the bot replied.

## Boundaries

- Node.js 20.12 or newer and a logged-in local agent are prerequisites. Guide installation or login when missing; do not claim setup is complete.
- Lark QR approval and local agent login remain user actions.
- Never commit `~/.lark-channel`, exported profiles, logs, App IDs paired with secrets, or tokens.
- Do not use `npx` for the background daemon because temporary npm cache paths can disappear.
- Re-running setup must reuse or explicitly replace a profile; never create duplicates silently.
