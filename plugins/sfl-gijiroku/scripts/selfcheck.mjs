#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
let failures = 0;

function commandExists(name) {
  const result = process.platform === "win32"
    ? spawnSync("where.exe", [name], { encoding: "utf8" })
    : spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  return result.status === 0;
}

function report(ok, label, severity = "NG") {
  process.stdout.write(`${ok ? "OK  " : severity.padEnd(4)} ${label}\n`);
  if (!ok && severity === "NG") failures += 1;
}

for (const command of ["node", "lark-cli", "lark-channel-bridge"]) {
  report(commandExists(command), command);
}

const python = ["python3", "python", "py"].find(commandExists);
report(Boolean(python), "Python");
if (python) {
  report(spawnSync(python, ["-c", "import PIL"], { encoding: "utf8" }).status === 0, "Python Pillow");
}

const config = spawnSync(process.execPath, [join(scriptDirectory, "gijiroku-config.mjs"), "validate"], {
  encoding: "utf8",
});
report(config.status === 0, "議事録設定（Larkドキュメント＋画像）", "WARN");

if (process.env.LARK_CHANNEL === "1") {
  process.stdout.write(`OK   lark-channel-bridge コンテキスト（profile=${process.env.LARK_CHANNEL_PROFILE || "default"}）\n`);
} else {
  process.stdout.write("INFO Bridgeセッション外です。Lark返信テストはLark IMから実行してください\n");
}

if (failures > 0) process.exitCode = 1;
