import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(TEST_DIR, "../scripts/bridge-manager.mjs");
const TEMP_DIRS = [];

async function tempDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "lark-bridge-manager-test-"));
  TEMP_DIRS.push(directory);
  return directory;
}

test.after(async () => {
  await Promise.all(TEMP_DIRS.map((directory) => rm(directory, { recursive: true, force: true })));
});

async function writeJson(file, value, mode = 0o600) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, { mode });
}

function runManager(args, env) {
  return spawnSync(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, ...env },
    cwd: env.TEST_CWD || process.cwd(),
    encoding: "utf8",
    timeout: 30_000,
  });
}

function baseConfig(workspace, overrides = {}) {
  return {
    schemaVersion: 2,
    activeProfile: "alpha",
    preferences: { locale: "ja" },
    profiles: {
      alpha: {
        schemaVersion: 2,
        agentKind: "claude",
        accounts: { app: { id: "cli_test", secret: { source: "exec", provider: "bridge" } } },
        permissions: { defaultAccess: "full", maxAccess: "full", keepMe: true },
        workspaces: { default: workspace, named: { project: workspace } },
        preferences: { previousSetting: "preserved", showToolCalls: true },
        access: {
          allowedUsers: ["ou_user"],
          allowedChats: ["oc_chat"],
          admins: ["ou_admin"],
          requireMentionInGroup: false,
        },
        larkCli: { previousSetting: "preserved", identityPreset: "user-default" },
        custom: { preserved: true },
      },
    },
    ...overrides,
  };
}

