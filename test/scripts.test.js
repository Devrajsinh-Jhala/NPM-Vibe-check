import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyAllowScripts,
  buildAllowScriptsPatch,
  classifyInstallScripts,
  collectPendingScriptPackages,
  commandSegments,
  networkHosts,
  readAllowScripts,
  resolveAllowState,
  reviewScriptApprovals,
  scriptApprovalExitCode,
} from "../src/scripts.js";

function scanResult({ scripts = [], findings = [] } = {}) {
  return {
    verdict: { verdict: "proceed", score: 0 },
    findings,
    stats: { lifecycleScripts: scripts },
  };
}

function lockProject(overrides = {}) {
  return {
    manifestPath: "/repo/package.json",
    directory: "/repo",
    manifest: { name: "app", ...overrides.manifest },
    lockfilePath: "/repo/package-lock.json",
    lockfile: {
      packages: {
        "": { name: "app" },
        "node_modules/native-thing": {
          version: "2.1.0", hasInstallScript: true,
          resolved: "https://registry.npmjs.org/native-thing/-/native-thing-2.1.0.tgz",
        },
        "node_modules/binary-fetcher": {
          version: "1.0.4", hasInstallScript: true, dev: true,
          resolved: "https://registry.npmjs.org/binary-fetcher/-/binary-fetcher-1.0.4.tgz",
        },
        "node_modules/plain-lib": {
          version: "3.0.0",
          resolved: "https://registry.npmjs.org/plain-lib/-/plain-lib-3.0.0.tgz",
        },
        "node_modules/linked-thing": { hasInstallScript: true, link: true, resolved: "packages/linked" },
        "node_modules/from-git": {
          version: "1.0.0", hasInstallScript: true,
          resolved: "git+ssh://git@github.com/o/r.git#abc",
        },
      },
    },
    ...overrides,
  };
}

test("pending packages come from lockfile install-script flags", () => {
  const pending = collectPendingScriptPackages(lockProject());
  assert.deepEqual(pending.map((entry) => entry.packageSpec), [
    "binary-fetcher@1.0.4",
    "native-thing@2.1.0",
  ]);
  // A package with no install script, a workspace link, and a git resolution are
  // all outside the question npm 12 asks.
  assert.equal(pending.some((entry) => entry.name === "plain-lib"), false);
  assert.equal(pending.some((entry) => entry.name === "linked-thing"), false);
  assert.equal(pending.some((entry) => entry.name === "from-git"), false);
  assert.equal(pending.find((entry) => entry.name === "binary-fetcher").dev, true);
});

test("existing allowScripts entries resolve by name and by pinned version", () => {
  const allow = readAllowScripts({
    allowScripts: { "native-thing": true, "binary-fetcher@1.0.4": false, "ignored": "yes" },
  });
  assert.equal(allow.entries.size, 2, "non-boolean values are ignored");
  assert.equal(resolveAllowState(allow, "native-thing", "9.9.9"), "allowed");
  assert.equal(resolveAllowState(allow, "binary-fetcher", "1.0.4"), "denied");
  // A pinned entry must not cover a different version.
  assert.equal(resolveAllowState(allow, "binary-fetcher", "2.0.0"), "pending");
  assert.equal(resolveAllowState(allow, "unknown", "1.0.0"), "pending");

  const pending = collectPendingScriptPackages(lockProject({
    manifest: { allowScripts: { "native-thing": true } },
  }));
  assert.equal(pending.find((entry) => entry.name === "native-thing").allowState, "allowed");
});

test("credential access in an install script is a deny", () => {
  const decision = classifyInstallScripts(scanResult({
    scripts: [{ name: "postinstall", command: "node steal.js" }],
    findings: [{
      severity: "critical", code: "possible_secret_exfiltration", file: "steal.js",
      detail: "Reads env and sends it.",
      evidence: [{ line: 4, excerpt: 'readFileSync(homedir() + "/.npmrc")' }],
    }],
  }));
  assert.equal(decision.decision, "deny");
  assert.equal(decision.evidence[0].line, 4);
});

test("a pure local build toolchain is approved", () => {
  const decision = classifyInstallScripts(scanResult({
    scripts: [{ name: "install", command: "node-gyp rebuild --release" }],
  }));
  assert.equal(decision.decision, "approve");
});

test("a build command that can also download a binary is not approved", () => {
  // `prebuild-install || node-gyp rebuild` reads like a build step, but its first
  // branch fetches a prebuilt binary over the network. Matching on containment
  // would approve it; every segment has to be a recognised local build tool.
  const decision = classifyInstallScripts(scanResult({
    scripts: [{ name: "install", command: "prebuild-install || node-gyp rebuild --release" }],
  }));
  assert.equal(decision.decision, "review");
});

test("an implicit node-gyp rebuild with no declared script is approved", () => {
  const decision = classifyInstallScripts(scanResult({ scripts: [] }));
  assert.equal(decision.decision, "approve");
  assert.match(decision.reasons[0], /binding\.gyp/);
});

