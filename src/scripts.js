import { readFileSync, writeFileSync } from "node:fs";
import { compareVersions, parseVersion } from "./spec.js";
import { lockedArtifactKey, lockedDependency } from "./project.js";
import { reviewCoverage } from "./coverage.js";

// npm 12 records install-script permission in package.json as an object keyed by
// either a bare package name or an exact name@version, with a boolean value:
//   { "allowScripts": { "sharp": true, "esbuild@0.28.2": true, "shady": false } }
// New decisions are version-pinned: a reviewed release never authorises a future one.
const ALLOW_FIELD = "allowScripts";

// Findings that mean "do not run this at install time", full stop.
const DENY_CODES = new Set([
  "possible_secret_exfiltration",
  "download_and_execute",
  "suspicious_home_write",
  "possible_cryptominer",
  "integrity_mismatch",
  "unsafe_tar_path",
  "unsafe_symlink",
  "truncated_tarball",
]);

// Findings a person has to look at. Most legitimate native packages land here,
// because fetching a prebuilt binary is both completely normal and exactly what
// an attacker does. The evidence is the point, not the label.
const REVIEW_CODES = new Set([
  "network_in_install_hook",
  "obfuscated_code",
  "network_and_shell",
  "shell_in_install_hook",
  "transitive_install_script",
  "too_many_archive_entries",
  "large_unpacked_tarball",
  "large_tarball",
]);

// Local compilation toolchains. These build from source in the package directory
// and reach the network only through the package manager that already ran.
const NATIVE_BUILD_PATTERNS = [
  /^(?:node-gyp\s+(?:rebuild|build|configure)|node-gyp-build|cargo-cp-artifact|napi\s+build|neon\s+build|cmake-js(?:\s+(?:build|compile|configure))?)(?:\s+--?[a-z][a-z0-9_-]*(?:=[a-z0-9._/-]+)?)*$/i,
];

export function readAllowScripts(manifest) {
  const raw = manifest?.[ALLOW_FIELD];
  const entries = new Map();
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === "boolean") {
        entries.set(key, value);
      }
    }
  }
  return { entries, present: entries.size > 0 };
}

export function resolveAllowState(allow, name, version) {
  const pinned = `${name}@${version}`;
  if (allow.entries.get(name) === false || allow.entries.get(pinned) === false) return "denied";
  if (allow.entries.has(pinned)) {
    return allow.entries.get(pinned) ? "allowed" : "denied";
  }
  if (allow.entries.has(name)) {
    return allow.entries.get(name) ? "allowed" : "denied";
  }
  return "pending";
}

// The lockfile already marks every package npm would run an install script for.
// Reading it directly means this works on npm 10 and 11 too, so a team can settle
// the allowlist before upgrading rather than after their CI starts warning.
export function collectPendingScriptPackages(project, options = {}) {
  const entries = project.lockfile?.packages;
  if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
    return [];
  }

  const allow = readAllowScripts(project.manifest);
  const collected = new Map();

  for (const [location, entry] of Object.entries(entries)) {
    if (!location || !entry || typeof entry !== "object") {
      continue;
    }
    if (!entry.hasInstallScript || entry.extraneous) {
      continue;
    }
    if (!location.includes("node_modules/")) {
      continue;
    }
    const name = location.split("node_modules/").pop();
    const version = entry.version;
    if (!name) {
      continue;
    }

    const key = lockedArtifactKey(name, entry);
    if (collected.has(key)) {
      continue;
    }
    collected.set(key, {
      name,
      version,
      location,
      resolved: entry.resolved ?? null,
      ...lockedDependency({ name, requested: String(version ?? "unknown"), groups: [] }, entry, options),
      dev: Boolean(entry.dev),
      allowState: resolveAllowState(allow, name, version),
    });
  }

  return [...collected.values()].sort((left, right) =>
    left.name.localeCompare(right.name) || (parseVersion(left.version) && parseVersion(right.version)
      ? compareVersions(left.version, right.version) : String(left.version).localeCompare(String(right.version)))
  );
}

