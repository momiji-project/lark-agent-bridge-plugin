#!/usr/bin/env node

import { spawn } from "node:child_process";
import {
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  stat,
  chmod,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DEFAULT_BRIDGE_VERSION = "0.7.1";
const MINIMUM_NODE_VERSION = "20.12.0";
const AGENTS = new Set(["claude", "codex"]);
const PRESET_NAMES = new Set(["read-only", "safe-edit", "full"]);
const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_DIRECTORY = path.resolve(SCRIPT_DIRECTORY, "..");
const RULES_BEGIN = "<!-- BEGIN LARK_AGENT_BRIDGE -->";
const RULES_END = "<!-- END LARK_AGENT_BRIDGE -->";

const OPTION_SCHEMAS = Object.freeze({
  preflight: {
    value: new Set(["agent"]),
    boolean: new Set(["json"]),
  },
  install: {
    value: new Set(["bridge-version"]),
    boolean: new Set(["dry-run", "json"]),
  },
  doctor: {
    value: new Set(["profile", "config"]),
    boolean: new Set(["json"]),
  },
  preset: {
    value: new Set(["profile", "preset", "agent", "workspace", "config"]),
    boolean: new Set(["confirm-full", "dry-run", "json"]),
  },
  rules: {
    value: new Set(["agent", "target"]),
    boolean: new Set(["dry-run", "json"]),
  },
  update: {
    value: new Set(["bridge-version"]),
    boolean: new Set(["dry-run", "json"]),
  },
});

class CliError extends Error {
  constructor(message, { exitCode = 1, details } = {}) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
    this.details = details;
  }
}

function writeStdout(value) {
  process.stdout.write(`${value}\n`);
}

function writeStderr(value) {
  process.stderr.write(`${value}\n`);
}

function homeDirectory(env = process.env) {
  return env.HOME || env.USERPROFILE || os.homedir();
}

function bridgeHome(env = process.env) {
  return path.resolve(env.LARK_CHANNEL_HOME || path.join(homeDirectory(env), ".lark-channel"));
}

function defaultConfigPath(env = process.env) {
  return path.join(bridgeHome(env), "config.json");
}

function commandName(kind, env = process.env, platform = process.platform) {
  const overrides = {
    npm: env.LARK_BRIDGE_MANAGER_NPM,
    bridge: env.LARK_BRIDGE_MANAGER_BRIDGE,
    claude: env.LARK_BRIDGE_MANAGER_CLAUDE,
    codex: env.LARK_BRIDGE_MANAGER_CODEX,
  };
  if (overrides[kind]) return overrides[kind];
  if (kind === "npm") return platform === "win32" ? "npm.cmd" : "npm";
  return kind === "bridge" ? "lark-channel-bridge" : kind;
}

function parseStableVersion(value) {
  if (!/^\d+\.\d+\.\d+$/.test(value)) {
    throw new CliError(`Bridge version must be an exact stable version (for example ${DEFAULT_BRIDGE_VERSION}).`, {
      exitCode: 2,
    });
  }
  return value;
}

function parseSemver(value) {
  const match = String(value).match(/(?:^|[^\d])(\d+)\.(\d+)\.(\d+)(?:[^\d]|$)/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function compareVersions(left, right) {
  const a = parseSemver(left);
  const b = parseSemver(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function validateAgent(agent) {
  if (!AGENTS.has(agent)) {
    throw new CliError("--agent must be claude or codex.", { exitCode: 2 });
  }
  return agent;
}

function validateProfileName(profile) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profile)) {
    throw new CliError("--profile must use 1-64 ASCII letters, numbers, dots, underscores, or hyphens.", {
      exitCode: 2,
    });
  }
  return profile;
}

function parseOptions(command, tokens) {
  const schema = OPTION_SCHEMAS[command];
  if (!schema) throw new CliError(`Unknown command: ${command}`, { exitCode: 2 });
  const options = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new CliError(`Unexpected positional argument: ${token}`, { exitCode: 2 });
    }
    const name = token.slice(2);
    if (schema.boolean.has(name)) {
      options[name] = true;
      continue;
    }
    if (!schema.value.has(name)) {
      throw new CliError(`Unknown option for ${command}: --${name}`, { exitCode: 2 });
    }
    const value = tokens[index + 1];
    if (!value || value.startsWith("--")) {
      throw new CliError(`Missing value for --${name}.`, { exitCode: 2 });
    }
    options[name] = value;
    index += 1;
  }
  return options;
}

