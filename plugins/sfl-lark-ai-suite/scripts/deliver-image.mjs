#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const APP_NAME = "gijiroku-image-bridge";

function parseArgs(argv) {
  const args = { replyInThread: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--reply-in-thread") {
      args.replyInThread = true;
      continue;
    }
    if (key === "--dry-run") {
      args.dryRun = true;
      continue;
    }
    const value = argv[index + 1];
    if (!key.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`不正な引数です: ${key}`);
    }
    args[key.slice(2)] = value;
    index += 1;
  }
  return args;
}

function profileName(args) {
  const value = args.profile || process.env.LARK_CHANNEL_PROFILE || "default";
  if (!/^[A-Za-z0-9._-]+$/.test(value)) throw new Error("profile名が不正です");
  return value;
}

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function loadLedger(path) {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return Array.isArray(parsed.deliveries) ? parsed : { schemaVersion: 1, deliveries: [] };
  } catch (error) {
    if (error?.code === "ENOENT") return { schemaVersion: 1, deliveries: [] };
    throw error;
  }
}

async function saveLedger(path, ledger) {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(ledger, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!/^om[t]?_/.test(args["message-id"] || "")) throw new Error("--message-id が必要です");
  if (!args["minute-token"]) throw new Error("--minute-token が必要です");
  if (!args.image) throw new Error("--image が必要です");

  const imagePath = resolve(args.image);
  const info = await stat(imagePath);
  if (!info.isFile()) throw new Error("--image がファイルではありません");
  const profile = profileName(args);
  const appRoot = join(homedir(), "Library", "Application Support", APP_NAME, "profiles", profile);
  const ledgerPath = join(appRoot, "deliveries.json");
  await mkdir(appRoot, { recursive: true, mode: 0o700 });

  const imageHash = hash(await readFile(imagePath));
  const deliveryId = hash(`${args["message-id"]}\0${args["minute-token"]}\0${imageHash}`);
  const ledger = await loadLedger(ledgerPath);
  if (ledger.deliveries.some((item) => item.id === deliveryId && item.status === "sent")) {
    process.stdout.write(`${JSON.stringify({ ok: true, skipped: true, reason: "already-sent", deliveryId })}\n`);
    return;
  }

  const idempotencyKey = `giji-${deliveryId.slice(0, 40)}`;
  const commandArgs = [
    "im",
    "+messages-reply",
    "--message-id",
    args["message-id"],
    "--image",
    `./${basename(imagePath)}`,
    "--as",
    "bot",
    "--idempotency-key",
    idempotencyKey,
  ];
  if (args.replyInThread) commandArgs.push("--reply-in-thread");
  if (args.dryRun) commandArgs.push("--dry-run");

  const result = await execFileAsync("lark-cli", commandArgs, {
    cwd: dirname(imagePath),
    env: process.env,
    maxBuffer: 2 * 1024 * 1024,
  });
  if (!args.dryRun) {
    ledger.deliveries.push({ id: deliveryId, status: "sent", sentAt: new Date().toISOString() });
    ledger.deliveries = ledger.deliveries.slice(-500);
    await saveLedger(ledgerPath, ledger);
  }
  process.stdout.write(
    `${JSON.stringify({ ok: true, skipped: false, dryRun: args.dryRun, deliveryId, response: result.stdout.trim() })}\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ ok: false, error: error.message })}\n`);
  process.exitCode = 1;
});
