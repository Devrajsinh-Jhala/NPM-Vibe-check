import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { parsePackageSpec, parseVersion } from "./spec.js";

const DEPENDENCY_FIELDS = ["dependencies", "optionalDependencies"];
const UNSUPPORTED_DEPENDENCY_PREFIXES = [
  "workspace:",
  "file:",
  "link:",
  "portal:",
  "patch:",
  "npm:",
  "git:",
  "git+",
  "github:",
  "gitlab:",
  "bitbucket:",
  "http:",
  "https:",
];

export function loadProjectManifest(input = ".", options = {}) {
  const cwd = options.cwd ?? process.cwd();
  let manifestPath = resolve(cwd, input);

  if (!existsSync(manifestPath)) {
    throw new Error(`Project path does not exist: ${manifestPath}`);
  }
  if (statSync(manifestPath).isDirectory()) {
    manifestPath = join(manifestPath, "package.json");
  }
  if (!existsSync(manifestPath) || basename(manifestPath).toLowerCase() !== "package.json") {
    throw new Error(`Expected a package.json file: ${manifestPath}`);
  }

  const manifest = readJson(manifestPath, "package.json");
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Project manifest must contain a JSON object: ${manifestPath}`);
  }

  const lockfilePath = join(dirname(manifestPath), "package-lock.json");
  let lockfile = null;
  let lockfileError = null;
  if (existsSync(lockfilePath)) {
    try {
      lockfile = readJson(lockfilePath, "package-lock.json");
    } catch (error) {
      lockfileError = error.message;
    }
  }

  return {
    manifestPath,
    directory: dirname(manifestPath),
    manifest,
    lockfilePath: lockfile ? lockfilePath : null,
    lockfile,
    lockfileError,
  };
}

export function collectProjectDependencies(project, options = {}) {
  const fields = options.includeDev
    ? [...DEPENDENCY_FIELDS, "devDependencies"]
    : DEPENDENCY_FIELDS;
  const dependencies = new Map();

  for (const field of fields) {
    const values = project.manifest[field];
    if (!values || typeof values !== "object" || Array.isArray(values)) {
      continue;
    }

    for (const [name, requestedValue] of Object.entries(values)) {
      const requested = String(requestedValue ?? "").trim();
      const existing = dependencies.get(name);
      if (existing) {
        existing.groups.push(field);
        if (field === "optionalDependencies") {
          existing.requested = requested;
        }
        continue;
      }
      dependencies.set(name, { name, requested, groups: [field] });
    }
  }

  return [...dependencies.values()]
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((dependency) => resolveProjectDependency(dependency, project.lockfile));
}

export async function scanProject(input, options, reviewer) {
  if (typeof reviewer !== "function") {
    throw new Error("Project scanning requires a package reviewer.");
  }

  const project = loadProjectManifest(input, options);
  const discovered = collectProjectDependencies(project, options);
  const reviewable = discovered.filter((dependency) => dependency.packageSpec);
  const skipped = discovered
    .filter((dependency) => !dependency.packageSpec)
    .map(({ name, requested, groups, reason }) => ({ name, requested, groups, reason }));
  const packages = new Array(reviewable.length);
  const errors = [];
  const aiEnabled = options.aiMode && options.aiMode !== "off";
  const aiLimit = Number(options.projectAiLimit ?? 3);
  let aiAttempts = 0;
  let aiSuppressed = 0;

  const reviewOne = async (dependency, index, reviewOptions = options) => {
    try {
      const reviewed = await reviewer(dependency.packageSpec, {
        ...reviewOptions,
        githubMetadata: false,
        check: true,
      });
      const result = {
        ...reviewed.result,
        dependency: {
          requested: dependency.requested,
          groups: dependency.groups,
          resolvedFrom: dependency.resolvedFrom,
        },
      };
      packages[index] = result;
      return result;
    } catch (error) {
      errors.push({
        name: dependency.name,
        requested: dependency.requested,
        groups: dependency.groups,
        message: error.message,
      });
      return null;
    }
  };

  if (aiEnabled) {
    for (let index = 0; index < reviewable.length; index += 1) {
      const aiAllowed = aiAttempts < aiLimit;
      const result = await reviewOne(reviewable[index], index, {
        ...options,
        aiMode: aiAllowed ? options.aiMode : "off",
      });
      if (!result) {
        continue;
      }
      if (aiAllowed && result.ai?.status !== "skipped") {
        aiAttempts += 1;
      } else if (!aiAllowed && /heuristic-only mode/i.test(result.ai?.reason ?? "")) {
        aiSuppressed += 1;
      }
    }
  } else {
    await mapConcurrent(reviewable, Number(options.projectConcurrency ?? 3), reviewOne);
  }

  const completed = packages.filter(Boolean);
  const verdict = aggregateVerdict(completed);
  const counts = completed.reduce((summary, result) => {
    summary[result.verdict.verdict] += 1;
    return summary;
  }, { proceed: 0, caution: 0, block: 0 });

  return {
    kind: "project",
    project: {
      name: project.manifest.name ?? basename(project.directory),
      version: project.manifest.version ?? null,
      manifestPath: project.manifestPath,
      lockfilePath: project.lockfilePath,
      lockfileError: project.lockfileError,
      includeDev: Boolean(options.includeDev),
    },
    verdict,
    summary: {
      discovered: discovered.length,
      scanned: completed.length,
      skipped: skipped.length,
      errors: errors.length,
      ...counts,
    },
    ai: {
      enabled: Boolean(aiEnabled),
      limit: aiEnabled ? aiLimit : 0,
      attempted: aiAttempts,
      suppressed: aiSuppressed,
    },
    packages: completed,
    skipped,
    errors,
  };
}

export function projectExitCode(scan) {
  if (scan.errors.length > 0) {
    return 1;
  }
  if (scan.verdict.verdict === "block") {
    return 3;
  }
  if (scan.verdict.verdict === "caution") {
    return 2;
  }
  return 0;
}

function resolveProjectDependency(dependency, lockfile) {
  try {
    parsePackageSpec(dependency.name);
  } catch (error) {
    return { ...dependency, packageSpec: null, reason: error.message };
  }

  const unsupportedReason = unsupportedDependencyReason(dependency.requested);
  if (unsupportedReason) {
    return { ...dependency, packageSpec: null, reason: unsupportedReason };
  }

  const lockedVersion = lockfile?.packages?.[`node_modules/${dependency.name}`]?.version
    ?? lockfile?.dependencies?.[dependency.name]?.version;
  if (parseVersion(lockedVersion)) {
    return {
      ...dependency,
      packageSpec: `${dependency.name}@${lockedVersion}`,
      resolvedFrom: "package-lock.json",
    };
  }

  return {
    ...dependency,
    packageSpec: dependency.requested && dependency.requested !== "*"
      ? `${dependency.name}@${dependency.requested}`
      : dependency.name,
    resolvedFrom: "package.json",
  };
}

function unsupportedDependencyReason(requested) {
  const normalized = String(requested ?? "").trim().toLowerCase();
  if (!normalized) {
    return "Dependency has an empty version specifier.";
  }
  if (UNSUPPORTED_DEPENDENCY_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return "Local, workspace, alias, URL, and Git dependencies are outside the registry-only trust boundary.";
  }
  if (normalized.includes("/") || normalized.includes("#")) {
    return "Repository shorthand and non-registry dependency specifiers are not supported.";
  }
  return null;
}

function aggregateVerdict(packages) {
  const ranked = { proceed: 0, caution: 1, block: 2 };
  let verdict = "proceed";
  let score = 0;
  for (const result of packages) {
    score = Math.max(score, Number(result.verdict.score ?? 0));
    if (ranked[result.verdict.verdict] > ranked[verdict]) {
      verdict = result.verdict.verdict;
    }
  }
  return { verdict, score };
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

function readJson(path, label) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${label} at ${path}: ${error.message}`);
  }
}
