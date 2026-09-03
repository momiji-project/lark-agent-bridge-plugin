import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testDirectory = path.dirname(fileURLToPath(import.meta.url));
const script = path.resolve(testDirectory, "../scripts/render_minutes_document.py");
const fixture = path.resolve(testDirectory, "fixtures/sample-summary.json");

test("structured minutes render to a complete Lark document draft", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "sfl-gijiroku-document-"));
  try {
    const output = path.join(directory, "minutes.xml");
    const result = spawnSync("python3", [script, "--input", fixture, "--output", output], {
      encoding: "utf8",
      timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const xml = await readFile(output, "utf8");
    assert.match(xml, /^<title>.+｜議事録<\/title>/u);
    assert.match(xml, /<h1>会議の要旨<\/h1>/u);
    assert.match(xml, /<h1>決定事項<\/h1>/u);
    assert.match(xml, /<h1>アクション<\/h1>/u);
    assert.match(xml, /<table>/u);
    assert.doesNotMatch(xml, /undefined|null/u);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
