---
name: lark-bridge-doctor
description: Diagnose lark-channel-bridge without changing configuration. Use when Lark Bridge is silent, stopped, disconnected, cannot launch Claude Code or Codex, has a broken daemon, wrong workspace, old Node or Bridge version, missing agent login, or when the user asks for a health check or status report.
---

# Diagnose Lark Agent Bridge

Keep diagnosis read-only unless the user separately asks for a repair.

## Procedure

1. Resolve the plugin root as two directories above this skill directory.
2. Run:

   ```bash
   node <plugin-root>/scripts/bridge-manager.mjs doctor --json
   lark-channel-bridge profile list
   lark-channel-bridge ps
   ```

3. If a profile was named, add `--profile <name>` to the doctor command and check `lark-channel-bridge status --profile <name>`.
4. Report each layer separately: Node.js requirement, agent binary, Bridge version, profile, daemon, workspace, and log paths.
5. Do not print config values whose key contains `secret`, `token`, `credential`, `password`, or `key`.
6. Recommend the smallest repair command. Do not run install, update, restart, unregister, remove, or purge while diagnosing.

## Common outcomes

- Missing Bridge: use `lark-bridge-setup`.
- Old Bridge: use `lark-bridge-update`.
- Missing or wrong agent profile: use `lark-bridge-agent-config`.
- Agent not logged in: ask the user to complete the agent's local login.
- Daemon stopped: offer `lark-channel-bridge start --profile <name>`.
- Bot silent with a healthy daemon: check owner/access rules and ask the owner to send `/status` in a direct chat.
