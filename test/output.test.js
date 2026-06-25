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

test("dashboard uses singular file labels", () => {
  const dashboard = renderDashboard({
    package: { name: "demo", version: "1.0.0" },
    profile: { npm: {}, maintainers: [], maintainersCount: 0 },
    verdict: { verdict: "proceed", score: 0 },
    stats: {
      weeklyDownloads: 10,
      packageAgeDays: 30,
      versionAgeDays: 30,
      lifecycleScripts: [],
      selectedFileCount: 1,
      fileCount: 1,
      trustContext: { signals: [] },
    },
    findings: [],
    ai: { status: "skipped", reason: "No heuristic trigger required model review." },
  }, { color: false });

  assert.match(dashboard, /Inspected: 1 selected file from 1 package file/);
});

test("dashboard identifies the resolved AI model profile", () => {
  const dashboard = renderDashboard({
    package: { name: "demo", version: "1.0.0" },
    profile: { npm: {}, maintainers: [], maintainersCount: 0 },
    verdict: { verdict: "proceed", score: 8 },
    stats: {
      weeklyDownloads: 10,
      packageAgeDays: 30,
      versionAgeDays: 30,
      lifecycleScripts: [],
      selectedFileCount: 1,
      fileCount: 1,
      trustContext: { signals: [] },
    },
    findings: [],
    ai: {
      status: "ok",
      provider: "gemini",
      providerLabel: "Gemini",
      model: "gemini-3.5-flash",
      modelProfile: "balanced",
      modelSource: "profile:balanced",
      confidence: "high",
      summary: "No suspicious behavior found.",
      findings: [],
      unsupportedFindingCount: 0,
    },
    history: {
      status: "unchanged",
      reviewedAt: "2026-06-25T00:00:00.000Z",
      previousVerdict: "caution",
      previousScore: 43,
      saveWarning: "read-only filesystem",
    },
  }, { color: false });

  assert.match(dashboard, /Gemini gemini-3\.5-flash \[balanced\] \(high confidence\)/);
  assert.match(dashboard, /Review memory: unchanged tarball/);
  assert.match(dashboard, /result was not saved \(read-only filesystem\)/);
  assert.match(dashboard, /AI evidence: 0 source-backed findings/);
});

test("dashboard renders version comparison and source-backed AI findings", () => {
  const dashboard = renderDashboard({
    package: { name: "demo", version: "2.0.0" },
    profile: { npm: {}, maintainers: [], maintainersCount: 0 },
    verdict: { verdict: "caution", score: 50 },
    stats: {
      weeklyDownloads: 10,
      packageAgeDays: 30,
      versionAgeDays: 1,
      lifecycleScripts: [{ name: "postinstall" }],
      selectedFileCount: 1,
      fileCount: 2,
      trustContext: { signals: [] },
    },
    findings: [],
    history: {
      status: "changed",
      previousVersion: "1.0.0",
      changes: {
        addedFiles: [],
        removedFiles: [],
        changedFiles: ["install.js"],
        addedFindings: ["high:download_and_execute:install.js"],
        resolvedFindings: [],
        lifecycleScriptsChanged: false,
      },
    },
    ai: {
      status: "ok",
      provider: "gemini",
      providerLabel: "Gemini",
      model: "gemini-3.5-flash",
      confidence: "high",
      summary: "A source-backed concern was found.",
      unsupportedFindingCount: 0,
      findings: [{
        severity: "high",
        file: "install.js",
        line: 12,
        evidence: "child_process.execSync(command)",
        rationale: "Executes a downloaded command.",
        evidenceVerified: true,
      }],
    },
  }, { color: false });

  assert.match(dashboard, /Version comparison: 1\.0\.0 → current/);
  assert.match(dashboard, /AI source-backed findings:/);
  assert.match(dashboard, /install\.js:12/);
});