function redactText(value) {
  return String(value)
    .replace(/(--app-secret(?:=|\s+))\S+/gi, "$1[REDACTED]")
    .replace(/((?:app[_-]?secret|client[_-]?secret|secret)\s*[:=]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/("(?:appSecret|app_secret|clientSecret|client_secret|secret)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2");
}

async function runCommand(command, args, { env = process.env, timeoutMs = 30_000 } = {}) {
  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      env,
      // npm and globally installed CLI shims are .cmd files on Windows.
      // Every argument passed here is fixed or validated by this manager.
      shell: process.platform === "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
    }, timeoutMs);
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: false, code: null, stdout, stderr, error });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ok: code === 0, code, signal, stdout, stderr });
    });
  });
}

async function executableCheck(kind, args = ["--version"]) {
  const result = await runCommand(commandName(kind), args, { timeoutMs: 8_000 });
  const version = result.ok ? parseSemver(`${result.stdout}\n${result.stderr}`)?.join(".") : undefined;
  return { available: result.ok, version };
}

function makeCheck(name, status, message, data = {}) {
  return { name, status, message, ...data };
}

function checksOkay(checks) {
  return !checks.some((check) => check.status === "error");
}

async function loadCompatibility() {
  const compatibilityPath = path.join(PLUGIN_DIRECTORY, "compatibility.json");
  let compatibility;
  try {
    compatibility = JSON.parse(await readFile(compatibilityPath, "utf8"));
  } catch {
    throw new CliError(`Compatibility manifest is missing or invalid: ${compatibilityPath}`);
  }
  const bridge = compatibility?.bridge;
  if (
    compatibility?.schemaVersion !== 1 ||
    bridge?.package !== "lark-channel-bridge" ||
    !/^\d+\.\d+\.\d+$/.test(bridge?.minimumVersion || "") ||
    !/^\d+\.\d+\.\d+$/.test(bridge?.testedVersion || "") ||
    compareVersions(bridge.testedVersion, bridge.minimumVersion) < 0
  ) {
    throw new CliError(`Compatibility manifest failed schema validation: ${compatibilityPath}`);
  }
  return compatibility;
}

async function collectPreflight(agent) {
  const compatibility = await loadCompatibility();
  const checks = [];
  const nodeComparison = compareVersions(process.versions.node, MINIMUM_NODE_VERSION);
  checks.push(
    makeCheck(
      "node",
      nodeComparison !== null && nodeComparison >= 0 ? "pass" : "error",
      nodeComparison !== null && nodeComparison >= 0
        ? `Node.js ${process.versions.node} is supported.`
        : `Node.js ${MINIMUM_NODE_VERSION} or newer is required.`,
      { version: process.versions.node, minimumVersion: MINIMUM_NODE_VERSION },
    ),
  );

  const npm = await executableCheck("npm");
  checks.push(
    makeCheck(
      "npm",
      npm.available ? "pass" : "error",
      npm.available ? "npm is available." : "npm was not found on PATH.",
      npm.version ? { version: npm.version } : {},
    ),
  );

  const agentsToCheck = agent ? [validateAgent(agent)] : ["claude", "codex"];
  const agentResults = [];
  for (const kind of agentsToCheck) {
    agentResults.push([kind, await executableCheck(kind)]);
  }
  const availableAgents = agentResults.filter(([, result]) => result.available);
  for (const [kind, result] of agentResults) {
    checks.push(
      makeCheck(
        `agent:${kind}`,
        result.available ? "pass" : agent ? "error" : "warning",
        result.available ? `${kind} CLI is available.` : `${kind} CLI was not found or is not ready.`,
        result.version ? { version: result.version } : {},
      ),
    );
  }
  if (!agent && availableAgents.length === 0) {
    checks.push(makeCheck("agent", "error", "Install and sign in to at least one supported agent CLI."));
  }

  const bridge = await executableCheck("bridge");
  const bridgeComparison = bridge.version
    ? compareVersions(bridge.version, compatibility.bridge.minimumVersion)
    : null;
  const bridgeTooOld = bridge.available && bridgeComparison !== null && bridgeComparison < 0;
  const bridgeVersionUnknown = bridge.available && bridgeComparison === null;
  checks.push(
    makeCheck(
      "bridge",
      !bridge.available || bridgeTooOld || bridgeVersionUnknown ? "warning" : "pass",
      !bridge.available
        ? "lark-channel-bridge is not installed yet."
        : bridgeTooOld
          ? `lark-channel-bridge ${bridge.version} is below the supported minimum ${compatibility.bridge.minimumVersion} (tested ${compatibility.bridge.testedVersion}); run the update command.`
          : bridgeVersionUnknown
            ? "lark-channel-bridge is installed, but its version could not be determined; update is recommended."
            : `lark-channel-bridge ${bridge.version} is installed and supported.`,
      {
        ...(bridge.version ? { version: bridge.version } : {}),
        minimumVersion: compatibility.bridge.minimumVersion,
        testedVersion: compatibility.bridge.testedVersion,
        updateRecommended: !bridge.available || bridgeTooOld || bridgeVersionUnknown,
      },
    ),
  );
  return checks;
}

