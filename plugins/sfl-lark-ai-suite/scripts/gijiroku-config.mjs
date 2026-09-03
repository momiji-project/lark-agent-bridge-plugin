#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";

const APP_NAME = "gijiroku-image-bridge";
const SUMMARY_VALUES = new Set(["short", "standard", "detailed"]);
const STYLE_VALUES = new Set(["auto", "fixed", "per-run"]);
const LOGO_VALUES = new Set(["none", "always"]);
const TRIGGER_VALUES = new Set(["explicit-image", "broad"]);
const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const REPEATABLE_OPTIONS = new Set(["style-reference", "trigger-phrase"]);

function parseArgs(argv) {
  const [command = "show", ...rest] = argv;
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key.startsWith("--")) throw new Error(`不明な引数です: ${key}`);
    const value = rest[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${key} の値がありません`);
    const name = key.slice(2);
    if (REPEATABLE_OPTIONS.has(name)) {
      args[name] ||= [];
      args[name].push(value);
    } else {
      args[name] = value;
    }
    index += 1;
  }
  return args;
}

function profileName(args) {
  const value = args.profile || process.env.LARK_CHANNEL_PROFILE || "default";
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("profile名に使用できない文字が含まれています");
  return value;
}

function paths(profile) {
  const applicationRoot = process.env.GIJIROKU_IMAGE_BRIDGE_HOME
    ? resolve(process.env.GIJIROKU_IMAGE_BRIDGE_HOME)
    : join(homedir(), "Library", "Application Support", APP_NAME);
  const root = join(applicationRoot, "profiles", profile);
  return { root, assets: join(root, "assets"), config: join(root, "config.json") };
}

async function readConfig(configPath) {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8"));
    if (config?.schemaVersion === 1) {
      return {
        ...config,
        schemaVersion: 2,
        styleReferences: [],
        trigger: { mode: "explicit-image", phrases: [] },
      };
    }
    return config;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function sha256(filePath) {
  const data = await readFile(filePath);
  return createHash("sha256").update(data).digest("hex");
}

function validateConfig(config) {
  const errors = [];
  if (!config || typeof config !== "object") return ["設定JSONがオブジェクトではありません"];
  if (config.schemaVersion !== 2) errors.push("schemaVersionは2である必要があります");
  if (!SUMMARY_VALUES.has(config.summaryDepth)) errors.push("summaryDepthが不正です");
  if (!STYLE_VALUES.has(config.styleMode)) errors.push("styleModeが不正です");
  if (!Array.isArray(config.styleReferences)) errors.push("styleReferencesは配列である必要があります");
  const styleReferences = Array.isArray(config.styleReferences) ? config.styleReferences : [];
  if (styleReferences.length > 3) errors.push("styleReferencesは最大3件です");
  if (config.styleMode !== "fixed" && styleReferences.length) errors.push("参考画像を保存できるのはfixed指定だけです");
  if (config.styleMode === "fixed" && !String(config.stylePrompt || "").trim() && !styleReferences.length) {
    errors.push("fixed指定にはstylePromptまたはstyleReferencesが必要です");
  }
  for (const reference of styleReferences) {
    if (!reference?.path || !reference?.sha256) errors.push("styleReferencesのpathまたはsha256がありません");
  }
  if (!LOGO_VALUES.has(config.logo?.mode)) errors.push("logo.modeが不正です");
  if (config.logo?.mode === "always" && !config.logo?.path) errors.push("always指定にはlogo.pathが必要です");
  if (!TRIGGER_VALUES.has(config.trigger?.mode)) errors.push("trigger.modeが不正です");
  if (!Array.isArray(config.trigger?.phrases)) errors.push("trigger.phrasesは配列である必要があります");
  if (Array.isArray(config.trigger?.phrases) && config.trigger.phrases.length > 10) errors.push("trigger.phrasesは最大10件です");
  return errors;
}

function repeatedValues(args, name) {
  const value = args[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function normalizedExtension(source) {
  const extension = extname(source).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension)) throw new Error("画像はPNG/JPEG/WebPを指定してください");
  return extension === ".jpeg" ? ".jpg" : extension;
}

async function copyManagedImage(sourceValue, targetPath) {
  const source = resolve(sourceValue);
  const info = await stat(source);
  if (!info.isFile()) throw new Error(`${basename(source)} はファイルではありません`);
  if (source !== resolve(targetPath)) await copyFile(source, targetPath);
  return {
    path: targetPath,
    sha256: await sha256(targetPath),
    originalName: basename(source),
  };
}

async function setConfig(args) {
  const profile = profileName(args);
  const summaryDepth = args.summary;
  const styleMode = args["style-mode"];
  const stylePrompt = args["style-prompt"] || "";
  const styleReferenceSources = repeatedValues(args, "style-reference");
  const logoMode = args["logo-mode"];
  const triggerMode = args["trigger-mode"] || "explicit-image";
  const triggerPhrases = [...new Set(repeatedValues(args, "trigger-phrase").map((value) => value.trim()).filter(Boolean))];
  if (!SUMMARY_VALUES.has(summaryDepth)) throw new Error("--summary は short|standard|detailed から選んでください");
  if (!STYLE_VALUES.has(styleMode)) throw new Error("--style-mode は auto|fixed|per-run から選んでください");
  if (styleMode !== "fixed" && styleReferenceSources.length) throw new Error("--style-reference はfixed指定でだけ使用できます");
  if (styleMode === "fixed" && !stylePrompt.trim() && !styleReferenceSources.length) {
    throw new Error("fixed指定には --style-prompt または --style-reference が必要です");
  }
  if (styleReferenceSources.length > 3) throw new Error("--style-reference は最大3件です");
  if (!LOGO_VALUES.has(logoMode)) throw new Error("--logo-mode は none|always から選んでください");
  if (!TRIGGER_VALUES.has(triggerMode)) throw new Error("--trigger-mode は explicit-image|broad から選んでください");
  if (triggerPhrases.length > 10) throw new Error("--trigger-phrase は最大10件です");
  for (const phrase of triggerPhrases) {
    if (phrase.length > 120) throw new Error("--trigger-phrase は1件120文字以内にしてください");
    if (!/(議事録|minutes|妙記)/iu.test(phrase)) {
      throw new Error("--trigger-phrase には「議事録」「Minutes」「妙記」のいずれかを含めてください");
    }
  }

  const destination = paths(profile);
  await mkdir(destination.assets, { recursive: true, mode: 0o700 });
  const styleReferences = [];
  for (const [index, sourceValue] of styleReferenceSources.entries()) {
    const extension = normalizedExtension(sourceValue);
    const target = join(destination.assets, `style-reference-${String(index + 1).padStart(2, "0")}${extension}`);
    styleReferences.push(await copyManagedImage(sourceValue, target));
  }
  let logo = { mode: "none", path: null, sha256: null };
  if (logoMode === "always") {
    if (!args["logo-source"]) throw new Error("always指定には --logo-source が必要です");
    const source = resolve(args["logo-source"]);
    const target = join(destination.assets, `logo${normalizedExtension(source)}`);
    logo = { mode: "always", ...(await copyManagedImage(source, target)) };
  }

  const current = await readConfig(destination.config);
  const now = new Date().toISOString();
  const config = {
    schemaVersion: 2,
    profile,
    summaryDepth,
    styleMode,
    stylePrompt: styleMode === "fixed" ? stylePrompt.trim() : "",
    styleReferences,
    logo,
    trigger: { mode: triggerMode, phrases: triggerPhrases },
    output: { format: "png", retentionDays: 7 },
    createdAt: current?.createdAt || now,
    updatedAt: now
  };
  const errors = validateConfig(config);
  if (errors.length) throw new Error(errors.join(" / "));
  const temporary = `${destination.config}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, destination.config);
  process.stdout.write(`${JSON.stringify({ ok: true, configPath: destination.config, config }, null, 2)}\n`);
}

