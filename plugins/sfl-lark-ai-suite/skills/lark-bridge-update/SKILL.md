---
name: lark-bridge-update
description: Safely update the globally installed lark-channel-bridge runtime while preserving profiles, encrypted secrets, workspaces, access lists, and intentionally stopped daemons. Use when the user asks to update or upgrade Lark Bridge, check its latest compatible version, repair an outdated installation, or roll back after an update.
---

# Update Lark Agent Bridge

Use the compatibility manifest and deterministic update command. Do not edit npm package files in place.

## Procedure

1. Resolve the plugin root as two directories above this skill directory.
2. Run `node <plugin-root>/scripts/bridge-manager.mjs doctor --json` and record exactly which profiles are running.
3. Read `<plugin-root>/compatibility.json`. Default to its `testedVersion`; do not automatically jump to an untested major or minor release.
4. Preview `node <plugin-root>/scripts/bridge-manager.mjs update --dry-run`.
5. Run the update only after the user has requested it.
6. Re-run doctor and Bridge status.
7. Restart only profiles that were running before the update. Never start a stopped profile.
8. If verification fails, report the error and use the backup/rollback information emitted by the manager. Do not delete `~/.lark-channel`.

## Safety

- Never export profiles with secrets for routine updates.
- Never display or commit encrypted secret stores, App Secrets, or access tokens.
- Keep plugin version and Bridge runtime version independent.
- Recommend a new agent conversation after updating this plugin so refreshed Skills are loaded.