async function makeFakeCommands(directory, { initialVersion = "0.6.1", runningProfiles = [] } = {}) {
  const stateDirectory = path.join(directory, "fake-state");
  const versionFile = path.join(stateDirectory, "version.txt");
  const logFile = path.join(stateDirectory, "commands.jsonl");
  await mkdir(stateDirectory, { recursive: true });
  await writeFile(versionFile, initialVersion);
  await writeFile(logFile, "");

  const bridgeScript = path.join(stateDirectory, "bridge.mjs");
  await writeFile(
    bridgeScript,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify({ command: "bridge", args }) + "\\n");
if (args.includes("--version")) {
  console.log(fs.readFileSync(process.env.FAKE_VERSION_FILE, "utf8").trim());
  process.exit(0);
}
if (args[0] === "status") {
  const profile = args[args.indexOf("--profile") + 1];
  const running = new Set((process.env.FAKE_RUNNING_PROFILES || "").split(",").filter(Boolean));
  if (running.has(profile)) console.log("✓ bot is running in the background\\n  Process ID: 43210");
  else console.log("bot is currently stopped");
  process.exit(0);
}
if (args[0] === "restart") process.exit(0);
process.exit(2);
`,
    { mode: 0o700 },
  );
  await chmod(bridgeScript, 0o700);

  const npmScript = path.join(stateDirectory, "npm.mjs");
  await writeFile(
    npmScript,
    `#!/usr/bin/env node
import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_COMMAND_LOG, JSON.stringify({ command: "npm", args }) + "\\n");
if (args.includes("--version")) {
  console.log("10.8.2");
  process.exit(0);
}
const spec = args.find((arg) => arg.startsWith("lark-channel-bridge@"));
if (!spec) process.exit(2);
fs.writeFileSync(process.env.FAKE_VERSION_FILE, spec.slice(spec.lastIndexOf("@") + 1));
`,
    { mode: 0o700 },
  );
  await chmod(npmScript, 0o700);

  let bridge = bridgeScript;
  let npm = npmScript;
  if (process.platform === "win32") {
    bridge = path.join(stateDirectory, "bridge.cmd");
    npm = path.join(stateDirectory, "npm.cmd");
    await writeFile(bridge, `@echo off\r\n"${process.execPath}" "${bridgeScript}" %*\r\n`);
    await writeFile(npm, `@echo off\r\n"${process.execPath}" "${npmScript}" %*\r\n`);
  }

  return {
    LARK_BRIDGE_MANAGER_BRIDGE: bridge,
    LARK_BRIDGE_MANAGER_NPM: npm,
    LARK_BRIDGE_MANAGER_CLAUDE: process.execPath,
    LARK_BRIDGE_MANAGER_CODEX: process.execPath,
    FAKE_COMMAND_LOG: logFile,
    FAKE_VERSION_FILE: versionFile,
    FAKE_RUNNING_PROFILES: runningProfiles.join(","),
    logFile,
    versionFile,
  };
}

async function commandLog(file) {
  const text = await readFile(file, "utf8");
  return text.trim() ? text.trim().split("\n").map((line) => JSON.parse(line)) : [];
}

test("preset merges only managed fields and creates a private backup", async () => {
  const root = await tempDirectory();
  const home = path.join(root, "home");
  const state = path.join(home, ".lark-channel");
  const workspace = path.join(root, "workspace");
  const configPath = path.join(state, "config.json");
  await mkdir(workspace, { recursive: true });
  const original = baseConfig(workspace);
  await writeJson(configPath, original, 0o644);

  const result = runManager(
    [
      "preset",
      "--profile",
      "alpha",
      "--preset",
      "safe-edit",
      "--agent",
      "claude",
      "--workspace",
      workspace,
      "--json",
    ],
    { HOME: home, LARK_CHANNEL_HOME: state, TEST_CWD: root },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(updated.preferences, original.preferences);
  assert.deepEqual(updated.profiles.alpha.custom, { preserved: true });
  assert.equal(updated.profiles.alpha.permissions.keepMe, true);
  assert.equal(updated.profiles.alpha.permissions.defaultAccess, "workspace");
  assert.equal(updated.profiles.alpha.permissions.maxAccess, "workspace");
  assert.deepEqual(updated.profiles.alpha.workspaces.named, original.profiles.alpha.workspaces.named);
  assert.equal(updated.profiles.alpha.workspaces.default, await pathRealpath(workspace));
  assert.deepEqual(updated.profiles.alpha.access.allowedUsers, ["ou_user"]);
  assert.deepEqual(updated.profiles.alpha.access.allowedChats, ["oc_chat"]);
  assert.deepEqual(updated.profiles.alpha.access.admins, ["ou_admin"]);
  assert.equal(updated.profiles.alpha.access.requireMentionInGroup, true);
  assert.equal(updated.profiles.alpha.preferences.previousSetting, "preserved");
  assert.deepEqual(
    {
      model: updated.profiles.alpha.preferences.model,
      messageReply: updated.profiles.alpha.preferences.messageReply,
      messageReplyMigrated: updated.profiles.alpha.preferences.messageReplyMigrated,
      showToolCalls: updated.profiles.alpha.preferences.showToolCalls,
      cotMessages: updated.profiles.alpha.preferences.cotMessages,
      maxConcurrentRuns: updated.profiles.alpha.preferences.maxConcurrentRuns,
      runIdleTimeoutMinutes: updated.profiles.alpha.preferences.runIdleTimeoutMinutes,
    },
    {
      model: "default",
      messageReply: "text",
      messageReplyMigrated: true,
      showToolCalls: false,
      cotMessages: "off",
      maxConcurrentRuns: 1,
      runIdleTimeoutMinutes: 10,
    },
  );
  assert.equal(updated.profiles.alpha.larkCli.previousSetting, "preserved");
  assert.equal(updated.profiles.alpha.larkCli.identityPreset, "bot-only");
  assert.deepEqual(JSON.parse(await readFile(payload.backupPath, "utf8")), original);
  if (process.platform !== "win32") {
    const { mode } = await import("node:fs/promises").then(({ stat }) => stat(configPath));
    assert.equal(mode & 0o777, 0o600);
  }
  const backupsBefore = (await readdir(state)).filter((name) => name.startsWith("config.json.backup-"));
  const repeated = runManager(
    [
      "preset",
      "--profile",
      "alpha",
      "--preset",
      "safe-edit",
      "--agent",
      "claude",
      "--workspace",
      workspace,
      "--json",
    ],
    { HOME: home, LARK_CHANNEL_HOME: state, TEST_CWD: root },
  );
  assert.equal(repeated.status, 0, repeated.stderr || repeated.stdout);
  assert.equal(JSON.parse(repeated.stdout).changed, false);
  const backupsAfter = (await readdir(state)).filter((name) => name.startsWith("config.json.backup-"));
  assert.deepEqual(backupsAfter, backupsBefore);
});

async function pathRealpath(value) {
  return await import("node:fs/promises").then(({ realpath }) => realpath(value));
}

test("preset dry-run does not change config or create backup", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  const configPath = path.join(state, "config.json");
  await mkdir(workspace, { recursive: true });
  const original = baseConfig(workspace);
  await writeJson(configPath, original);

  const result = runManager(
    [
      "preset",
      "--profile",
      "alpha",
      "--preset",
      "read-only",
      "--agent",
      "claude",
      "--workspace",
      workspace,
      "--dry-run",
      "--json",
    ],
    { HOME: path.join(root, "home"), LARK_CHANNEL_HOME: state, TEST_CWD: root },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), original);
  assert.deepEqual((await readdir(state)).sort(), ["config.json"]);
});

test("preset refuses to silently change an existing profile agent", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  const configPath = path.join(state, "config.json");
  await mkdir(workspace, { recursive: true });
  const original = baseConfig(workspace);
  await writeJson(configPath, original);

  const result = runManager(
    [
      "preset",
      "--profile",
      "alpha",
      "--preset",
      "safe-edit",
      "--agent",
      "codex",
      "--workspace",
      workspace,
      "--json",
    ],
    { HOME: path.join(root, "home"), LARK_CHANNEL_HOME: state, TEST_CWD: root },
  );
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /refusing to change/);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), original);
});

test("full preset requires explicit confirmation", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  const configPath = path.join(state, "config.json");
  await mkdir(workspace, { recursive: true });
  const original = baseConfig(workspace);
  await writeJson(configPath, original);
  const commonArgs = [
    "preset",
    "--profile",
    "alpha",
    "--preset",
    "full",
    "--agent",
    "claude",
    "--workspace",
    workspace,
    "--json",
  ];
  const env = { HOME: path.join(root, "home"), LARK_CHANNEL_HOME: state, TEST_CWD: root };

  const rejected = runManager(commonArgs, env);
  assert.equal(rejected.status, 2);
  assert.match(JSON.parse(rejected.stdout).error, /--confirm-full/);
  assert.deepEqual(JSON.parse(await readFile(configPath, "utf8")), original);

  const confirmed = runManager([...commonArgs.slice(0, -1), "--confirm-full", "--json"], env);
  assert.equal(confirmed.status, 0, confirmed.stderr || confirmed.stdout);
  const updated = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(updated.profiles.alpha.permissions.defaultAccess, "full");
  assert.equal(updated.profiles.alpha.permissions.maxAccess, "full");
});

test("rules appends a managed CLAUDE block, preserves manual text, and is idempotent", async () => {
  const root = await tempDirectory();
  const repository = path.join(root, "repository");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  const targetFile = path.join(repository, "CLAUDE.md");
  const manual = "# Project rules\n\nKeep this handwritten section.\n";
  await writeFile(targetFile, manual, { mode: 0o644 });

  const first = runManager(["rules", "--agent", "claude", "--target", repository, "--json"], {
    HOME: path.join(root, "home"),
  });
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const firstPayload = JSON.parse(first.stdout);
  assert.equal(firstPayload.changed, true);
  assert.deepEqual(await readFile(firstPayload.backupPath, "utf8"), manual);
  const rulesAsset = (await readFile(path.resolve(TEST_DIR, "../assets/rules/bridge-session.md"), "utf8"))
    .replaceAll("\r\n", "\n")
    .trim();
  const updated = await readFile(targetFile, "utf8");
  assert.equal(updated.startsWith(manual), true);
  assert.equal(updated.includes(rulesAsset), true);
  assert.equal(updated.match(/<!-- BEGIN LARK_AGENT_BRIDGE -->/g)?.length, 1);
  assert.equal(updated.match(/<!-- END LARK_AGENT_BRIDGE -->/g)?.length, 1);
  const backupsBefore = (await readdir(repository)).filter((name) => name.startsWith("CLAUDE.md.backup-"));

  const second = runManager(["rules", "--agent", "claude", "--target", repository, "--json"], {
    HOME: path.join(root, "home"),
  });
  assert.equal(second.status, 0, second.stderr || second.stdout);
  assert.equal(JSON.parse(second.stdout).changed, false);
  assert.equal(await readFile(targetFile, "utf8"), updated);
  const backupsAfter = (await readdir(repository)).filter((name) => name.startsWith("CLAUDE.md.backup-"));
  assert.deepEqual(backupsAfter, backupsBefore);
});

test("rules replaces only a stale managed AGENTS block and supports dry-run", async () => {
  const root = await tempDirectory();
  const repository = path.join(root, "repository");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  const targetFile = path.join(repository, "AGENTS.md");
  const stale = [
    "Manual before",
    "<!-- BEGIN LARK_AGENT_BRIDGE -->",
    "obsolete managed content",
    "<!-- END LARK_AGENT_BRIDGE -->",
    "Manual after",
    "",
  ].join("\n");
  await writeFile(targetFile, stale);

  const dryRun = runManager(["rules", "--agent", "codex", "--target", repository, "--dry-run", "--json"], {
    HOME: path.join(root, "home"),
  });
  assert.equal(dryRun.status, 0, dryRun.stderr || dryRun.stdout);
  assert.equal(JSON.parse(dryRun.stdout).wouldChange, true);
  assert.equal(await readFile(targetFile, "utf8"), stale);

  const applied = runManager(["rules", "--agent", "codex", "--target", repository, "--json"], {
    HOME: path.join(root, "home"),
  });
  assert.equal(applied.status, 0, applied.stderr || applied.stdout);
  const updated = await readFile(targetFile, "utf8");
  assert.equal(updated.startsWith("Manual before\n"), true);
  assert.equal(updated.endsWith("\nManual after\n"), true);
  assert.equal(updated.includes("obsolete managed content"), false);
  assert.deepEqual(await readFile(JSON.parse(applied.stdout).backupPath, "utf8"), stale);
});

test("rules refuses malformed managed markers without changing the file", async () => {
  const root = await tempDirectory();
  const repository = path.join(root, "repository");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  const targetFile = path.join(repository, "CLAUDE.md");
  const malformed = "manual\n<!-- BEGIN LARK_AGENT_BRIDGE -->\nunclosed\n";
  await writeFile(targetFile, malformed);
  const result = runManager(["rules", "--agent", "claude", "--target", repository, "--json"], {
    HOME: path.join(root, "home"),
  });
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).error, /missing or duplicate/);
  assert.equal(await readFile(targetFile, "utf8"), malformed);
});

test("update restarts only profiles that were running before npm install", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const config = baseConfig(workspace);
  config.profiles.beta = {
    ...JSON.parse(JSON.stringify(config.profiles.alpha)),
    agentKind: "codex",
  };
  await writeJson(path.join(state, "config.json"), config);
  const fake = await makeFakeCommands(root, { runningProfiles: ["alpha"] });

  const result = runManager(["update", "--bridge-version", "0.7.1", "--json"], {
    HOME: path.join(root, "home"),
    LARK_CHANNEL_HOME: state,
    ...fake,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.restartedProfiles, ["alpha"]);
  assert.deepEqual(payload.stoppedProfiles, ["beta"]);
  assert.equal((await readFile(fake.versionFile, "utf8")).trim(), "0.7.1");
  const log = await commandLog(fake.logFile);
  const restarts = log.filter((entry) => entry.command === "bridge" && entry.args[0] === "restart");
  assert.deepEqual(restarts.map((entry) => entry.args), [["restart", "--profile", "alpha"]]);
});

test("update leaves every stopped profile stopped", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  await writeJson(path.join(state, "config.json"), baseConfig(workspace));
  const fake = await makeFakeCommands(root, { runningProfiles: [] });

  const result = runManager(["update", "--json"], {
    HOME: path.join(root, "home"),
    LARK_CHANNEL_HOME: state,
    ...fake,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.deepEqual(payload.restartedProfiles, []);
  assert.deepEqual(payload.stoppedProfiles, ["alpha"]);
  const log = await commandLog(fake.logFile);
  assert.equal(log.some((entry) => entry.command === "bridge" && entry.args[0] === "restart"), false);
});

test("doctor never prints an inline secret", async () => {
  const root = await tempDirectory();
  const state = path.join(root, "state");
  const workspace = path.join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const secret = "do-not-print-this-secret";
  const config = baseConfig(workspace);
  config.profiles.alpha.accounts.app.secret = secret;
  await writeJson(path.join(state, "config.json"), config);
  const fake = await makeFakeCommands(root, { initialVersion: "0.7.1", runningProfiles: ["alpha"] });

  const result = runManager(["doctor", "--profile", "alpha", "--json"], {
    HOME: path.join(root, "home"),
    LARK_CHANNEL_HOME: state,
    ...fake,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(`${result.stdout}\n${result.stderr}`.includes(secret), false);
  const payload = JSON.parse(result.stdout);
  const secretCheck = payload.checks.find((check) => check.name === "secret");
  assert.equal(secretCheck.status, "warning");
});

test("preflight JSON reports the Node minimum and selected agent", async () => {
  const root = await tempDirectory();
  const fake = await makeFakeCommands(root, { initialVersion: "0.7.1" });
  const result = runManager(["preflight", "--agent", "codex", "--json"], {
    HOME: path.join(root, "home"),
    LARK_CHANNEL_HOME: path.join(root, "state"),
    ...fake,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.checks.find((check) => check.name === "node").minimumVersion, "20.12.0");
  assert.equal(payload.checks.find((check) => check.name === "agent:codex").status, "pass");
});

test("preflight recommends update when Bridge is below compatibility minimum", async () => {
  const root = await tempDirectory();
  const fake = await makeFakeCommands(root, { initialVersion: "0.6.1" });
  const result = runManager(["preflight", "--agent", "codex", "--json"], {
    HOME: path.join(root, "home"),
    LARK_CHANNEL_HOME: path.join(root, "state"),
    ...fake,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  const bridgeCheck = payload.checks.find((check) => check.name === "bridge");
  assert.equal(bridgeCheck.status, "warning");
  assert.equal(bridgeCheck.version, "0.6.1");
  assert.equal(bridgeCheck.minimumVersion, "0.7.1");
  assert.equal(bridgeCheck.testedVersion, "0.7.1");
  assert.equal(bridgeCheck.updateRecommended, true);
  assert.match(bridgeCheck.message, /below the supported minimum 0\.7\.1/);
});

test("version input is exact and cannot become an npm package spec", async () => {
  const root = await tempDirectory();
  const fake = await makeFakeCommands(root, { initialVersion: "0.6.1" });
  const result = runManager(["install", "--bridge-version", "latest", "--json"], {
    HOME: path.join(root, "home"),
    ...fake,
  });
  assert.equal(result.status, 2);
  assert.match(JSON.parse(result.stdout).error, /exact stable version/);
  const log = await commandLog(fake.logFile);
  assert.equal(log.some((entry) => entry.command === "npm" && entry.args.includes("install")), false);
});
