import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDirectory, "../scripts/gijiroku-config.mjs");

function run(args, home) {
  return spawnSync(process.execPath, [script, ...args], {
    env: { ...process.env, GIJIROKU_IMAGE_BRIDGE_HOME: home },
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("recommended setup writes a valid private profile and is readable", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "sfl-gijiroku-config-"));
  try {
    const applied = run(
      [
        "set",
        "--profile",
        "main",
        "--summary",
        "standard",
        "--style-mode",
        "auto",
        "--logo-mode",
        "none",
        "--trigger-mode",
        "explicit-image",
      ],
      home,
    );
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
    const payload = JSON.parse(applied.stdout);
    assert.equal(payload.config.summaryDepth, "standard");
    assert.equal(payload.config.styleMode, "auto");
    assert.equal(payload.config.logo.mode, "none");
    assert.equal(payload.config.trigger.mode, "explicit-image");

    const config = JSON.parse(await readFile(payload.configPath, "utf8"));
    assert.equal(config.profile, "main");
    if (process.platform !== "win32") {
      assert.equal((await stat(payload.configPath)).mode & 0o777, 0o600);
    }

    const validated = run(["validate", "--profile", "main"], home);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    assert.equal(JSON.parse(validated.stdout).ok, true);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("fixed style without a prompt or reference is rejected", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "sfl-gijiroku-invalid-"));
  try {
    const result = run(
      [
        "set",
        "--summary",
        "standard",
        "--style-mode",
        "fixed",
        "--logo-mode",
        "none",
        "--trigger-mode",
        "explicit-image",
      ],
      home,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /style-prompt|style-reference/iu);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