test("network in an install hook needs a human, and names the host", () => {
  const decision = classifyInstallScripts(scanResult({
    scripts: [{ name: "postinstall", command: "curl https://cdn.vendor.example/bin.tgz -o bin.tgz" }],
    findings: [{
      severity: "high", code: "network_in_install_hook", file: "package.json",
      detail: "Install lifecycle command performs network activity.", evidence: [],
    }],
  }));
  assert.equal(decision.decision, "review");
  assert.deepEqual(decision.hosts, ["cdn.vendor.example"]);
});

test("command segments split on every shell operator", () => {
  assert.deepEqual(
    commandSegments("a && b || c ; d | e"),
    ["a", "b", "c", "d", "e"]
  );
});

test("host extraction ignores interpolated URLs", () => {
  const hosts = networkHosts(scanResult({
    scripts: [{ name: "install", command: "curl https://${HOST}/x && curl https://real.example/y" }],
  }));
  assert.deepEqual(hosts, ["real.example"]);
});

test("only unambiguous decisions are written to allowScripts", async () => {
  const directory = mkdtempSync(join(tmpdir(), "npx-vibe-allow-"));
  const manifestPath = join(directory, "package.json");
  writeFileSync(manifestPath, `${JSON.stringify({
    name: "app",
    version: "1.0.0",
    allowScripts: { "already-there": true },
  }, null, 2)}\n`);

  const report = {
    packages: [
      { name: "good", version: "1.0.0", packageSpec: "good@1.0.0", decision: "approve" },
      { name: "bad", version: "2.0.0", packageSpec: "bad@2.0.0", decision: "deny" },
      { name: "unclear", version: "3.0.0", packageSpec: "unclear@3.0.0", decision: "review" },
    ],
  };

  const patch = buildAllowScriptsPatch(report);
  assert.deepEqual([...patch.entries()], [["good", true], ["bad", false]]);
  assert.equal(patch.has("unclear"), false, "review packages are never auto-written");

  const write = applyAllowScripts(manifestPath, patch);
  assert.equal(write.written, true);

  const written = JSON.parse(readFileSync(manifestPath, "utf8"));
  assert.deepEqual(written.allowScripts, {
    "already-there": true,
    bad: false,
    good: true,
  });
  assert.equal(written.name, "app", "the rest of the manifest is preserved");

  // --pin writes exact versions instead.
  const pinned = buildAllowScriptsPatch(report, { pin: true });
  assert.deepEqual([...pinned.keys()], ["good@1.0.0", "bad@2.0.0"]);
});

test("approve-scripts exits 3 on a deny, 2 on a review, 0 when settled", () => {
  const base = { errors: [], summary: { approve: 0, review: 0, deny: 0 } };
  assert.equal(scriptApprovalExitCode({ ...base, summary: { ...base.summary, deny: 1 } }), 3);
  assert.equal(scriptApprovalExitCode({ ...base, summary: { ...base.summary, review: 1 } }), 2);
  assert.equal(scriptApprovalExitCode({ ...base, summary: { ...base.summary, approve: 2 } }), 0);
  assert.equal(scriptApprovalExitCode({ ...base, errors: [{ name: "x" }] }), 1);
});

test("approve-scripts reviews only pending packages and requires a lockfile", async () => {
  const seen = [];
  const report = await reviewScriptApprovals(
    lockProject({ manifest: { allowScripts: { "binary-fetcher": true } } }),
    { projectConcurrency: 2 },
    async (spec) => {
      seen.push(spec);
      return { result: scanResult({ scripts: [{ name: "install", command: "node-gyp rebuild" }] }) };
    }
  );

  assert.deepEqual(seen, ["native-thing@2.1.0"], "an allowed package is not re-reviewed");
  assert.equal(report.summary.alreadyAllowed, 1);
  assert.equal(report.summary.approve, 1);
  assert.equal(scriptApprovalExitCode(report), 0);

  await assert.rejects(
    () => reviewScriptApprovals({ ...lockProject(), lockfile: null }, {}, async () => ({})),
    /needs a package-lock\.json/
  );
});

test("the approvals report carries a verdict the agent contract can read", async () => {
  const project = lockProject();
  const deny = await reviewScriptApprovals(project, {}, async () => ({
    result: scanResult({
      scripts: [{ name: "postinstall", command: "node x.js" }],
      findings: [{ severity: "critical", code: "download_and_execute", file: "x.js", detail: "d", evidence: [] }],
    }),
  }));
  assert.equal(deny.verdict.verdict, "block");

  const review = await reviewScriptApprovals(project, {}, async () => ({
    result: scanResult({ scripts: [{ name: "install", command: "sh ./build.sh" }] }),
  }));
  assert.equal(review.verdict.verdict, "caution");

  const clean = await reviewScriptApprovals(project, {}, async () => ({
    result: scanResult({ scripts: [{ name: "install", command: "node-gyp rebuild" }] }),
  }));
  assert.equal(clean.verdict.verdict, "proceed");
});