function printChecks(checks) {
  const marks = { pass: "✓", warning: "!", error: "✗" };
  for (const check of checks) writeStdout(`${marks[check.status]} ${check.message}`);
}

async function preflightCommand(options) {
  const checks = await collectPreflight(options.agent);
  return { ok: checksOkay(checks), command: "preflight", checks };
}

async function installedBridgeVersion() {
  const check = await executableCheck("bridge");
  return check.available ? check.version : undefined;
}

async function npmInstallBridge(version) {
  const npm = commandName("npm");
  const result = await runCommand(
    npm,
    ["install", "--global", "--no-audit", "--no-fund", "--loglevel=error", `lark-channel-bridge@${version}`],
    { timeoutMs: 180_000 },
  );
  if (!result.ok) {
    throw new CliError(
      `npm could not install lark-channel-bridge@${version} (exit ${result.code ?? "unavailable"}). Run npm diagnostics separately; subprocess output was withheld to avoid exposing credentials.`,
    );
  }
}

async function ensureInstallRequirements() {
  if ((compareVersions(process.versions.node, MINIMUM_NODE_VERSION) ?? -1) < 0) {
    throw new CliError(`Node.js ${MINIMUM_NODE_VERSION} or newer is required.`);
  }
  const npm = await executableCheck("npm");
  if (!npm.available) throw new CliError("npm was not found on PATH.");
}

async function installCommand(options) {
  const version = parseStableVersion(
    options["bridge-version"] || (await loadCompatibility()).bridge.testedVersion,
  );
  await ensureInstallRequirements();
  const beforeVersion = await installedBridgeVersion();
  if (options["dry-run"]) {
    return {
      ok: true,
      command: "install",
      dryRun: true,
      beforeVersion: beforeVersion || null,
      targetVersion: version,
      plannedActions: beforeVersion === version ? [] : [`Install lark-channel-bridge@${version} globally`],
    };
  }
  if (beforeVersion === version) {
    return { ok: true, command: "install", changed: false, version, message: "Requested version is already installed." };
  }
  await npmInstallBridge(version);
  const afterVersion = await installedBridgeVersion();
  if (afterVersion !== version) {
    throw new CliError(`Installation finished, but the resolved bridge version is ${afterVersion || "unknown"}; expected ${version}.`);
  }
  return {
    ok: true,
    command: "install",
    changed: true,
    beforeVersion: beforeVersion || null,
    version: afterVersion,
    startedProfiles: [],
    message: "Bridge installed. No profile was started automatically.",
  };
}

function configPathFromOptions(options) {
  return options.config ? path.resolve(options.config) : defaultConfigPath();
}

async function loadConfig(configPath, { optional = false } = {}) {
  let source;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return null;
    if (error?.code === "ENOENT") throw new CliError(`Bridge config was not found: ${configPath}`);
    throw new CliError(`Bridge config could not be read: ${configPath}`);
  }
  try {
    const config = JSON.parse(source.replace(/^\uFEFF/, ""));
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("not an object");
    return config;
  } catch {
    throw new CliError(`Bridge config is not valid JSON: ${configPath}`);
  }
}

function profileNames(config) {
  if (!config?.profiles || typeof config.profiles !== "object" || Array.isArray(config.profiles)) return [];
  return Object.keys(config.profiles).filter((name) => /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name));
}

function hasConfiguredSecret(profile) {
  const secret = profile?.accounts?.app?.secret;
  if (typeof secret === "string") return secret.length > 0;
  return Boolean(secret && typeof secret === "object");
}

function isPlaintextSecret(profile) {
  const secret = profile?.accounts?.app?.secret;
  return typeof secret === "string" && secret.length > 0 && !/^\$\{[A-Z][A-Z0-9_]*\}$/.test(secret);
}

async function configPermissionsCheck(configPath) {
  if (process.platform === "win32") return null;
  try {
    const fileStat = await stat(configPath);
    const mode = fileStat.mode & 0o777;
    return { secure: (mode & 0o077) === 0, mode: mode.toString(8).padStart(3, "0") };
  } catch {
    return null;
  }
}

function isRunningStatus(output) {
  const text = String(output);
  if (/正在后台运行|is (?:currently )?running in the background|background service is running|バックグラウンドで実行中/i.test(text)) {
    return true;
  }
  return /^\s*(?:process\s*id|pid|进程\s*id|プロセス\s*id)\s*[:=]\s*\d+/im.test(text);
}

