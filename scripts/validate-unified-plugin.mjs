#!/usr/bin/env node

import { lstat, readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const pluginName = "sfl-lark-ai-suite";
const pluginRoot = join(repositoryRoot, "plugins", pluginName);
const failures = [];

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    failures.push(`${file}: invalid JSON (${error instanceof Error ? error.message : "unknown error"})`);
    return null;
  }
}

function requireValue(condition, message) {
  if (!condition) failures.push(message);
}

async function walk(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name);
    paths.push(child);
    if (entry.isDirectory()) paths.push(...(await walk(child)));
  }
  return paths;
}

const codexManifest = await readJson(join(pluginRoot, ".codex-plugin", "plugin.json"));
const claudeManifest = await readJson(join(pluginRoot, ".claude-plugin", "plugin.json"));
const compatibility = await readJson(join(pluginRoot, "compatibility.json"));
const codexMarketplace = await readJson(join(repositoryRoot, ".agents", "plugins", "marketplace.json"));
const claudeMarketplace = await readJson(join(repositoryRoot, ".claude-plugin", "marketplace.json"));

for (const manifest of [codexManifest, claudeManifest]) {
  requireValue(manifest?.name === pluginName, "unified plugin manifest name mismatch");
  requireValue(/^\d+\.\d+\.\d+$/.test(manifest?.version ?? ""), "unified plugin version must be strict semver");
}
requireValue(codexManifest?.version === claudeManifest?.version, "Claude and Codex unified plugin versions must match");
requireValue(compatibility?.pluginVersion === codexManifest?.version, "unified compatibility pluginVersion must match manifest");

for (const [label, marketplace] of [["Codex", codexMarketplace], ["Claude", claudeMarketplace]]) {
  const entry = marketplace?.plugins?.find((candidate) => candidate.name === pluginName);
  requireValue(Boolean(entry), `${label} marketplace is missing ${pluginName}`);
  const source = typeof entry?.source === "string" ? entry.source : entry?.source?.path;
  requireValue(source === `./plugins/${pluginName}`, `${label} marketplace source mismatch`);
}

const expectedSkills = [
  "sfl-lark-setup",
  "lark-bridge-setup",
  "lark-bridge-doctor",
  "lark-bridge-agent-config",
  "lark-bridge-update",
  "gijiroku-image-setup",
  "gijiroku-image",
];
const actualSkills = await readdir(join(pluginRoot, "skills"));
for (const skillName of expectedSkills) {
  requireValue(actualSkills.includes(skillName), `missing unified skill: ${skillName}`);
  const skillPath = join(pluginRoot, "skills", skillName, "SKILL.md");
  const skill = await readFile(skillPath, "utf8");
  requireValue(skill.startsWith("---\n"), `${skillPath}: missing YAML frontmatter`);
  requireValue(skill.includes(`name: ${skillName}`), `${skillPath}: name must match directory`);
  requireValue(!skill.includes("TODO"), `${skillPath}: TODO placeholder remains`);
}

for (const required of [
  "scripts/bridge-manager.mjs",
  "scripts/gijiroku-config.mjs",
  "scripts/deliver-image.mjs",
  "scripts/render_minutes.py",
  "scripts/selfcheck.sh",
  "assets/presets/safe-edit.json",
]) {
  try {
    await lstat(join(pluginRoot, required));
  } catch {
    failures.push(`missing unified component: ${required}`);
  }
}

const forbiddenNames = /(^|\/)(secrets\.enc|config\.json|profile\.json|\.env|__pycache__)(\/|$)/;
for (const file of await walk(pluginRoot)) {
  const relative = file.slice(pluginRoot.length + 1);
  const info = await lstat(file);
  requireValue(!info.isSymbolicLink(), `${relative}: symlinks are not allowed`);
  requireValue(!forbiddenNames.test(relative), `${relative}: secret or cache path is forbidden`);
}

if (failures.length) {
  process.stderr.write(`${failures.map((failure) => `- ${failure}`).join("\n")}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("Unified plugin validation passed.\n");
}
