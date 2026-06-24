import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboard } from "../src/output.js";

test("dashboard renders trust context and line-level evidence", () => {
  const dashboard = renderDashboard({
    package: { name: "demo", version: "1.0.0" },
    profile: { npm: {}, maintainers: [], maintainersCount: 0 },
    verdict: { verdict: "caution", score: 43 },
    stats: {
      weeklyDownloads: 200_000,
      packageAgeDays: 900,
      versionAgeDays: 20,
      lifecycleScripts: [{ name: "postinstall" }],
      selectedFileCount: 2,
      fileCount: 5,
      trustContext: {
        level: "established-signals",
        signals: ["long registry history", "high weekly adoption"],
        note: "Registry popularity and age provide context, but never override code findings.",
      },
    },
    findings: [{
      severity: "medium",
      code: "network_and_shell",
      file: "install.js",
      detail: "Code combines network access with shell execution.",
      evidence: [{ line: 42, excerpt: "fetch(url); child_process.execFile(binary);" }],
    }],
    ai: { status: "skipped", reason: "Heuristic-only mode; AI was not requested." },
  }, { color: false });

  assert.match(dashboard, /Established signals: long registry history, high weekly adoption/);
  assert.match(dashboard, /Evidence line 42: fetch\(url\); child_process\.execFile/);
});