async function profileServiceStatus(profile) {
  const result = await runCommand(commandName("bridge"), ["status", "--profile", profile], { timeoutMs: 15_000 });
  if (!result.ok) return { available: false, running: false };
  return { available: true, running: isRunningStatus(`${result.stdout}\n${result.stderr}`) };
}

async function validateWorkspace(workspace, configPath) {
  const requested = path.resolve(workspace);
  let resolved;
  try {
    resolved = await realpath(requested);
    const workspaceStat = await stat(resolved);
    if (!workspaceStat.isDirectory()) throw new CliError("--workspace must point to an existing directory.", { exitCode: 2 });
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("--workspace must point to an existing directory.", { exitCode: 2 });
  }

  const parsed = path.parse(resolved);
  const exactDisallowed = new Set([
    path.resolve(parsed.root),
    path.resolve(homeDirectory()),
    path.resolve(os.tmpdir()),
    path.resolve(bridgeHome()),
    path.resolve(path.dirname(configPath)),
    ...(process.platform === "win32"
      ? [process.env.SystemRoot, process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
          .filter(Boolean)
          .map((value) => path.resolve(value))
      : ["/System", "/Library", "/Applications", "/usr", "/etc", "/var"].map((value) => path.resolve(value))),
  ]);
  if (exactDisallowed.has(path.resolve(resolved))) {
    throw new CliError("--workspace is too broad or is a system/config directory. Choose a dedicated project directory.", {
      exitCode: 2,
    });
  }
  return resolved;
}

async function doctorCommand(options) {
  const checks = await collectPreflight(undefined);
  const configPath = configPathFromOptions(options);
  let config;
  try {
    config = await loadConfig(configPath);
    checks.push(makeCheck("config", "pass", "Bridge config is valid JSON.", { path: configPath }));
  } catch (error) {
    checks.push(makeCheck("config", "error", error.message, { path: configPath }));
    return { ok: false, command: "doctor", checks, configPath };
  }

  const permissionInfo = await configPermissionsCheck(configPath);
  if (permissionInfo) {
    checks.push(
      makeCheck(
        "config-permissions",
        permissionInfo.secure ? "pass" : "warning",
        permissionInfo.secure
          ? `Config file permissions are private (${permissionInfo.mode}).`
          : `Config file permissions are ${permissionInfo.mode}; 600 is recommended.`,
        { mode: permissionInfo.mode },
      ),
    );
  }

  const selectedName = options.profile || config.activeProfile;
  if (!selectedName) {
    checks.push(makeCheck("profile", "error", "No --profile was given and the config has no activeProfile."));
    return { ok: false, command: "doctor", checks, configPath };
  }
  validateProfileName(selectedName);
  const selectedProfile = config.profiles?.[selectedName];
  if (!selectedProfile || typeof selectedProfile !== "object") {
    checks.push(makeCheck("profile", "error", `Profile ${selectedName} does not exist.`, { profile: selectedName }));
    return { ok: false, command: "doctor", checks, configPath, profile: selectedName };
  }
  checks.push(makeCheck("profile", "pass", `Profile ${selectedName} exists.`, { profile: selectedName }));

  const agent = selectedProfile.agentKind;
  if (!AGENTS.has(agent)) {
    checks.push(makeCheck("profile-agent", "error", "Profile agentKind must be claude or codex."));
  } else {
    const agentCheck = await executableCheck(agent);
    checks.push(
      makeCheck(
        "profile-agent",
        agentCheck.available ? "pass" : "error",
        agentCheck.available ? `${agent} CLI is available for this profile.` : `${agent} CLI is unavailable for this profile.`,
        { agent },
      ),
    );
  }

  if (!hasConfiguredSecret(selectedProfile)) {
    checks.push(makeCheck("secret", "error", "No app secret provider is configured for this profile."));
  } else if (isPlaintextSecret(selectedProfile)) {
    checks.push(makeCheck("secret", "warning", "An app secret appears to be stored inline; migrate it with the Bridge secret flow."));
  } else {
    checks.push(makeCheck("secret", "pass", "An external or encrypted app secret provider is configured."));
  }

  const workspace = selectedProfile.workspaces?.default;
  if (typeof workspace !== "string" || !workspace) {
    checks.push(makeCheck("workspace", "error", "The profile has no default workspace."));
  } else {
    try {
      const resolvedWorkspace = await validateWorkspace(workspace, configPath);
      checks.push(makeCheck("workspace", "pass", "The default workspace is usable.", { path: resolvedWorkspace }));
    } catch (error) {
      checks.push(makeCheck("workspace", "error", error.message));
    }
  }

  const permissions = selectedProfile.permissions;
  const validAccess = new Set(["read-only", "workspace", "full"]);
  if (!validAccess.has(permissions?.defaultAccess) || !validAccess.has(permissions?.maxAccess)) {
    checks.push(makeCheck("permissions", "error", "Profile permissions are missing or invalid."));
  } else {
    checks.push(
      makeCheck("permissions", "pass", `Permissions are ${permissions.defaultAccess}/${permissions.maxAccess}.`, {
        defaultAccess: permissions.defaultAccess,
        maxAccess: permissions.maxAccess,
      }),
    );
  }

  const service = await profileServiceStatus(selectedName);
  checks.push(
    makeCheck(
      "service",
      !service.available ? "error" : service.running ? "pass" : "warning",
      !service.available
        ? "Bridge service status could not be read."
        : service.running
          ? "Bridge service is running."
          : "Bridge service is stopped.",
      { running: service.running },
    ),
  );
  return { ok: checksOkay(checks), command: "doctor", checks, configPath, profile: selectedName };
}

async function atomicConfigUpdate(configPath, config) {
  const directory = path.dirname(configPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${configPath}.backup-${stamp}`;
  const tempPath = path.join(directory, `.${path.basename(configPath)}.tmp-${process.pid}-${Date.now()}`);
  const originalSource = await readFile(configPath);
  let backupHandle;
  try {
    backupHandle = await open(backupPath, "wx", 0o600);
    await backupHandle.writeFile(originalSource);
    await backupHandle.sync();
    await backupHandle.close();
    backupHandle = undefined;
  } catch {
    await backupHandle?.close().catch(() => {});
    await unlink(backupPath).catch(() => {});
    throw new CliError("Could not create a private backup; the Bridge config was not changed.");
  }

  let handle;
  try {
    handle = await open(tempPath, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(config, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(tempPath, configPath);
    if (process.platform !== "win32") await chmod(configPath, 0o600);
    try {
      const directoryHandle = await open(directory, "r");
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch {
      // Some Windows/filesystem combinations do not allow opening a directory.
    }
  } catch (error) {
    await handle?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw new CliError(`Could not update Bridge config atomically. Backup retained at ${backupPath}.`);
  }
  return backupPath;
}

async function loadPresetAsset(presetName) {
  if (!PRESET_NAMES.has(presetName)) {
    throw new CliError("--preset must be read-only, safe-edit, or full.", { exitCode: 2 });
  }
  const assetPath = path.join(PLUGIN_DIRECTORY, "assets", "presets", `${presetName}.json`);
  let asset;
  try {
    asset = JSON.parse(await readFile(assetPath, "utf8"));
  } catch {
    throw new CliError(`Preset asset is missing or invalid: ${assetPath}`);
  }
  const expectedAccess = presetName === "safe-edit" ? "workspace" : presetName;
  const profile = asset?.profile;
  const preferences = profile?.preferences;
  const valid =
    asset.name === presetName &&
    profile?.permissions?.defaultAccess === expectedAccess &&
    profile?.permissions?.maxAccess === expectedAccess &&
    preferences?.model === "default" &&
    preferences?.messageReply === "text" &&
    preferences?.messageReplyMigrated === true &&
    preferences?.showToolCalls === false &&
    preferences?.cotMessages === "off" &&
    preferences?.maxConcurrentRuns === 1 &&
    preferences?.runIdleTimeoutMinutes === 10 &&
    profile?.access?.requireMentionInGroup === true &&
    profile?.larkCli?.identityPreset === "bot-only";
  if (!valid) {
    throw new CliError(`Preset asset failed its safety schema validation: ${assetPath}`);
  }
  return {
    permissions: {
      defaultAccess: profile.permissions.defaultAccess,
      maxAccess: profile.permissions.maxAccess,
    },
    preferences: {
      model: preferences.model,
      messageReply: preferences.messageReply,
      messageReplyMigrated: preferences.messageReplyMigrated,
      showToolCalls: preferences.showToolCalls,
      cotMessages: preferences.cotMessages,
      maxConcurrentRuns: preferences.maxConcurrentRuns,
      runIdleTimeoutMinutes: preferences.runIdleTimeoutMinutes,
    },
    access: { requireMentionInGroup: profile.access.requireMentionInGroup },
    larkCli: { identityPreset: profile.larkCli.identityPreset },
    requiresExplicitConfirmation: asset.requiresExplicitConfirmation === true,
  };
}

async function presetCommand(options) {
  const missing = ["profile", "preset", "agent", "workspace"].filter((name) => !options[name]);
  if (missing.length > 0) {
    throw new CliError(`Missing required option(s): ${missing.map((name) => `--${name}`).join(", ")}`, { exitCode: 2 });
  }
  const profileName = validateProfileName(options.profile);
  const presetName = options.preset;
  const preset = await loadPresetAsset(presetName);
  if (presetName === "full" && (!preset.requiresExplicitConfirmation || !options["confirm-full"])) {
    throw new CliError("The full preset requires --confirm-full because it grants unrestricted local access.", {
      exitCode: 2,
    });
  }
  const agent = validateAgent(options.agent);
  const configPath = configPathFromOptions(options);
  const config = await loadConfig(configPath);
  const profile = config.profiles?.[profileName];
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new CliError(`Profile ${profileName} does not exist. Create it with lark-channel-bridge first.`);
  }
  if (profile.agentKind && profile.agentKind !== agent) {
    throw new CliError(`Profile ${profileName} uses agent ${profile.agentKind}; refusing to change it to ${agent}.`);
  }
  const workspace = await validateWorkspace(options.workspace, configPath);
  const nextConfig = JSON.parse(JSON.stringify(config));
  const nextProfile = nextConfig.profiles[profileName];
  nextProfile.agentKind = agent;
  nextProfile.permissions = { ...(nextProfile.permissions || {}), ...preset.permissions };
  nextProfile.workspaces = { ...(nextProfile.workspaces || {}), default: workspace };
  nextProfile.preferences = { ...(nextProfile.preferences || {}), ...preset.preferences };
  nextProfile.access = { ...(nextProfile.access || {}), ...preset.access };
  nextProfile.larkCli = { ...(nextProfile.larkCli || {}), ...preset.larkCli };

  const changes = {
    profile: profileName,
    preset: presetName,
    agent,
    workspace,
    permissions: preset.permissions,
    preferences: preset.preferences,
    access: preset.access,
    larkCli: preset.larkCli,
  };
  const wouldChange = JSON.stringify(nextConfig) !== JSON.stringify(config);
  if (options["dry-run"]) {
    return { ok: true, command: "preset", dryRun: true, changed: false, wouldChange, configPath, changes };
  }
  if (!wouldChange) {
    return {
      ok: true,
      command: "preset",
      changed: false,
      configPath,
      changes,
      message: "Requested preset and runtime settings are already current.",
    };
  }
  const backupPath = await atomicConfigUpdate(configPath, nextConfig);
  return { ok: true, command: "preset", changed: true, configPath, backupPath, changes };
}

function countOccurrences(source, needle) {
  let count = 0;
  let cursor = 0;
  while ((cursor = source.indexOf(needle, cursor)) !== -1) {
    count += 1;
    cursor += needle.length;
  }
  return count;
}

function composeManagedRules(source, rulesSource) {
  if (rulesSource.includes(RULES_BEGIN) || rulesSource.includes(RULES_END)) {
    throw new CliError("The Bridge rules asset must not contain managed-block markers.");
  }
  const eol = source.includes("\r\n") ? "\r\n" : "\n";
  const body = rulesSource.trim().replace(/\r?\n/g, eol);
  const managedBlock = `${RULES_BEGIN}${eol}${body}${eol}${RULES_END}`;
  const beginCount = countOccurrences(source, RULES_BEGIN);
  const endCount = countOccurrences(source, RULES_END);

  if (beginCount === 0 && endCount === 0) {
    if (!source) return `${managedBlock}${eol}`;
    const separator = source.endsWith(`${eol}${eol}`) ? "" : source.endsWith(eol) ? eol : `${eol}${eol}`;
    return `${source}${separator}${managedBlock}${eol}`;
  }
  if (beginCount !== 1 || endCount !== 1) {
    throw new CliError("Rules file has missing or duplicate LARK_AGENT_BRIDGE markers; refusing to edit it.");
  }
  const beginIndex = source.indexOf(RULES_BEGIN);
  const endIndex = source.indexOf(RULES_END);
  if (beginIndex > endIndex) {
    throw new CliError("Rules file has reversed LARK_AGENT_BRIDGE markers; refusing to edit it.");
  }
  return `${source.slice(0, beginIndex)}${managedBlock}${source.slice(endIndex + RULES_END.length)}`;
}

async function writeRulesAtomically(targetFile, nextSource, currentSource) {
  const directory = path.dirname(targetFile);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = currentSource === null ? null : `${targetFile}.backup-${stamp}`;
  const tempPath = path.join(directory, `.${path.basename(targetFile)}.tmp-${process.pid}-${Date.now()}`);
  let targetMode = 0o644;
  if (currentSource !== null) {
    try {
      targetMode = (await stat(targetFile)).mode & 0o777;
    } catch {
      throw new CliError(`Rules file changed while it was being prepared: ${targetFile}`);
    }
    let backupHandle;
    try {
      backupHandle = await open(backupPath, "wx", 0o600);
      await backupHandle.writeFile(currentSource, "utf8");
      await backupHandle.sync();
      await backupHandle.close();
      backupHandle = undefined;
    } catch {
      await backupHandle?.close().catch(() => {});
      await unlink(backupPath).catch(() => {});
      throw new CliError("Could not create a private rules backup; the rules file was not changed.");
    }
  }

  let tempHandle;
  try {
    tempHandle = await open(tempPath, "wx", targetMode);
    await tempHandle.writeFile(nextSource, "utf8");
    await tempHandle.sync();
    await tempHandle.close();
    tempHandle = undefined;
    await rename(tempPath, targetFile);
    if (process.platform !== "win32") await chmod(targetFile, targetMode);
    try {
      const directoryHandle = await open(directory, "r");
      await directoryHandle.sync();
      await directoryHandle.close();
    } catch {
      // Some Windows/filesystem combinations do not allow opening a directory.
    }
  } catch {
    await tempHandle?.close().catch(() => {});
    await unlink(tempPath).catch(() => {});
    throw new CliError(
      backupPath
        ? `Could not update rules atomically. Backup retained at ${backupPath}.`
        : "Could not create the rules file atomically.",
    );
  }
  return backupPath;
}

async function rulesCommand(options) {
  const missing = ["agent", "target"].filter((name) => !options[name]);
  if (missing.length > 0) {
    throw new CliError(`Missing required option(s): ${missing.map((name) => `--${name}`).join(", ")}`, { exitCode: 2 });
  }
  const agent = validateAgent(options.agent);
  let repositoryRoot;
  try {
    repositoryRoot = await realpath(path.resolve(options.target));
    if (!(await stat(repositoryRoot)).isDirectory()) throw new Error("not a directory");
    await stat(path.join(repositoryRoot, ".git"));
  } catch {
    throw new CliError("--target must point to the root of an existing Git repository.", { exitCode: 2 });
  }
  const assetPath = path.join(PLUGIN_DIRECTORY, "assets", "rules", "bridge-session.md");
  let rulesSource;
  try {
    rulesSource = await readFile(assetPath, "utf8");
  } catch {
    throw new CliError(`Bridge rules asset was not found: ${assetPath}`);
  }
  const targetFile = path.join(repositoryRoot, agent === "claude" ? "CLAUDE.md" : "AGENTS.md");
  let currentSource;
  try {
    currentSource = await readFile(targetFile, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") currentSource = null;
    else throw new CliError(`Rules file could not be read: ${targetFile}`);
  }
  const nextSource = composeManagedRules(currentSource || "", rulesSource);
  const wouldChange = currentSource !== nextSource;
  if (options["dry-run"]) {
    return { ok: true, command: "rules", dryRun: true, changed: false, wouldChange, agent, targetFile };
  }
  if (!wouldChange) {
    return { ok: true, command: "rules", changed: false, agent, targetFile, message: "Managed rules are already current." };
  }
  const backupPath = await writeRulesAtomically(targetFile, nextSource, currentSource);
  return {
    ok: true,
    command: "rules",
    changed: true,
    agent,
    targetFile,
    backupPath,
    message: "Managed Bridge session rules were applied.",
  };
}

async function runningProfilesBeforeUpdate(config) {
  const running = [];
  for (const profile of profileNames(config)) {
    const status = await profileServiceStatus(profile);
    if (status.running) running.push(profile);
  }
  return running;
}

async function restartProfiles(profiles) {
  const restarted = [];
  const failed = [];
  for (const profile of profiles) {
    const result = await runCommand(commandName("bridge"), ["restart", "--profile", profile], { timeoutMs: 60_000 });
    if (result.ok) restarted.push(profile);
    else failed.push(profile);
  }
  if (failed.length > 0) {
    throw new CliError(`Bridge updated, but these previously running profiles could not be restarted: ${failed.join(", ")}`, {
      details: { restartedProfiles: restarted, failedProfiles: failed },
    });
  }
  return restarted;
}

async function updateCommand(options) {
  const version = parseStableVersion(
    options["bridge-version"] || (await loadCompatibility()).bridge.testedVersion,
  );
  await ensureInstallRequirements();
  const beforeVersion = await installedBridgeVersion();
  const configPath = defaultConfigPath();
  const config = await loadConfig(configPath, { optional: true });
  const runningProfiles = beforeVersion && config ? await runningProfilesBeforeUpdate(config) : [];

  if (options["dry-run"]) {
    return {
      ok: true,
      command: "update",
      dryRun: true,
      beforeVersion: beforeVersion || null,
      targetVersion: version,
      runningProfiles,
      stoppedProfiles: config ? profileNames(config).filter((name) => !runningProfiles.includes(name)) : [],
      plannedActions:
        beforeVersion === version
          ? []
          : [`Install lark-channel-bridge@${version} globally`, ...runningProfiles.map((name) => `Restart profile ${name}`)],
    };
  }
  if (beforeVersion === version) {
    return {
      ok: true,
      command: "update",
      changed: false,
      version,
      restartedProfiles: [],
      message: "Requested version is already installed; no profile was restarted.",
    };
  }
  await npmInstallBridge(version);
  const afterVersion = await installedBridgeVersion();
  if (afterVersion !== version) {
    throw new CliError(`Update finished, but the resolved bridge version is ${afterVersion || "unknown"}; expected ${version}.`);
  }
  const restartedProfiles = await restartProfiles(runningProfiles);
  return {
    ok: true,
    command: "update",
    changed: true,
    beforeVersion: beforeVersion || null,
    version: afterVersion,
    restartedProfiles,
    stoppedProfiles: config ? profileNames(config).filter((name) => !runningProfiles.includes(name)) : [],
    message: "Only profiles that were running before the update were restarted.",
  };
}

function helpText() {
  return `Lark Agent Bridge manager\n\nUsage:\n  node scripts/bridge-manager.mjs preflight [--agent claude|codex] [--json]\n  node scripts/bridge-manager.mjs install [--bridge-version ${DEFAULT_BRIDGE_VERSION}] [--dry-run] [--json]\n  node scripts/bridge-manager.mjs doctor [--profile NAME] [--config PATH] [--json]\n  node scripts/bridge-manager.mjs preset --profile NAME --preset read-only|safe-edit|full --agent claude|codex --workspace PATH [--confirm-full] [--config PATH] [--dry-run] [--json]\n  node scripts/bridge-manager.mjs rules --agent claude|codex --target REPO_ROOT [--dry-run] [--json]\n  node scripts/bridge-manager.mjs update [--bridge-version ${DEFAULT_BRIDGE_VERSION}] [--dry-run] [--json]\n\nThe manager never accepts or prints an App Secret. Use the interactive\nlark-channel-bridge QR/secrets flow for credentials.`;
}

function printHuman(result) {
  if (result.checks) {
    printChecks(result.checks);
    return;
  }
  if (result.command === "preset") {
    writeStdout(
      result.dryRun
        ? `Dry run: ${result.changes.profile} would use ${result.changes.preset} in ${result.changes.workspace}.`
        : result.changed
          ? `✓ Applied ${result.changes.preset} to ${result.changes.profile}. Backup: ${result.backupPath}`
          : `✓ ${result.message}`,
    );
    return;
  }
  if (result.dryRun) {
    writeStdout("Dry run; no files, packages, or services were changed.");
    for (const action of result.plannedActions || []) writeStdout(`- ${action}`);
    return;
  }
  writeStdout(`✓ ${result.message || `${result.command} completed.`}`);
  if (result.restartedProfiles?.length) writeStdout(`Restarted: ${result.restartedProfiles.join(", ")}`);
  if (result.stoppedProfiles?.length) writeStdout(`Left stopped: ${result.stoppedProfiles.join(", ")}`);
}

async function dispatch(command, options) {
  if (command === "preflight") return await preflightCommand(options);
  if (command === "install") return await installCommand(options);
  if (command === "doctor") return await doctorCommand(options);
  if (command === "preset") return await presetCommand(options);
  if (command === "rules") return await rulesCommand(options);
  if (command === "update") return await updateCommand(options);
  throw new CliError(`Unknown command: ${command}`, { exitCode: 2 });
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...tokens] = argv;
  if (!command || command === "help" || command === "--help" || command === "-h") {
    writeStdout(helpText());
    return 0;
  }
  let options = {};
  try {
    options = parseOptions(command, tokens);
    const result = await dispatch(command, options);
    if (options.json) writeStdout(JSON.stringify(result, null, 2));
    else printHuman(result);
    return result.ok ? 0 : 1;
  } catch (error) {
    const safeMessage = redactText(error instanceof Error ? error.message : String(error));
    const exitCode = error instanceof CliError ? error.exitCode : 1;
    if (options.json || tokens.includes("--json")) {
      const payload = { ok: false, command, error: safeMessage };
      if (error instanceof CliError && error.details) payload.details = error.details;
      writeStdout(JSON.stringify(payload, null, 2));
    } else {
      writeStderr(`Error: ${safeMessage}`);
    }
    return exitCode;
  }
}

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) process.exitCode = await main();

export {
  DEFAULT_BRIDGE_VERSION,
  MINIMUM_NODE_VERSION,
  atomicConfigUpdate,
  compareVersions,
  isRunningStatus,
  parseOptions,
  redactText,
  validateWorkspace,
};