async function showConfig(args, validateOnly = false) {
  const profile = profileName(args);
  const destination = paths(profile);
  const config = await readConfig(destination.config);
  if (!config) {
    process.stdout.write(`${JSON.stringify({ ok: false, configured: false, profile, configPath: destination.config }, null, 2)}\n`);
    process.exitCode = validateOnly ? 2 : 0;
    return;
  }
  const errors = validateConfig(config);
  if (config.logo?.mode === "always" && config.logo.path) {
    try {
      await stat(config.logo.path);
    } catch {
      errors.push("保存済みロゴが見つかりません");
    }
  }
  for (const reference of config.styleReferences || []) {
    try {
      await stat(reference.path);
    } catch {
      errors.push(`保存済み参考画像が見つかりません: ${reference.originalName || reference.path}`);
    }
  }
  const result = { ok: errors.length === 0, configured: true, configPath: destination.config, config, errors };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (errors.length) process.exitCode = 2;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.command === "path") {
    process.stdout.write(`${paths(profileName(args)).config}\n`);
  } else if (args.command === "show") {
    await showConfig(args, false);
  } else if (args.command === "validate") {
    await showConfig(args, true);
  } else if (args.command === "set") {
    await setConfig(args);
  } else {
    throw new Error("commandは path|show|validate|set のいずれかです");
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
