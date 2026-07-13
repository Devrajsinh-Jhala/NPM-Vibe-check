import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compareReviewMemory,
  createReviewFingerprint,
  loadReviewMemory,
  saveReviewMemory,
} from "../src/history.js";

function fingerprint(version = "1.0.0", fileText = "console.log('safe')", findings = []) {
  return createReviewFingerprint(
    {
      spec: { name: "demo" },
      version,
      integrity: `sha512-${version}`,
    },
    { results: [] },
    {
      stats: { lifecycleScripts: [{ name: "postinstall", command: "node install.js" }] },
      findings,
    },
    {
      selectedFiles: [{ path: "install.js", text: fileText }],
    }
  );
}

test("review memory recognizes an unchanged integrity without suppressing scanning", () => {
  const directory = mkdtempSync(join(tmpdir(), "npx-vibe-history-"));
  const historyFile = join(directory, "reviews.json");
  const memory = loadReviewMemory({ historyFile });
  const current = fingerprint();
  const result = {
    verdict: { verdict: "caution", score: 43 },
    ai: { status: "skipped" },
  };

  assert.equal(compareReviewMemory(memory, current).status, "first-review");
  assert.equal(saveReviewMemory(memory, current, result).saved, true);

  const reloaded = loadReviewMemory({ historyFile });
  const comparison = compareReviewMemory(reloaded, current);
  assert.equal(comparison.status, "unchanged");
  assert.equal(comparison.previousVerdict, "caution");
  assert.equal(JSON.parse(readFileSync(historyFile, "utf8")).schemaVersion, 1);
});

test("review memory reports selected-file, finding, and lifecycle deltas", () => {
  const directory = mkdtempSync(join(tmpdir(), "npx-vibe-history-"));
  const historyFile = join(directory, "reviews.json");
  const memory = loadReviewMemory({ historyFile });
  const previous = fingerprint("1.0.0", "console.log('old')");
  saveReviewMemory(memory, previous, {
    verdict: { verdict: "proceed", score: 0 },
    ai: { status: "skipped" },
  });

  const current = fingerprint("1.1.0", "fetch(url)", [{
    severity: "medium",
    code: "network_and_shell",
    file: "install.js",
  }]);
  current.lifecycleScripts = [{ name: "postinstall", command: "node new-install.js" }];

  const comparison = compareReviewMemory(loadReviewMemory({ historyFile }), current);
  assert.equal(comparison.status, "changed");
  assert.deepEqual(comparison.changes.changedFiles, ["install.js"]);
  assert.equal(comparison.changes.addedFindings.length, 1);
  assert.equal(comparison.changes.lifecycleScriptsChanged, true);
});

test("review memory can be disabled", () => {
  const memory = loadReviewMemory({ historyEnabled: false });
  assert.equal(compareReviewMemory(memory, fingerprint()).status, "disabled");
  assert.equal(saveReviewMemory(memory, fingerprint(), {}).saved, false);
});

test("parallel reviewers merge stale history snapshots instead of dropping packages", () => {
  const directory = mkdtempSync(join(tmpdir(), "npx-vibe-history-"));
  const historyFile = join(directory, "reviews.json");
  const firstMemory = loadReviewMemory({ historyFile });
  const secondMemory = loadReviewMemory({ historyFile });
  const first = fingerprint();
  const second = { ...fingerprint(), packageName: "another-demo" };
  const result = { verdict: { verdict: "proceed", score: 0 }, ai: { status: "skipped" } };

  saveReviewMemory(firstMemory, first, result);
  saveReviewMemory(secondMemory, second, result);

  const packages = JSON.parse(readFileSync(historyFile, "utf8")).packages;
  assert.ok(packages.demo);
  assert.ok(packages["another-demo"]);
});
