import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "bin", "npx-vibe.js");

test("--agent emits structured JSON for input errors", () => {
  const result = spawnSync(process.execPath, [cli, "--agent"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.kind, "error");
  assert.equal(payload.decision.mustStop, true);
  assert.match(payload.error.message, /Missing package spec or --project/);
});

test("--agent preserves JSON errors when it follows a valued option", () => {
  const missingProject = resolve(root, "test", "fixtures", "missing-project");
  const result = spawnSync(process.execPath, [cli, "--project", missingProject, "--agent"], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.kind, "error");
  assert.equal(payload.decision.action, "retry");
});
