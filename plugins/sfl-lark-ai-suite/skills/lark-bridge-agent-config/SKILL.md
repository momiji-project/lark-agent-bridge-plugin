---
name: lark-bridge-agent-config
description: Configure the Claude Code or Codex profile used by lark-channel-bridge, including agent kind, workspace, model default, permissions, concurrency, idle timeout, Lark access, lark-cli identity, and managed repository instructions. Use when the user asks about Bridge agent settings, Developer instructions, CLAUDE.md, AGENTS.md, permission presets, model choice, workspace access, or switching between Claude and Codex.
---

# Configure the Bridge agent

Explain the configuration boundary first:

- Product system/developer messages are controlled by the agent product and cannot be replaced by this plugin.
- Durable project behavior belongs in `CLAUDE.md` for Claude Code and `AGENTS.md` for Codex.
- Bridge runtime choices belong in the selected Bridge profile.
- Secrets and authentication remain outside instruction files.

## Apply a profile preset

1. Resolve the plugin root as two directories above this skill directory.
2. Run `node <plugin-root>/scripts/bridge-manager.mjs doctor --profile <name> --json`.
3. Choose one preset: `read-only`, `safe-edit` (default), or `full` (explicit confirmation required).
4. Choose the Lark CLI identity independently from filesystem permissions.
   - Keep `bot-only` unless the user needs personal Lark resources.
   - Minutes and personal documents require `user-default`. Explain the additional reach and obtain explicit approval first. Complete the profile-private QR device flow from `lark-bridge-setup`, let the agent finish `--device-code` in the next turn, and verify the required scopes before adding `--lark-cli-identity user-default --confirm-user-default`.
   - Do not offer App Secret entry or another OAuth method as a normal alternative. Use the exact verification URL only when the QR is unreadable.
5. Keep the model at `default` unless the user names a model. Do not copy model IDs between Claude and Codex.
6. Preview the exact change:

   ```bash
   node <plugin-root>/scripts/bridge-manager.mjs preset \
     --profile <name> --preset <preset> --workspace <absolute-path> --dry-run
   ```

7. Apply only after the preview is accepted. Preserve credentials, allowlists, unrelated preferences, and other profiles.
8. Restart only if the changed field requires it, and only if that profile was running before the change. When this Skill is running inside the same active Lark profile, report that a restart is required and let a local session perform it after the current reply is delivered.

## Install managed Developer-style instructions

Use the plugin's `rules` command to install `assets/rules/bridge-session.md` into the target repository's native instruction file.

```bash
node <plugin-root>/scripts/bridge-manager.mjs rules \
  --agent <claude|codex> --target <repository-root> --dry-run
```

After review, repeat without `--dry-run`.

- Write only inside `BEGIN LARK_AGENT_BRIDGE` / `END LARK_AGENT_BRIDGE` markers.
- Preserve all hand-written content outside the markers.
- Create a timestamped backup before changing an existing file.
- The managed rules activate only when `LARK_CHANNEL=1`.
- Prefer repository scope. Change a global instruction file only when explicitly requested.

Do not patch the Bridge package's internal system prompt or edit `dist/cli.js`; upgrades would erase the change.
