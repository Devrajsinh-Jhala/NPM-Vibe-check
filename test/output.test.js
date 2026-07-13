import test from "node:test";
import assert from "node:assert/strict";
import { renderDashboard, toAgentError, toAgentResult } from "../src/output.js";

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

test("agent package output exposes a versioned decision envelope", () => {
  const payload = JSON.parse(toAgentResult({
    package: { name: "esbuild", requested: "latest", version: "0.28.1" },
    verdict: { verdict: "caution", score: 43 },
    findings: [],
  }, { kind: "package-scan", exitCode: 2, version: "1.4.0" }));

  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.tool.version, "1.4.0");
  assert.equal(payload.kind, "package-scan");
  assert.equal(payload.status, "complete");
  assert.equal(payload.decision.action, "review");
  assert.equal(payload.decision.requiresHumanReview, true);
  assert.equal(payload.decision.requiresApproval, true);
  assert.equal(payload.decision.safeToExecute, false);
  assert.equal(payload.decision.mayContinue, false);
  assert.equal(payload.subject.name, "esbuild");
});

test("agent project output treats incomplete scans as a stop", () => {
  const payload = JSON.parse(toAgentResult({
    project: { name: "demo", version: "1.0.0", manifestPath: "C:/demo/package.json" },
    verdict: { verdict: "proceed", score: 0 },
    errors: [{ name: "broken", message: "registry unavailable" }],
  }, { kind: "project-scan", exitCode: 1, version: "1.4.0" }));

  assert.equal(payload.status, "incomplete");
  assert.equal(payload.decision.action, "retry");
  assert.equal(payload.decision.mustStop, true);
  assert.equal(payload.decision.blocked, false);
  assert.equal(payload.decision.mayContinue, false);
});

test("agent errors remain valid JSON with a fail-closed decision", () => {
  const payload = JSON.parse(toAgentError(new Error("Missing package spec."), { version: "1.4.0" }));
  assert.equal(payload.kind, "error");
  assert.equal(payload.status, "error");
  assert.equal(payload.decision.exitCode, 1);
  assert.equal(payload.decision.mustStop, true);
  assert.match(payload.error.message, /Missing package/);
});
