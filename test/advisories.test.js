import test from "node:test";
import assert from "node:assert/strict";
import { advisoryFinding } from "../src/advisories.js";
import { analyzePackage, shouldAskAi } from "../src/analysis.js";
import { decideVerdict } from "../src/verdict.js";

test("advisory findings rank by severity and name the CVE", () => {
  const finding = advisoryFinding([
    { id: "GHSA-low", severity: "LOW", summary: "Minor", aliases: [] },
    { id: "GHSA-worst", severity: "CRITICAL", summary: "Prototype pollution", aliases: ["CVE-2021-1", "GHSA-x"] },
    { id: "GHSA-mid", severity: "MODERATE", summary: "ReDoS", aliases: [] },
  ], "demo@1.0.0");

  assert.equal(finding.severity, "high");
  assert.match(finding.detail, /GHSA-worst \(CVE-2021-1\) CRITICAL/);
  assert.equal(finding.evidence[0].excerpt, "Prototype pollution");
});

test("a moderate advisory stays medium and a clean package produces nothing", () => {
  assert.equal(advisoryFinding([{ id: "G", severity: "MODERATE" }], "x@1").severity, "medium");
  assert.equal(advisoryFinding([], "x@1"), null);
  assert.equal(advisoryFinding(undefined, "x@1"), null);
});

test("a known advisory raises caution but never forces a block on its own", () => {
  const manifest = { name: "vulnerable", version: "1.0.0", bin: "cli.js" };
  const analysis = analyzePackage({
    spec: { name: "vulnerable", wanted: "latest" },
    version: "1.0.0",
    manifest,
    packageCreatedAt: "2017-01-01T00:00:00.000Z",
    versionPublishedAt: "2024-01-01T00:00:00.000Z",
    downloads: { downloads: 5_000_000 },
    advisories: [{ id: "GHSA-a", severity: "CRITICAL", summary: "RCE", aliases: ["CVE-2020-1"] }],
  }, { findings: [], fileCount: 2, totalUnpackedBytes: 500, packageJson: manifest, selectedFiles: [] });

  assert.equal(analysis.stats.advisoryCount, 1);
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "caution");
});

test("an advisory does not spend an AI review", () => {
  // The model reads source; it cannot adjudicate a published CVE.
  assert.equal(shouldAskAi([{ severity: "high", code: "known_vulnerability" }]), false);
  assert.equal(shouldAskAi([{ severity: "high", code: "suspicious_home_write" }]), true);
});
