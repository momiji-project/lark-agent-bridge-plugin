import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
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
        "explicit-minutes",
      ],
      home,
    );
    assert.equal(applied.status, 0, applied.stderr || applied.stdout);
    const payload = JSON.parse(applied.stdout);
    assert.equal(payload.config.summaryDepth, "standard");
    assert.equal(payload.config.styleMode, "auto");
    assert.equal(payload.config.logo.mode, "none");
    assert.equal(payload.config.trigger.mode, "explicit-minutes");
    assert.equal(payload.config.output.document.enabled, true);
    assert.equal(payload.config.output.document.parentPosition, "my_library");
    assert.equal(payload.config.output.images.enabled, true);

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
        "explicit-minutes",
      ],
      home,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /style-prompt|style-reference/iu);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

test("version 2 image-only profiles migrate to document plus image output", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "sfl-gijiroku-migrate-"));
  try {
    const profileRoot = path.join(home, "profiles", "legacy");
    await mkdir(profileRoot, { recursive: true });
    await writeFile(
      path.join(profileRoot, "config.json"),
      JSON.stringify({
        schemaVersion: 2,
        profile: "legacy",
        summaryDepth: "standard",
        styleMode: "auto",
        stylePrompt: "",
        styleReferences: [],
        logo: { mode: "none", path: null, sha256: null },
        trigger: { mode: "explicit-image", phrases: [] },
        output: { format: "png", retentionDays: 7 },
      }),
    );

    const shown = run(["show", "--profile", "legacy"], home);
    assert.equal(shown.status, 0, shown.stderr || shown.stdout);
    const payload = JSON.parse(shown.stdout);
    assert.equal(payload.config.schemaVersion, 3);
    assert.equal(payload.config.trigger.mode, "explicit-minutes");
    assert.equal(payload.config.output.document.enabled, true);
    assert.equal(payload.config.output.images.format, "png");
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
