import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectProjectDependencies,
  loadProjectManifest,
  projectExitCode,
  scanProject,
} from "../src/project.js";
import {
  renderGitHubActionsAnnotations,
  renderProjectDashboard,
  renderProjectMarkdownSummary,
} from "../src/output.js";

function makeProject() {
  const directory = mkdtempSync(join(tmpdir(), "npx-vibe-project-"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({
    name: "demo-app",
    version: "1.0.0",
    dependencies: {
      alpha: "^1.0.0",
      local: "file:../local",
    },
    optionalDependencies: {
      beta: "~2.0.0",
    },
    devDependencies: {
      gamma: "^3.0.0",
    },
  }));
  writeFileSync(join(directory, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { name: "demo-app", version: "1.0.0" },
      "node_modules/alpha": { version: "1.4.2" },
      "node_modules/beta": { version: "2.0.7" },
      "node_modules/gamma": { version: "3.1.0" },
      "node_modules/local": { version: "9.9.9", resolved: "file:../local" },
    },
  }));
  return directory;
}

function reviewedResult(spec, verdict = "proceed", score = 5, ai = { status: "skipped", reason: "No heuristic trigger required model review." }) {
  const marker = spec.lastIndexOf("@");
  const name = marker > 0 ? spec.slice(0, marker) : spec;
  const version = marker > 0 ? spec.slice(marker + 1) : "1.0.0";
  return {
    result: {
      package: { name, version },
      verdict: { verdict, score },
      findings: verdict === "proceed" ? [] : [{ code: "lifecycle_hook", severity: "medium" }],
      ai,
    },
  };
}

test("project discovery uses exact package-lock versions and keeps dev dependencies opt-in", () => {
  const project = loadProjectManifest(makeProject());
  const production = collectProjectDependencies(project);
  const all = collectProjectDependencies(project, { includeDev: true });

  assert.equal(production.length, 3);
  assert.equal(all.length, 4);
  assert.equal(production.find((dependency) => dependency.name === "alpha").packageSpec, "alpha@1.4.2");
  assert.equal(production.find((dependency) => dependency.name === "alpha").resolvedFrom, "package-lock.json");
  assert.equal(production.find((dependency) => dependency.name === "local").packageSpec, null);
  assert.match(production.find((dependency) => dependency.name === "local").reason, /trust boundary/);
  assert.equal(all.find((dependency) => dependency.name === "gamma").packageSpec, "gamma@3.1.0");

  const legacy = collectProjectDependencies({
    manifest: { dependencies: { legacy: "^4.0.0" } },
    lockfile: { dependencies: { legacy: { version: "4.2.1" } } },
  });
  assert.equal(legacy[0].packageSpec, "legacy@4.2.1");
});

test("project scan aggregates verdicts, skips non-registry specs, and never requests execution", async () => {
  const calls = [];
  const scan = await scanProject(makeProject(), {
    aiMode: "off",
    projectConcurrency: 2,
  }, async (spec, options) => {
    calls.push({ spec, options });
    return spec.startsWith("beta@")
      ? reviewedResult(spec, "caution", 43)
      : reviewedResult(spec);
  });

  assert.equal(scan.verdict.verdict, "caution");
  assert.equal(scan.summary.scanned, 2);
  assert.equal(scan.summary.skipped, 1);
  assert.equal(projectExitCode(scan), 2);
  assert.ok(calls.every((call) => call.options.check && call.options.githubMetadata === false));
  assert.deepEqual(calls.map((call) => call.spec).sort(), ["alpha@1.4.2", "beta@2.0.7"]);
});

test("project AI review has a bounded trigger budget", async () => {
  const scan = await scanProject(makeProject(), {
    aiMode: "online",
    projectAiLimit: 1,
  }, async (spec, options) => reviewedResult(
    spec,
    "caution",
    43,
    options.aiMode === "off"
      ? { status: "skipped", reason: "Heuristic-only mode; AI was not requested." }
      : { status: "ok", provider: "test", model: "test-model" },
  ));

  assert.equal(scan.ai.attempted, 1);
  assert.equal(scan.ai.suppressed, 1);
  assert.equal(scan.ai.limit, 1);
});

test("project reports render terminal, GitHub annotation, and job-summary formats", () => {
  const scan = {
    kind: "project",
    project: {
      name: "demo-app",
      version: "1.0.0",
      manifestPath: "C:/demo/package.json",
      lockfilePath: "C:/demo/package-lock.json",
      lockfileError: null,
      includeDev: false,
    },
    verdict: { verdict: "caution", score: 43 },
    summary: { discovered: 1, scanned: 1, skipped: 0, errors: 0, proceed: 0, caution: 1, block: 0 },
    ai: { enabled: false, limit: 0, attempted: 0, suppressed: 0 },
    packages: [reviewedResult("beta@2.0.7", "caution", 43).result],
    skipped: [],
    errors: [],
  };

  assert.match(renderProjectDashboard(scan, { color: false }), /Scanned: 1\/1 direct dependencies/);
  assert.match(renderProjectDashboard(scan, { color: false }), /beta@2\.0\.7/);
  assert.match(renderGitHubActionsAnnotations(scan), /::warning title=npx-vibe%3A beta::Caution 43\/100/);
  assert.match(renderProjectMarkdownSummary(scan), /\| beta \| 2\.0\.7 \| Caution \| 43\/100 \|/);
});

test("project scan operational errors override verdict exit codes", async () => {
  const scan = await scanProject(makeProject(), {
    aiMode: "off",
  }, async (spec) => {
    if (spec.startsWith("alpha@")) {
      throw new Error("registry unavailable");
    }
    return reviewedResult(spec);
  });

  assert.equal(scan.summary.errors, 1);
  assert.equal(projectExitCode(scan), 1);
});
