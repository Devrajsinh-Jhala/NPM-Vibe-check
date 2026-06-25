import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const HISTORY_SCHEMA_VERSION = 1;
const MAX_PACKAGE_RECORDS = 20;
const MAX_PACKAGES = 200;

export function createReviewFingerprint(snapshot, integrity, analysis, inspection) {
  const integrityResult = integrity.results?.find((result) => result.type === "integrity")
    ?? integrity.results?.find((result) => result.type === "shasum");
  const integrityKey = integrityResult
    ? `${integrityResult.algorithm}-${integrityResult.actual}`
    : snapshot.integrity ?? snapshot.shasum ?? `version:${snapshot.version}`;

  return {
    packageName: snapshot.spec.name,
    version: snapshot.version,
    integrityKey,
    lifecycleScripts: (analysis.stats.lifecycleScripts ?? []).map((script) => ({
      name: script.name,
      command: script.command,
    })),
    selectedFiles: (inspection.selectedFiles ?? [])
      .map((file) => ({
        path: file.path,
        sha256: createHash("sha256").update(file.text ?? "").digest("hex"),
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    findings: analysis.findings
      .filter((finding) => finding.code !== "ai_unavailable")
      .map((finding) => findingKey(finding))
      .sort(),
  };
}

export function loadReviewMemory(options = {}) {
  if (options.historyEnabled === false) {
    return { enabled: false, path: null, data: emptyHistory(), error: null };
  }

  const path = resolveHistoryPath(options);
  if (!existsSync(path)) {
    return { enabled: true, path, data: emptyHistory(), error: null };
  }

  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    if (data?.schemaVersion !== HISTORY_SCHEMA_VERSION || typeof data.packages !== "object") {
      throw new Error("unsupported history schema");
    }
    return { enabled: true, path, data, error: null };
  } catch (error) {
    return {
      enabled: true,
      path,
      data: emptyHistory(),
      error: `Could not read local review memory: ${error.message}`,
    };
  }
}

export function compareReviewMemory(memory, fingerprint) {
  if (!memory.enabled) {
    return { status: "disabled" };
  }
  if (memory.error) {
    return { status: "unavailable", reason: memory.error };
  }

  const records = memory.data.packages[fingerprint.packageName] ?? [];
  const exact = records.find((record) => record.integrityKey === fingerprint.integrityKey);
  if (exact) {
    return {
      status: "unchanged",
      previousVersion: exact.version,
      reviewedAt: exact.reviewedAt,
      previousVerdict: exact.verdict,
      previousScore: exact.score,
      integrityMatch: true,
      changes: emptyChanges(),
    };
  }

  const previous = records[0];
  if (!previous) {
    return {
      status: "first-review",
      integrityMatch: false,
      changes: emptyChanges(),
    };
  }

  return {
    status: "changed",
    previousVersion: previous.version,
    reviewedAt: previous.reviewedAt,
    previousVerdict: previous.verdict,
    previousScore: previous.score,
    integrityMatch: false,
    changes: compareFingerprints(previous, fingerprint),
  };
}

export function saveReviewMemory(memory, fingerprint, result) {
  if (!memory.enabled || memory.error || !memory.path) {
    return { saved: false, reason: memory.error ?? "disabled" };
  }

  try {
    const reviewedAt = new Date().toISOString();
    const record = {
      ...fingerprint,
      reviewedAt,
      verdict: result.verdict.verdict,
      score: result.verdict.score,
      ai: result.ai.status === "ok"
        ? {
            provider: result.ai.provider,
            model: result.ai.model,
            confidence: result.ai.confidence,
          }
        : null,
    };

    const packages = { ...memory.data.packages };
    const existing = packages[fingerprint.packageName] ?? [];
    packages[fingerprint.packageName] = [
      record,
      ...existing.filter((entry) => entry.integrityKey !== fingerprint.integrityKey),
    ].slice(0, MAX_PACKAGE_RECORDS);

    const packageNames = Object.keys(packages);
    if (packageNames.length > MAX_PACKAGES) {
      packageNames
        .sort((left, right) => latestReview(packages[left]) - latestReview(packages[right]))
        .slice(0, packageNames.length - MAX_PACKAGES)
        .forEach((name) => delete packages[name]);
    }

    mkdirSync(dirname(memory.path), { recursive: true });
    writeFileSync(memory.path, JSON.stringify({
      schemaVersion: HISTORY_SCHEMA_VERSION,
      packages,
    }, null, 2), { encoding: "utf8", mode: 0o600 });
    memory.data = { schemaVersion: HISTORY_SCHEMA_VERSION, packages };
    return { saved: true, path: memory.path };
  } catch (error) {
    return { saved: false, reason: `Could not save local review memory: ${error.message}` };
  }
}

export function resolveHistoryPath(options = {}) {
  if (options.historyFile) {
    return resolve(options.historyFile);
  }
  return join(options.homeDir ?? homedir(), ".npx-vibe", "reviews.json");
}

function compareFingerprints(previous, current) {
  const previousFiles = new Map((previous.selectedFiles ?? []).map((file) => [file.path, file.sha256]));
  const currentFiles = new Map((current.selectedFiles ?? []).map((file) => [file.path, file.sha256]));
  const addedFiles = [...currentFiles.keys()].filter((path) => !previousFiles.has(path));
  const removedFiles = [...previousFiles.keys()].filter((path) => !currentFiles.has(path));
  const changedFiles = [...currentFiles.keys()].filter(
    (path) => previousFiles.has(path) && previousFiles.get(path) !== currentFiles.get(path)
  );

  const previousFindings = new Set(previous.findings ?? []);
  const currentFindings = new Set(current.findings ?? []);
  const previousScripts = stableJson(previous.lifecycleScripts ?? []);
  const currentScripts = stableJson(current.lifecycleScripts ?? []);

  return {
    addedFiles,
    removedFiles,
    changedFiles,
    addedFindings: [...currentFindings].filter((finding) => !previousFindings.has(finding)),
    resolvedFindings: [...previousFindings].filter((finding) => !currentFindings.has(finding)),
    lifecycleScriptsChanged: previousScripts !== currentScripts,
  };
}

function findingKey(finding) {
  return [finding.severity, finding.code, finding.file ?? ""].join(":");
}

function stableJson(value) {
  return JSON.stringify(value);
}

function latestReview(records) {
  return new Date(records?.[0]?.reviewedAt ?? 0).getTime();
}

function emptyHistory() {
  return {
    schemaVersion: HISTORY_SCHEMA_VERSION,
    packages: {},
  };
}

function emptyChanges() {
  return {
    addedFiles: [],
    removedFiles: [],
    changedFiles: [],
    addedFindings: [],
    resolvedFindings: [],
    lifecycleScriptsChanged: false,
  };
}