export function networkHosts(result) {
  const hosts = new Set();
  const sources = [
    ...(result?.stats?.lifecycleScripts ?? []).map((script) => script.command),
    ...(result?.findings ?? []).flatMap((finding) =>
      (finding.evidence ?? []).map((evidence) => evidence.excerpt)
    ),
  ];

  for (const source of sources) {
    const matcher = /https?:\/\/([^/\s"'`)\\]+)/gi;
    let match;
    while ((match = matcher.exec(String(source ?? ""))) !== null) {
      const host = match[1].replace(/^www\./i, "").toLowerCase();
      if (host && !host.includes("$") && !host.includes("{")) {
        hosts.add(host);
      }
      if (hosts.size >= 6) {
        return [...hosts];
      }
    }
  }
  return [...hosts];
}

export function classifyInstallScripts(result) {
  const findings = result?.findings ?? [];
  const scripts = result?.stats?.lifecycleScripts ?? [];
  const reasons = [];

  const denying = findings.filter(
    (finding) => finding.severity === "critical" || DENY_CODES.has(finding.code)
  );
  if (denying.length) {
    for (const finding of denying.slice(0, 3)) {
      reasons.push(`${finding.code}: ${finding.detail}`);
    }
    return { decision: "deny", reasons, hosts: networkHosts(result), scripts, evidence: pickEvidence(denying) };
  }

  const highObfuscation = findings.find(
    (finding) => finding.code === "obfuscated_code" && finding.severity === "high"
  );
  if (highObfuscation) {
    reasons.push(`${highObfuscation.code}: ${highObfuscation.detail}`);
    return { decision: "deny", reasons, hosts: networkHosts(result), scripts, evidence: pickEvidence([highObfuscation]) };
  }

  const reviewable = findings.filter((finding) => REVIEW_CODES.has(finding.code));
  if (reviewable.length) {
    for (const finding of reviewable.slice(0, 3)) {
      reasons.push(`${finding.code}: ${finding.detail}`);
    }
    return { decision: "review", reasons, hosts: networkHosts(result), scripts, evidence: pickEvidence(reviewable) };
  }

  if (!scripts.length) {
    reasons.push("Lockfile flags install-time code but no declared script was inspected. Review implicit native builds and binding.gyp manually.");
    return { decision: "review", reasons, hosts: [], scripts, evidence: [] };
  }
  if (result?.stats?.truncatedFileCount || result?.stats?.omittedFileCount) {
    reasons.push("Selected source exceeded the review budget. Partial source inspection cannot automatically approve install scripts.");
    return { decision: "review", reasons, hosts: networkHosts(result), scripts, evidence: [] };
  }

  // Every segment of every command has to be a recognised local build tool. A
  // containment test is not enough: `prebuild-install || node-gyp rebuild` reads
  // as a build command but its first branch downloads a binary over the network.
  const buildOnly = scripts.every((script) =>
    !/[\n\r`$<>&]/.test(script.command) && commandSegments(script.command).length > 0
      && commandSegments(script.command).every((segment) => NATIVE_BUILD_PATTERNS.some((pattern) => pattern.test(segment)))
  );
  if (buildOnly) {
    reasons.push("Install scripts only invoke a local native build toolchain.");
    return { decision: "approve", reasons, hosts: [], scripts, evidence: [] };
  }

  // "Unrecognised" is not the same as "suspicious", and saying which one it is
  // decides whether a person needs to open the tarball.
  const hosts = networkHosts(result);
  // Every package here has an install script by definition, and registry context
  // is not behaviour, so neither counts as "something was found".
  const behavioural = findings.filter((finding) =>
    finding.severity !== "info"
    && !["lifecycle_hook", "publish_lifecycle_hook", "known_vulnerability"].includes(finding.code)
  );
  reasons.push(
    behavioural.length === 0 && hosts.length === 0
      ? "Nothing matched: no network, shell, credential, or write-outside-package pattern "
        + "was found in the install script or the files it reaches. Unrecognised, not suspicious."
      : "Install scripts run commands that no automatic rule recognises."
  );
  return { decision: "review", reasons, hosts, scripts, evidence: [] };
}

export function commandSegments(command) {
  const sep = String.fromCharCode(1);
  return String(command ?? "")
    .split("&&").join(sep)
    .split("||").join(sep)
    .split(";").join(sep)
    .split("|").join(sep)
    .split(sep)
    .map((part) => part.trim())
    .filter(Boolean);
}

function pickEvidence(findings) {
  const evidence = [];
  for (const finding of findings) {
    for (const item of finding.evidence ?? []) {
      evidence.push({ file: finding.file, line: item.line, excerpt: item.excerpt });
      if (evidence.length >= 3) {
        return evidence;
      }
    }
  }
  return evidence;
}

export async function reviewScriptApprovals(project, options, reviewer) {
  if (typeof reviewer !== "function") {
    throw new Error("Script approval review requires a package reviewer.");
  }
  if (!project.lockfile?.packages || typeof project.lockfile.packages !== "object" || Array.isArray(project.lockfile.packages)) {
    throw new Error(
      project.lockfileError
        ? `approve-scripts needs a readable package-lock.json: ${project.lockfileError}`
        : "approve-scripts needs a package-lock.json with a packages map (npm lockfile v2/v3). Run npm install --package-lock-only --ignore-scripts first."
    );
  }

  const discovered = collectPendingScriptPackages(project, options);
  const targets = options.all ? discovered : discovered.filter((entry) => entry.allowState === "pending");
  const packages = new Array(targets.length);
  const errors = [];

  await mapConcurrent(targets, Number(options.projectConcurrency ?? 3), async (target, index) => {
    try {
      if (!target.packageSpec) throw new Error(target.reason);
      const reviewed = await reviewer(target.packageSpec, {
        ...options,
        githubMetadata: false,
        check: true,
        lockedIntegrity: target.integrity,
      });
      const classification = classifyInstallScripts(reviewed.result);
      if (classification.decision === "approve" && !target.resolved) {
        classification.decision = "review";
        classification.reasons = ["Lockfile has no resolved URL; npm cannot enforce a version-pinned approval. Refresh the lockfile and review again."];
      }
      packages[index] = {
        ...target,
        verdict: reviewed.result.verdict,
        findings: reviewed.result.findings,
        ...classification,
      };
    } catch (error) {
      errors.push({ name: target.name, version: target.version, message: error.message });
    }
  });

  const completed = packages.filter(Boolean);
  const counts = completed.reduce(
    (summary, entry) => {
      summary[entry.decision] += 1;
      return summary;
    },
    { approve: 0, review: 0, deny: 0 }
  );

  // The agent contract derives decision.action from this, so a review-needed
  // report has to read as caution rather than falling through to stop.
  const verdict = {
    verdict: counts.deny > 0 ? "block" : counts.review > 0 ? "caution" : "proceed",
    score: completed.reduce((highest, entry) => Math.max(highest, Number(entry.verdict?.score ?? 0)), 0),
  };

  return {
    kind: "script-approvals",
    verdict,
    coverage: reviewCoverage({ scope: options.all ? "all-install-scripts" : "pending-install-scripts",
      requested: targets.length, scanned: completed.length, failed: errors.length,
      reasons: errors.map((entry) => `${entry.name}: ${entry.message}`) }),
    project: {
      name: project.manifest.name ?? null,
      version: project.manifest.version ?? null,
      manifestPath: project.manifestPath,
      lockfilePath: project.lockfilePath,
    },
    summary: {
      withInstallScripts: discovered.length,
      alreadyAllowed: discovered.filter((entry) => entry.allowState === "allowed").length,
      alreadyDenied: discovered.filter((entry) => entry.allowState === "denied").length,
      reviewed: completed.length,
      errors: errors.length,
      ...counts,
    },
    packages: completed,
    errors,
  };
}

export function scriptApprovalExitCode(report) {
  if (report.errors.length > 0) {
    return 1;
  }
  if (report.summary.deny > 0) {
    return 3;
  }
  if (report.summary.review > 0) {
    return 2;
  }
  return 0;
}

// Only unambiguous outcomes are written. A "review" package stays pending on
// purpose: the whole point of the command is that a person decides those, and
// silently writing them would recreate the rubber-stamp the allowlist replaced.
export function buildAllowScriptsPatch(report) {
  const additions = new Map();

  for (const entry of report.packages) {
    if (entry.decision === "approve") {
      const key = entry.packageSpec ?? `${entry.name}@${entry.version}`;
      if (additions.get(key) !== false) additions.set(key, true);
    } else if (entry.decision === "deny") {
      additions.set(entry.packageSpec ?? `${entry.name}@${entry.version}`, false);
    }
  }

  return additions;
}

export function applyAllowScripts(manifestPath, additions) {
  if (additions.size === 0) {
    return { written: false, reason: "No package had an unambiguous decision to record." };
  }

  const raw = readFileSync(manifestPath, "utf8");
  const manifest = JSON.parse(raw);
  const existing = manifest[ALLOW_FIELD] && typeof manifest[ALLOW_FIELD] === "object" && !Array.isArray(manifest[ALLOW_FIELD])
    ? manifest[ALLOW_FIELD]
    : {};

  const merged = { ...existing };
  let count = 0;
  for (const [key, value] of additions) {
    const name = key.slice(0, key.lastIndexOf("@"));
    if (value === true && (existing[key] === false || existing[name] === false)) continue;
    merged[key] = value;
    count += 1;
  }
  if (!count) return { written: false, reason: "Existing denied permissions were preserved; no entries changed." };
  manifest[ALLOW_FIELD] = Object.fromEntries(
    Object.entries(merged).sort(([left], [right]) => left.localeCompare(right))
  );

  const indent = detectIndent(raw);
  const trailingNewline = raw.endsWith("\n") ? "\n" : "";
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, indent)}${trailingNewline}`, "utf8");

  return { written: true, count, field: ALLOW_FIELD };
}

function detectIndent(raw) {
  const match = raw.match(/\n([ \t]+)"/);
  if (!match) {
    return 2;
  }
  return match[1].includes("\t") ? "\t" : match[1].length;
}

async function mapConcurrent(items, concurrency, worker) {
  const limit = Math.max(1, Math.min(8, Math.floor(concurrency) || 1));
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}
